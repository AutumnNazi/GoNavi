package app

import (
	"bytes"
	"encoding/xml"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"GoNavi-Wails/internal/logger"
)

// runMacUpdateLaunchctl 便于单测替换，避免测试真的向 launchd 注册任务。
var runMacUpdateLaunchctl = defaultRunMacUpdateLaunchctl

// startMacUpdateViaLaunchd 让当前用户的 launchd 启动安装脚本。
//
// macOS 在 GUI App 退出时会杀掉仍把它视为 responsible process 的子进程。
// Setsid / nohup 都改不了这个归属，所以脚本必须由 launchd 拉起，父进程才不是 GoNavi。
func startMacUpdateViaLaunchd(scriptPath string) error {
	scriptPath = strings.TrimSpace(scriptPath)
	if scriptPath == "" {
		return fmt.Errorf("update script path is empty")
	}
	label := "com.gonavi.updater." + strconv.FormatInt(time.Now().UnixNano(), 10)
	plistPath := filepath.Join(filepath.Dir(scriptPath), "gonavi-update.plist")
	if err := os.WriteFile(plistPath, []byte(macUpdateLaunchdPlist(label, scriptPath)), 0o600); err != nil {
		return fmt.Errorf("write update launchd plist: %w", err)
	}
	domain := fmt.Sprintf("gui/%d", os.Getuid())
	if err := runMacUpdateLaunchctl("bootstrap", domain, plistPath); err != nil {
		return err
	}
	logger.Infof("macOS 更新脚本已交给 launchd：label=%s plist=%s", label, plistPath)
	return nil
}

func macUpdateLaunchdPlist(label, scriptPath string) string {
	return `<?xml version="1.0" encoding="UTF-8"?>` +
		`<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">` +
		`<plist version="1.0"><dict>` +
		`<key>Label</key><string>` + xmlText(label) + `</string>` +
		`<key>ProgramArguments</key><array>` +
		`<string>/bin/bash</string>` +
		`<string>` + xmlText(scriptPath) + `</string>` +
		`</array>` +
		`<key>RunAtLoad</key><true/>` +
		`<key>AbandonProcessGroup</key><true/>` +
		`</dict></plist>`
}

func xmlText(value string) string {
	var output bytes.Buffer
	if err := xml.EscapeText(&output, []byte(value)); err != nil {
		return value
	}
	return output.String()
}

func defaultRunMacUpdateLaunchctl(args ...string) error {
	command := exec.Command("/bin/launchctl", args...)
	var stderr bytes.Buffer
	command.Stderr = &stderr
	if err := command.Run(); err != nil {
		detail := strings.TrimSpace(stderr.String())
		if detail == "" {
			return fmt.Errorf("launchctl %s: %w", strings.Join(args, " "), err)
		}
		return fmt.Errorf("launchctl %s: %w: %s", strings.Join(args, " "), err, detail)
	}
	return nil
}
