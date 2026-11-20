#!/usr/bin/env node
import { getPorts, inspectPort, findPort, diffPorts, loadConfig, formatPorts, runTui } from '../src/index.js';
import { setTimeout as delay } from 'node:timers/promises';

const help = `portlense — View ports in use

Usage: portlense [options]
       portlense check <port> [--protocol tcp|udp] [--host address] [--json]
       portlense find --from <port> --to <port> [--protocol tcp|udp] [--host address] [--json]

  -p, --port <number>      Filter by port number (1–65535)
  -t, --protocol <type>    Filter by protocol: tcp or udp
      --pid <number>       Filter by process ID
      --process <name>     Filter by process name (case-insensitive substring)
      --search <query>     Search by port number or process name
      --alerts             Enable TUI sound alerts
      --state <state>      Filter by socket state (e.g. LISTEN)
      --sort <field>       Sort by port, protocol, pid, process, or state
  -d, --details            Include process user and command
      --config <path>      Use a JSON configuration file
      --color <mode>       Color output: auto, always, or never (default: auto)
  -a, --all                Include non-listening TCP connections
      --tui                Open the interactive terminal interface
  -w, --watch              Refresh continuously (press Ctrl+C to stop)
      --interval <seconds> Refresh interval for watch mode (default: 2)
  -j, --json               Output JSON (one JSON array per line in watch mode)
  -h, --help               Show help
  -v, --version            Show version
`;


function parseArgs(args, defaults = {}) {
  const options = { ...defaults };
  if (['check', 'find'].includes(args[0])) options.command = args.shift();
  if (options.command === 'check') {
    const port = args.shift();
    if (!port || !/^\d+$/.test(port) || Number(port) < 1 || Number(port) > 65535) throw new Error('check requires a port from 1 to 65535.');
    options.port = Number(port);
  }
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '--config') { if (!args[++i]) throw new Error('--config requires a path.'); }
    else if (arg === '-d' || arg === '--details') options.details = true;
    else if (arg === '--host') { const value = args[++i]; if (!value || value.startsWith('-')) throw new Error('--host requires an address.'); options.host = value; }
    else if (arg === '--from' || arg === '--to') { const value = args[++i]; if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error(`${arg} must be an integer from 1 to 65535.`); options[arg.slice(2)] = Number(value); }
    else if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '-v' || arg === '--version') options.version = true;
    else if (arg === '-a' || arg === '--all') options.all = true;
    else if (arg === '-j' || arg === '--json') options.json = true;
    else if (arg === '-w' || arg === '--watch') options.watch = true;
    else if (arg === '--tui') options.tui = true;
    else if (arg === '--alerts') options.alerts = true;
    else if (arg === '--search') { const value = args[++i]; if (!value || value.startsWith('-')) throw new Error('--search requires a query.'); options.search = value; }
    else if (arg === '--pid') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(Number(value)) || Number(value) < 1) throw new Error('--pid must be a positive integer.');
      options.pid = Number(value);
    } else if (arg === '--process') {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error('--process requires a process name.');
      options.process = value;
    } else if (arg === '--state') {
      const value = args[++i];
      if (!value || value.startsWith('-')) throw new Error('--state requires a socket state.');
      options.state = value;
    } else if (arg === '--sort') {
      const value = args[++i];
      if (!['port', 'protocol', 'pid', 'process', 'state'].includes(value)) throw new Error('--sort must be port, protocol, pid, process, or state.');
      options.sort = value;
    } else if (arg === '--color') {
      const value = args[++i];
      if (!['auto', 'always', 'never'].includes(value)) throw new Error('--color must be auto, always, or never.');
      options.color = value;
    } else if (arg === '--interval') {
      const value = args[++i];
      if (!value || !/^(?:\d+(?:\.\d+)?|\.\d+)$/.test(value) || Number(value) < 0.1 || Number(value) > 86400) throw new Error('--interval must be between 0.1 and 86400 seconds.');
      options.interval = Number(value);
    }
    else if (arg === '-p' || arg === '--port') {
      const value = args[++i];
      if (!value || !/^\d+$/.test(value) || Number(value) < 1 || Number(value) > 65535) throw new Error('--port must be an integer from 1 to 65535.');
      options.port = Number(value);
    } else if (arg === '-t' || arg === '--protocol') {
      const value = args[++i]?.toUpperCase();
      if (value !== 'TCP' && value !== 'UDP') throw new Error('--protocol must be tcp or udp.');
      options.protocol = value;
    } else throw new Error(`Unknown option: ${arg}`);
  }
  if (args.includes('--interval') && !options.watch && !options.tui) throw new Error('--interval requires --watch or --tui.');
  if (options.alerts && !options.tui) throw new Error('--alerts requires --tui.');
  if (options.tui && (options.watch || options.json || options.command)) throw new Error('--tui cannot be combined with --watch, --json, or a command.');
  if (options.command) {
    const allowed = new Set(['--protocol', '-t', '--host', '--json', '-j', '--config', '--color', '--help', '-h', '--version', '-v', ...(options.command === 'find' ? ['--from', '--to'] : [])]);
    for (let i = 0; i < args.length; i++) {
      const arg = args[i];
      if (!allowed.has(arg)) throw new Error(`${arg} is not supported by ${options.command}.`);
      if (['--protocol', '-t', '--host', '--config', '--color', '--from', '--to'].includes(arg)) i++;
    }
  }
  if (!options.command && (options.from !== undefined || options.to !== undefined || options.host)) throw new Error('--from, --to and --host require check or find.');
  if (options.command === 'find' && (options.from === undefined || options.to === undefined || options.from > options.to)) throw new Error('find requires a valid --from and --to range.');
  if (options.command === 'check' && (options.from !== undefined || options.to !== undefined)) throw new Error('--from and --to require find.');
  return options;
}


