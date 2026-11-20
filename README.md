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
portlense --all                # Include non-listening TCP connections
portlense --json               # Output JSON
portlense --help
```

Options can be combined. The information available depends on your OS and user permissions. Processes you cannot access may be missing, or their names may be unavailable. On Windows, `--all` displays the local address.

## JavaScript API

```js
import { getPorts } from 'portlense';

const ports = await getPorts({ protocol: 'TCP', port: 3000, all: false });
console.log(ports);
// [{ protocol: 'TCP', port: 3000, address: '*:3000', state: 'LISTEN', pid: 1234, process: 'node' }]
```

`protocol`, `port`, and `all` are optional. Results are sorted by port number. The process name is an empty string when unavailable.

## Development

```sh
npm test
```

MIT License
