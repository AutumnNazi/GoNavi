package cli

import (
	"encoding/hex"
	"encoding/json"
	"errors"
	"flag"
	"fmt"
	"os"
	"strings"
	"time"
)

type pluginOptions struct {
	command    string
	root       string
	safeMode   bool
	help       bool
	digest     string
	trusted    bool
	purge      bool
	arguments  string
	timeout    time.Duration
	positional []string
}

func bindPluginCommon(fs *flag.FlagSet, options *pluginOptions) {
	fs.StringVar(&options.root, "root", options.root, "plugin store root")
	fs.BoolVar(&options.safeMode, "safe-mode", options.safeMode, "disable plugin execution")
	fs.BoolVar(&options.help, "help", false, "show help")
	fs.BoolVar(&options.help, "h", false, "show help")
}

func parsePluginOptions(args []string) (pluginOptions, error) {
	options := pluginOptions{arguments: "{}", timeout: 15 * time.Second}
	global := newFlagSet("plugin")
	bindPluginCommon(global, &options)
	if err := global.Parse(args); err != nil {
		return options, err
	}
	rest := global.Args()
	if options.help || len(rest) == 0 {
		options.help = true
		return options, nil
	}
	options.command = strings.ToLower(rest[0])
	if options.command == "help" {
		options.help = true
		return options, nil
	}
	local := newFlagSet("plugin " + options.command)
	bindPluginCommon(local, &options)
	switch options.command {
	case "list", "inspect", "check", "enable", "disable":
	case "install", "replace":
		local.StringVar(&options.digest, "digest", "", "exact inspected content digest")
		local.BoolVar(&options.trusted, "trust", false, "trust execution of the inspected package")
	case "remove":
		local.BoolVar(&options.purge, "purge", false, "remove retained plugin data")
	case "invoke":
		local.StringVar(&options.arguments, "args", "{}", "JSON command arguments")
		local.DurationVar(&options.timeout, "timeout", 15*time.Second, "startup and invocation deadline")
	default:
		return options, fmt.Errorf("unknown plugin command %q", rest[0])
	}
	if err := local.Parse(rest[1:]); err != nil {
		return options, err
	}
	if options.help {
		return options, nil
	}
	options.positional = local.Args()
	options.safeMode = options.safeMode || pluginSafeModeEnvironment()
	return options, validatePluginOptions(options)
}

func validatePluginOptions(options pluginOptions) error {
	want := 1
	if options.command == "list" {
		want = 0
	}
	if options.command == "invoke" {
		want = 2
	}
	if len(options.positional) != want {
		return fmt.Errorf("plugin %s requires %d positional arguments; flags must precede them", options.command, want)
	}
	for _, argument := range options.positional {
		if strings.TrimSpace(argument) == "" {
			return errors.New("empty plugin argument")
		}
	}
	if options.command == "install" || options.command == "replace" {
		digest, err := hex.DecodeString(options.digest)
		if err != nil || len(digest) != 32 {
			return fmt.Errorf("%s requires the 64-character digest returned by inspect", options.command)
		}
		if !options.trusted {
			return fmt.Errorf("%s requires --trust after reviewing the manifest and permissions", options.command)
		}
	}
	if options.command == "invoke" {
		if len(options.arguments) > 1<<20 || !json.Valid([]byte(options.arguments)) {
			return errors.New("invoke requires valid JSON arguments of at most one MiB")
		}
		if options.timeout <= 0 || options.timeout > 5*time.Minute {
			return errors.New("invoke timeout must be positive and at most five minutes")
		}
	}
	return nil
}

func pluginSafeModeEnvironment() bool {
	switch strings.ToLower(strings.TrimSpace(os.Getenv("GONAVI_DISABLE_PLUGINS"))) {
	case "1", "true", "yes", "on":
		return true
	default:
		return false
	}
}
