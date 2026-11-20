# JavaScript API

```js
import { getPorts } from 'portlense';

const ports = await getPorts({ protocol: 'TCP', port: 3000, pid: 1234, process: 'node', state: 'LISTEN', sort: 'port', all: false });
console.log(ports);
// [{ protocol: 'TCP', port: 3000, address: '*:3000', state: 'LISTEN', pid: 1234, process: 'node' }]
```

`protocol`, `port`, `pid`, `process`, `state`, `sort`, `all`, and `details` are optional. With `details: true`, results include `user` and `command` fields. `sort` accepts `port`, `protocol`, `pid`, `process`, or `state`. State matching is case-insensitive. The `process` filter matches a case-insensitive substring of the process name. Results are sorted by port number by default. The process name is an empty string when unavailable.

You can also check a port, find a port in a range, and compare snapshots:

```js
import { checkPort, findPort, diffPorts } from 'portlense';

const available = await checkPort(3000, { protocol: 'TCP', host: '127.0.0.1' });
const port = await findPort({ from: 3000, to: 3100 }); // number or null
const { added, removed } = diffPorts(previousSnapshot, currentSnapshot);
```

## Watch port changes

`watchPorts` is an async iterator that yields an initial snapshot and then polls for changes. The initial `added` and `removed` lists are empty; later snapshots compare sockets by protocol, port, address, state, PID, and process name. Details are available with `details: true`, but changes to details alone do not count as socket changes.

```js
import { watchPorts } from 'portlense';

const controller = new AbortController();
setTimeout(() => controller.abort(), 10_000);

for await (const { current, added, removed, timestamp } of watchPorts({
  protocol: 'TCP',
  interval: 1000, // milliseconds, default 2000
  signal: controller.signal,
})) {
  console.log(timestamp, current.length, { added, removed });
}
```

All `getPorts` filters are supported. Polling waits for the consumer to request the next snapshot, then waits the interval; slow consumers do not accumulate events. Breaking out of the loop or aborting the signal stops monitoring. An abort during a system command takes effect after that command finishes. Errors from enumeration are propagated. TypeScript declarations are included.

## Inspect an occupied port

```js
import { inspectPort } from 'portlense';

const result = await inspectPort(3000, { protocol: 'TCP', host: '127.0.0.1' });
console.log(result.available, result.conflicts);
// { port, protocol, host, available, conflicts }
```

`inspectPort` uses the same bind check and process lookup as `portlense check`. Conflict lookup is best effort: the array can be empty if enumeration is unavailable or restricted, and may include sockets on other addresses using the same port. A successful bind is not a reservation.

## Format a table

```js
import { formatPorts, getPorts, diffPorts } from 'portlense';

const current = await getPorts({ details: true });
console.log(formatPorts(current, { color: true, details: true }));
// To mark changes in another table:
const next = await getPorts();
const changes = diffPorts(current, next);
console.log(formatPorts(next, { changes }));
```

`formatPorts` returns a string and writes nothing to the terminal. `color` defaults to `false` and explicitly enables ANSI colors. `details` includes the user and command columns. `changes` accepts the `added` and `removed` arrays returned by `diffPorts` or `watchPorts`; its removed entries are included in the output.

## Load configuration

```js
import { loadConfig, getPorts, watchPorts } from 'portlense';

const config = await loadConfig(); // Or loadConfig('./portlense.json')
const ports = await getPorts(config);
const watcher = watchPorts({ ...config, interval: (config.interval ?? 2) * 1000 });
```

`loadConfig()` uses the same default location and validation as the CLI and returns `{}` when the default file does not exist. An explicitly specified missing or invalid file throws. Configuration is not loaded automatically by API functions. Config file intervals are in seconds; `watchPorts` and `runTui` intervals are in milliseconds.

## Run the interactive monitor

```js
import { runTui } from 'portlense';

await runTui({ protocol: 'TCP', interval: 1000, color: 'auto' });
```

`runTui` accepts the `getPorts` filters plus `interval` in milliseconds and `color` (`auto`, `always`, or `never`). It uses the process's interactive standard input and output, and resolves when the user quits. It rejects when there is no interactive terminal. It temporarily controls the terminal screen and input mode.

The CLI's JSON output is standard JSON serialization; use `JSON.stringify` with the objects returned by these APIs. The TUI, formatted output, configuration, checking, searching, filtering, process details, and monitoring are also available independently.
