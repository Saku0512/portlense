# portlense

A CLI that shows ports in use on your local machine and the processes using them.

```text
PORT  PROTO  ADDRESS         STATE   PID    PROCESS
────  ─────  ──────────────  ──────  ─────  ───────
3000  TCP    *:3000          LISTEN  1234   node
5353  UDP    *:5353          UNCONN  5678   example
```

## Installation

Node.js 18 or later is required. On macOS and Linux, portlense uses `lsof`. On Windows, it uses `netstat` and `tasklist`.

```sh
npm install -g portlense
portlense
```

After the package is published, you can also run it with `npx portlense`. To try it from source, run `node bin/portlense.js`.

## Usage

```sh
portlense                      # Show listening TCP ports and UDP sockets
portlense --tui                # Open the interactive live monitor
portlense --port 3000          # Filter by port number
portlense --protocol tcp       # Filter by tcp or udp
portlense --pid 1234           # Filter by process ID
portlense --process node       # Filter by process name (case-insensitive substring)
portlense --details            # Include process user and command
portlense --state LISTEN       # Filter by socket state
portlense --sort process       # Sort by port, protocol, pid, process, or state
portlense --color always       # Force color (auto, always, or never)
portlense --all                # Include non-listening TCP connections
portlense --watch              # Refresh every 2 seconds; press Ctrl+C to stop
portlense --watch --interval 1 # Refresh every second
portlense --json               # Output JSON
portlense check 3000           # Check TCP on 127.0.0.1 and show any conflicts
portlense check 5353 -t udp --host 0.0.0.0
portlense find --from 3000 --to 3100 # Find the first available TCP port
portlense --config ./portlense.json  # Load explicit configuration
portlense --help
```

Options can be combined. Colors are enabled automatically for terminals and disabled when `NO_COLOR` is set; `--color` explicitly overrides this behavior. JSON output is never colored. With `--watch --json`, each line is a complete JSON array, suitable for streaming. The interval must be between 0.1 and 86400 seconds. The information available depends on your OS and user permissions. Processes you cannot access may be missing, or their names may be unavailable. On Windows, `--all` displays the local address.

`check` and `find` attempt to bind the requested address and protocol (TCP and `127.0.0.1` by default), then immediately release the socket. A successful check is a snapshot, not a reservation: another process may bind the port before you do. Results for another address, IPv6, or protocol may differ. A check of an occupied port and a search with no result exit with status 1; unexpected errors also exit with status 1. Use `--json` for structured results. Conflict details depend on permissions and available system tools; the list may include sockets on other addresses using the same port.

Use `--details` to show each process's user and command. On Unix this uses `ps`; on Windows it uses PowerShell and CIM. Fields may be empty when a process exits or access is denied. In watch mode, `+` marks new sockets and `-` marks sockets that disappeared since the previous refresh; removed rows appear for one refresh. A state change appears as a removal and an addition. JSON watch output remains a stream of complete snapshots without change markers.

## Interactive monitor

Run `portlense --tui` in an interactive terminal. The display refreshes every two seconds by default; use `--interval` to change this. Existing filters such as `--port`, `--pid`, `--process`, and `--sort` apply on startup. The selected socket's address, user, and command are shown below the list when available.

- **↑ / ↓** or **k / j**: select a socket.
- **/**: edit the case-insensitive process name filter; press Enter or Escape to finish.
- **p**: cycle through all protocols, TCP, and UDP.
- **a**: toggle inclusion of non-listening TCP connections.
- **r**: refresh now.
- **q** or **Ctrl+C**: quit and restore the terminal.

The TUI requires an interactive terminal and cannot be combined with `--json` or `--watch`. Process details are best effort and may be unavailable due to permissions.

## Configuration

Create `~/.config/portlense/config.json` (or `$XDG_CONFIG_HOME/portlense/config.json` if `XDG_CONFIG_HOME` is set), for example:

```json
{
  "color": "auto",
  "sort": "process",
  "interval": 1,
  "protocol": "tcp",
  "all": false,
  "details": false
}
```

All fields are optional. `interval` applies to watch mode; it must be between 0.1 and 86400 seconds. CLI options override configuration values. `--config <path>` chooses a different JSON file; invalid or unknown settings are reported as errors.

## JavaScript API

See the [JavaScript API documentation](docs/javascript-api.md) for examples, port monitoring, and TypeScript support.

## Development

```sh
npm test
```

MIT License