try {
  const args = process.argv.slice(2);
  const configIndex = args.indexOf('--config');
  if (configIndex !== -1 && (!args[configIndex + 1] || args[configIndex + 1].startsWith('-'))) throw new Error('--config requires a path.');
  const options = parseArgs([...args], await loadConfig(configIndex === -1 ? undefined : args[configIndex + 1]));
  if (options.help) console.log(help);
  else if (options.version) console.log('0.1.0');
  else if (options.command) {
    const protocol = (options.protocol || 'TCP').toUpperCase();
    const host = options.host || '127.0.0.1';
    if (options.command === 'check') {
      const result = await inspectPort(options.port, { protocol, host });
      const { available, conflicts } = result;
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${protocol} ${host}:${options.port} is ${available ? 'available' : 'in use'}.`);
        if (conflicts.length) console.log(formatPorts(conflicts, { color: options.color === 'always' || (options.color !== 'never' && process.stdout.isTTY && !('NO_COLOR' in process.env)), details: true }));
      }
      if (!available) process.exitCode = 1;
    } else {
      const port = await findPort({ from: options.from, to: options.to, protocol, host });
      if (options.json) console.log(JSON.stringify({ port, protocol, host }, null, 2));
      else console.log(port === null ? 'No available port found in the requested range.' : `Available ${protocol} port on ${host}: ${port}`);
      if (port === null) process.exitCode = 1;
    }
  } else if (options.tui) await runTui({ ...options, interval: (options.interval ?? 2) * 1000 });
  else {
    let previous;
    do {
      const entries = await getPorts(options);
      if (options.json) console.log(JSON.stringify(entries, null, options.watch ? 0 : 2));
      else {
        if (options.watch) {
          if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
          console.log(`Updated ${new Date().toISOString()} (Ctrl+C to stop)`);
        }
        const useColor = options.color === 'always' || (options.color !== 'never' && process.stdout.isTTY && !('NO_COLOR' in process.env));
        const changes = options.watch && previous ? diffPorts(previous, entries) : null;
        console.log(formatPorts(entries, { color: useColor, details: options.details, changes }));
      }
      previous = entries;
      if (options.watch) await delay((options.interval ?? 2) * 1000);
    } while (options.watch);
  }
} catch (error) {
  console.error(`portlense: ${error.message}`);
  process.exitCode = 1;
}
