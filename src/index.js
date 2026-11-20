import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);

// lsof's field format keeps process names with spaces unambiguous.
export function parseLsof(output, { all = false } = {}) {
  const entries = [];
  let pid, processName, entry;
  const flush = () => {
    if (!entry?.protocol || !entry.address) return;
    if (!all && entry.protocol === 'TCP' && entry.state !== 'LISTEN') return;
    const match = entry.address.match(/:(\d+)(?:->|$)/);
    if (!match) return;
    entries.push({ protocol: entry.protocol, port: Number(match[1]), address: entry.address, state: entry.state || (entry.protocol === 'UDP' ? 'UNCONN' : ''), pid, process: processName });
  };
  for (const line of output.split(/\r?\n/)) {
    const value = line.slice(1);
    switch (line[0]) {
      case 'p': flush(); entry = undefined; pid = Number(value); processName = ''; break;
      case 'c': processName = value; break;
      case 'f': flush(); entry = {}; break;
      case 'P': if (entry) entry.protocol = value; break;
      case 'n': if (entry) entry.address = value; break;
      case 'T': if (entry && value.startsWith('ST=')) entry.state = value.slice(3); break;
    }
  }
  flush();
  return entries;
}

export function parseNetstat(output, { all = false } = {}) {
  const entries = [];
  for (const line of output.split(/\r?\n/)) {
    const parts = line.trim().split(/\s+/);
    const protocol = parts[0]?.toUpperCase();
    if (protocol !== 'TCP' && protocol !== 'UDP') continue;
    const address = parts[1];
    const match = address?.match(/:(\d+)$/);
    const state = protocol === 'TCP' ? parts[3] : 'UNCONN';
    const pid = Number(protocol === 'TCP' ? parts[4] : parts[3]);
    if (!match || !Number.isInteger(pid) || (!all && protocol === 'TCP' && state !== 'LISTENING')) continue;
    entries.push({ protocol, port: Number(match[1]), address, state: state === 'LISTENING' ? 'LISTEN' : state, pid, process: '' });
  }
  return entries;
}

export async function getPorts({ all = false, protocol, port } = {}) {
  let entries;
  if (process.platform === 'win32') {
    const { stdout } = await run('netstat', ['-ano'], { maxBuffer: 16 * 1024 * 1024 });
    entries = parseNetstat(stdout, { all });
    try {
      const { stdout: tasks } = await run('tasklist', ['/FO', 'CSV', '/NH'], { maxBuffer: 16 * 1024 * 1024 });
      const names = new Map();
      for (const line of tasks.split(/\r?\n/)) {
        const match = line.match(/^"((?:[^"]|"")*)","(\d+)"/);
        if (match) names.set(Number(match[2]), match[1].replace(/""/g, '"'));
      }
      for (const entry of entries) entry.process = names.get(entry.pid) || '';
    } catch { /* Process names are optional when tasklist is unavailable. */ }
  } else {
    try {
      const { stdout } = await run('lsof', ['-nP', '-i', '-F', 'pcfPnT'], { maxBuffer: 16 * 1024 * 1024 });
      entries = parseLsof(stdout, { all });
    } catch (error) {
      if (error.code === 1 && !error.stderr) entries = parseLsof(error.stdout || '', { all });
      else if (error.code === 'ENOENT') throw new Error('lsof was not found. Install lsof and try again.');
      else throw error;
    }
  }
  return entries.filter(entry => (!protocol || entry.protocol === protocol.toUpperCase()) && (port === undefined || entry.port === port))
    .sort ( (a, b) => a.port - b.port || a.protocol.localeCompare(b.protocol) || a.pid - b.pid );
}
