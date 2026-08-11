# @syngnat/gonavi-cli

This package is published with the first stable GoNavi CLI release. It installs
the standalone `gonavi` executable for the current platform. The npm lifecycle
downloads the matching GoNavi Release archive and the independent
`gonavi-cli_${VERSION}_checksums.txt` file, verifies SHA256, checks the fixed
archive entries, and only then installs the executable.

```bash
npm install -g @syngnat/gonavi-cli
gonavi list-connections
```

Before the first stable CLI release is published, install the CLI directly
from a release archive instead of the npm registry.

The package does not store credentials or configure a separate data directory;
the executable keeps the normal `GONAVI_DATA_ROOT` and `~/.gonavi` resolution.
Set `GONAVI_CLI_RELEASE_BASE_URL` only when using a mirror that preserves the
same release asset names and checksum file.
