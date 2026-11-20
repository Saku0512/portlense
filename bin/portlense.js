#!/usr/bin/env node
import { getPorts } from '../src/index.js';
import { setTimeout as delay } from 'node:timers/promises';

const help = `portlense — View ports in use

Usage: portlense [options]

  -p, --port <number>      Filter by port number (1–65535)
  -t, --protocol <type>    Filter by protocol: tcp or udp
      --pid <number>       Filter by process ID
      --process <name>     Filter by process name (case-insensitive substring)
      --state <state>      Filter by socket state (e.g. LISTEN)
      --sort <field>       Sort by port, protocol, pid, process, or state
      --color <mode>       Color output: auto, always, or never (default: auto)
  -a, --all                Include non-listening TCP connections
  -w, --watch              Refresh continuously (press Ctrl+C to stop)
      --interval <seconds> Refresh interval for watch mode (default: 2)
  -j, --json               Output JSON (one JSON array per line in watch mode)
  -h, --help               Show help
  -v, --version            Show version
`;

function parseArgs(args) {
  const options = {};
  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === '-h' || arg === '--help') options.help = true;
    else if (arg === '-v' || arg === '--version') options.version = true;
    else if (arg === '-a' || arg === '--all') options.all = true;
    else if (arg === '-j' || arg === '--json') options.json = true;
    else if (arg === '-w' || arg === '--watch') options.watch = true;
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
  if (options.interval !== undefined && !options.watch) throw new Error('--interval requires --watch.');
  return options;
}

function printTable(entries, useColor = false) {
  const color = (code, value) => useColor ? `\x1b[${code}m${value}\x1b[0m` : value;
  if (!entries.length) { console.log('No matching ports found.'); return; }
  const rows = entries.map(e => [String(e.port), e.protocol, e.address, e.state || '-', String(e.pid), e.process || '-']);
  const headers = ['PORT', 'PROTO', 'ADDRESS', 'STATE', 'PID', 'PROCESS'];
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => row[i].length)));
  const format = (row, codes = []) => row.map((cell, i) => {
    const padded = i === row.length - 1 ? cell : cell.padEnd(widths[i]);
    return codes[i] ? color(codes[i], padded) : padded;
  }).join('  ');
  console.log(format(headers, headers.map(() => '1;36')));
  console.log(color('2', format(widths.map(width => '─'.repeat(width)))));
  for (const row of rows) {
    const stateColor = row[3] === 'LISTEN' ? '32' : row[3] === 'UNCONN' ? '33' : '36';
    console.log(format(row, ['1', row[1] === 'TCP' ? '34' : '35', '', stateColor, '2', '']));
  }
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) console.log(help);
  else if (options.version) console.log('0.1.0');
  else {
    do {
      const entries = await getPorts(options);
      if (options.json) console.log(JSON.stringify(entries, null, options.watch ? 0 : 2));
      else {
        if (options.watch) {
          if (process.stdout.isTTY) process.stdout.write('\x1b[2J\x1b[H');
          console.log(`Updated ${new Date().toISOString()} (Ctrl+C to stop)`);
        }
        const useColor = options.color === 'always' || (options.color !== 'never' && process.stdout.isTTY && !('NO_COLOR' in process.env));
        printTable(entries, useColor);
      }
      if (options.watch) await delay((options.interval ?? 2) * 1000);
    } while (options.watch);
  }
} catch (error) {
  console.error(`portlense: ${error.message}`);
  process.exitCode = 1;
}
