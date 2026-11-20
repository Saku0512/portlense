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
portlense --port 3000          # Filter by port number
portlense --protocol tcp       # Filter by tcp or udp
portlense --pid 1234           # Filter by process ID
portlense --process node       # Filter by process name (case-insensitive substring)
portlense --state LISTEN       # Filter by socket state
portlense --sort process       # Sort by port, protocol, pid, process, or state
portlense --color always       # Force color (auto, always, or never)
portlense --all                # Include non-listening TCP connections
portlense --watch              # Refresh every 2 seconds; press Ctrl+C to stop
portlense --watch --interval 1 # Refresh every second
portlense --json               # Output JSON
portlense --help
```

Options can be combined. Colors are enabled automatically for terminals and disabled when `NO_COLOR` is set; `--color` explicitly overrides this behavior. JSON output is never colored. With `--watch --json`, each line is a complete JSON array, suitable for streaming. The interval must be between 0.1 and 86400 seconds. The information available depends on your OS and user permissions. Processes you cannot access may be missing, or their names may be unavailable. On Windows, `--all` displays the local address.

## JavaScript API

```js
import { getPorts } from 'portlense';

const ports = await getPorts({ protocol: 'TCP', port: 3000, pid: 1234, process: 'node', state: 'LISTEN', sort: 'port', all: false });
console.log(ports);
// [{ protocol: 'TCP', port: 3000, address: '*:3000', state: 'LISTEN', pid: 1234, process: 'node' }]
```

`protocol`, `port`, `pid`, `process`, `state`, `sort`, and `all` are optional. `sort` accepts `port`, `protocol`, `pid`, `process`, or `state`. State matching is case-insensitive. The `process` filter matches a case-insensitive substring of the process name. Results are sorted by port number. The process name is an empty string when unavailable.

## Development

```sh
npm test
```

MIT License
