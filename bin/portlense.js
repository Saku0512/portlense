#!/usr/bin/env node
import { getPorts, checkPort, findPort, diffPorts } from '../src/index.js';
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { runTui } from '../src/tui.js';

const help = `portlense — View ports in use

Usage: portlense [options]
       portlense check <port> [--protocol tcp|udp] [--host address] [--json]
       portlense find --from <port> --to <port> [--protocol tcp|udp] [--host address] [--json]

  -p, --port <number>      Filter by port number (1–65535)
  -t, --protocol <type>    Filter by protocol: tcp or udp
      --pid <number>       Filter by process ID
      --process <name>     Filter by process name (case-insensitive substring)
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

async function loadConfig(args) {
  const index = args.indexOf('--config');
  if (index !== -1 && (!args[index + 1] || args[index + 1].startsWith('-'))) throw new Error('--config requires a path.');
  const path = index === -1 ? join(process.env.XDG_CONFIG_HOME || join(homedir(), '.config'), 'portlense', 'config.json') : args[index + 1];
  let config;
  try { config = JSON.parse(await readFile(path, 'utf8')); }
  catch (error) { if (index === -1 && error.code === 'ENOENT') return {}; throw new Error(`Cannot load config ${path}: ${error.message}`); }
  if (!config || typeof config !== 'object' || Array.isArray(config)) throw new Error('Config must be a JSON object.');
  const validators = {
    color: v => ['auto', 'always', 'never'].includes(v),
    sort: v => ['port', 'protocol', 'pid', 'process', 'state'].includes(v),
    interval: v => typeof v === 'number' && Number.isFinite(v) && v >= 0.1 && v <= 86400,
    protocol: v => typeof v === 'string' && ['tcp', 'udp'].includes(v.toLowerCase()),
    all: v => typeof v === 'boolean', details: v => typeof v === 'boolean',
  };
  for (const [key, value] of Object.entries(config)) if (!validators[key] || !validators[key](value)) throw new Error(`Invalid config option: ${key}`);
  return config;
}

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

function printTable(entries, useColor = false, details = false, changes = null) {
  const color = (code, value) => useColor ? `\x1b[${code}m${value}\x1b[0m` : value;
  if (!entries.length && !changes?.removed.length) { console.log('No matching ports found.'); return; }
  const allEntries = changes ? [...entries, ...changes.removed] : entries;
  const addedCounts = new Map();
  const key = e => JSON.stringify([e.protocol, e.port, e.address, e.state, e.pid, e.process]);
  for (const entry of changes?.added || []) addedCounts.set(key(entry), (addedCounts.get(key(entry)) || 0) + 1);
  const rows = allEntries.map((e, index) => {
    const k = key(e);
    const added = index < entries.length && (addedCounts.get(k) || 0) > 0;
    if (added) addedCounts.set(k, addedCounts.get(k) - 1);
    return [...(changes ? [index >= entries.length ? '-' : added ? '+' : ' '] : []), String(e.port), e.protocol, e.address, e.state || '-', String(e.pid), e.process || '-', ...(details ? [e.user || '-', e.command || '-'] : [])];
  });
  const headers = [...(changes ? ['CHANGE'] : []), 'PORT', 'PROTO', 'ADDRESS', 'STATE', 'PID', 'PROCESS', ...(details ? ['USER', 'COMMAND'] : [])];
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => row[i].length)));
  const format = (row, codes = []) => row.map((cell, i) => {
    const padded = i === row.length - 1 ? cell : cell.padEnd(widths[i]);
    return codes[i] ? color(codes[i], padded) : padded;
  }).join('  ');
  console.log(format(headers, headers.map(() => '1;36')));
  console.log(color('2', format(widths.map(width => '─'.repeat(width)))));
  for (const row of rows) {
    const offset = changes ? 1 : 0;
    const stateColor = row[offset + 3] === 'LISTEN' ? '32' : row[offset + 3] === 'UNCONN' ? '33' : '36';
    const codes = ['1', row[offset + 1] === 'TCP' ? '34' : '35', '', stateColor, '2', ''];
    if (changes) codes.unshift(row[0] === '+' ? '32' : row[0] === '-' ? '31' : '');
    console.log(format(row, codes));
  }
}

try {
  const args = process.argv.slice(2);
  const options = parseArgs([...args], await loadConfig(args));
  if (options.help) console.log(help);
  else if (options.version) console.log('0.1.0');
  else if (options.command) {
    const protocol = (options.protocol || 'TCP').toUpperCase();
    const host = options.host || '127.0.0.1';
    if (options.command === 'check') {
      const available = await checkPort(options.port, { protocol, host });
      let conflicts = [];
      if (!available) {
        try { conflicts = await getPorts({ port: options.port, protocol, details: true }); }
        catch { /* Binding results are still useful if process enumeration is unavailable. */ }
      }
      const result = { port: options.port, protocol, host, available, conflicts };
      if (options.json) console.log(JSON.stringify(result, null, 2));
      else {
        console.log(`${protocol} ${host}:${options.port} is ${available ? 'available' : 'in use'}.`);
        if (conflicts.length) printTable(conflicts, options.color === 'always' || (options.color !== 'never' && process.stdout.isTTY && !('NO_COLOR' in process.env)), true);
      }
      if (!available) process.exitCode = 1;
    } else {
      const port = await findPort({ from: options.from, to: options.to, protocol, host });
      if (options.json) console.log(JSON.stringify({ port, protocol, host }, null, 2));
      else console.log(port === null ? 'No available port found in the requested range.' : `Available ${protocol} port on ${host}: ${port}`);
      if (port === null) process.exitCode = 1;
    }
  } else if (options.tui) await runTui(options);
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
        printTable(entries, useColor, options.details, changes);
      }
      previous = entries;
      if (options.watch) await delay((options.interval ?? 2) * 1000);
    } while (options.watch);
  }
} catch (error) {
  console.error(`portlense: ${error.message}`);
  process.exitCode = 1;
}
