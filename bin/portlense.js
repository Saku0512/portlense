#!/usr/bin/env node
import { getPorts } from '../src/index.js';

const help = `portlense — View ports in use

Usage: portlense [options]

  -p, --port <number>        Filter by port number (1–65535)
  -t, --protocol <type>    Filter by protocol: tcp or udp
  -a, --all                Include non-listening TCP connections
  -j, --json               Output JSON
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
  return options;
}

function printTable(entries) {
  if (!entries.length) { console.log('No matching ports found.'); return; }
  const rows = entries.map(e => [String(e.port), e.protocol, e.address, e.state || '-', String(e.pid), e.process || '-']);
  const headers = ['PORT', 'PROTO', 'ADDRESS', 'STATE', 'PID', 'PROCESS'];
  const widths = headers.map((header, i) => Math.max(header.length, ...rows.map(row => row[i].length)));
  const format = row => row.map((cell, i) => i === row.length - 1 ? cell : cell.padEnd(widths[i])).join('  ');
  console.log(format(headers));
  console.log(format(widths.map(width => '─'.repeat(width))));
  for (const row of rows) console.log(format(row));
}

try {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) console.log(help);
  else if (options.version) console.log('0.1.0');
  else {
    const entries = await getPorts(options);
    if (options.json) console.log(JSON.stringify(entries, null, 2));
    else printTable(entries);
  }
} catch (error) {
  console.error(`portlense: ${error.message}`);
  process.exitCode = 1;
}
