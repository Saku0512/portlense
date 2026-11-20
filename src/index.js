import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { setTimeout as delay } from 'node:timers/promises';
import { getServiceName } from './services.js';

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

export async function getPorts({ all = false, protocol, port, pid, process: processFilter, state, sort = 'port', details = false, search } = {}) {
  if (protocol !== undefined && (typeof protocol !== 'string' || !['TCP', 'UDP'].includes(protocol.toUpperCase()))) throw new TypeError('Protocol must be TCP or UDP.');
  if (port !== undefined && (!Number.isInteger(port) || port < 1 || port > 65535)) throw new RangeError('Port must be an integer from 1 to 65535.');
  if (pid !== undefined && (!Number.isSafeInteger(pid) || pid < 1)) throw new RangeError('PID must be a positive integer.');
  if (!['port', 'protocol', 'pid', 'process', 'state'].includes(sort)) throw new TypeError('Invalid sort field.');
  if (typeof all !== 'boolean' || typeof details !== 'boolean') throw new TypeError('all and details must be booleans.');
  if (processFilter !== undefined && typeof processFilter !== 'string') throw new TypeError('Process filter must be a string.');
  if (state !== undefined && typeof state !== 'string') throw new TypeError('State filter must be a string.');
  if (search !== undefined && typeof search !== 'string') throw new TypeError('Search must be a string.');
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
  const filtered = entries.filter(entry => (!protocol || entry.protocol === protocol.toUpperCase())
    && (port === undefined || entry.port === port)
    && (pid === undefined || entry.pid === pid)
    && (!processFilter || entry.process.toLowerCase().includes(processFilter.toLowerCase()))
    && (!state || entry.state.toUpperCase() === state.toUpperCase())
    && (!search || String(entry.port).includes(search) || entry.process.toLowerCase().includes(search.toLowerCase())))
    .sort((a, b) => {
      const left = a[sort];
      const right = b[sort];
      const primary = typeof left === 'number' ? left - right : String(left ?? '').localeCompare(String(right ?? ''), undefined, { sensitivity: 'base' });
      return primary || a.port - b.port || a.protocol.localeCompare(b.protocol) || a.pid - b.pid;
    });
  const enriched = filtered.map(entry => ({ ...entry, service: getServiceName(entry.port, entry.protocol) }));
  return details ? addProcessDetails(enriched) : enriched;
}

/** Test whether a port can be bound on a particular local address right now. */
export async function checkPort(port, { protocol = 'TCP', host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('Port must be an integer from 1 to 65535.');
  if (typeof protocol !== 'string') throw new TypeError('Protocol must be TCP or UDP.');
  const type = protocol.toUpperCase();
  if (!['TCP', 'UDP'].includes(type)) throw new Error('Protocol must be TCP or UDP.');
  if (type === 'TCP') {
    const { createServer } = await import('node:net');
    return new Promise((resolve, reject) => {
      const server = createServer();
      server.once('error', error => error.code === 'EADDRINUSE' ? resolve(false) : reject(error));
      server.listen({ port, host, exclusive: true }, () => server.close(error => error ? reject(error) : resolve(true)));
    });
  }
  const { createSocket } = await import('node:dgram');
  const { isIP } = await import('node:net');
  const socket = createSocket(isIP(host) === 6 ? 'udp6' : 'udp4');
  return new Promise((resolve, reject) => {
    socket.once('error', error => { socket.close(); error.code === 'EADDRINUSE' ? resolve(false) : reject(error); });
    socket.bind({ port, address: host, exclusive: true }, () => socket.close(() => resolve(true)));
  });
}

export async function findPort({ from = 3000, to = 65535, protocol = 'TCP', host = '127.0.0.1' } = {}) {
  if (!Number.isInteger(from) || !Number.isInteger(to) || from < 1 || to > 65535 || from > to) throw new Error('Invalid port range.');
  for (let port = from; port <= to; port++) if (await checkPort(port, { protocol, host })) return port;
  return null;
}

async function addProcessDetails(entries) {
  const ids = [...new Set(entries.map(entry => entry.pid).filter(id => Number.isSafeInteger(id) && id > 0))];
  const details = new Map();
  if (ids.length && process.platform !== 'win32') {
    // One ps invocation avoids spawning a process for every socket.
    try {
      const { stdout } = await run('ps', ['-p', ids.join(','), '-o', 'pid=', '-o', 'user=', '-o', 'args='], { maxBuffer: 16 * 1024 * 1024 });
      for (const line of stdout.split(/\r?\n/)) {
        const match = line.match(/^\s*(\d+)\s+(\S+)\s*(.*)$/);
        if (match) details.set(Number(match[1]), { user: match[2], command: match[3] });
      }
    } catch { /* Process information may be unavailable or the process may have exited. */ }
  } else if (ids.length) {
    try {
      const script = '$ids=@(' + ids.join(',') + '); Get-CimInstance Win32_Process | Where-Object { $ids -contains $_.ProcessId } | ForEach-Object { $owner=Invoke-CimMethod -InputObject $_ -MethodName GetOwner; [PSCustomObject]@{pid=$_.ProcessId;user=$owner.User;command=$_.CommandLine} } | ConvertTo-Json -Compress';
      const { stdout } = await run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { maxBuffer: 16 * 1024 * 1024 });
      const result = JSON.parse(stdout || '[]');
      for (const item of Array.isArray(result) ? result : [result]) details.set(item.pid, { user: item.user || '', command: item.command || '' });
    } catch { /* Details are best effort on systems without access to process information. */ }
  }
  return entries.map(entry => ({ ...entry, user: details.get(entry.pid)?.user || '', command: details.get(entry.pid)?.command || '' }));
}

export function diffPorts(previous, current) {
  const key = entry => JSON.stringify([entry.protocol, entry.port, entry.address, entry.state, entry.pid, entry.process]);
  const count = entries => { const map = new Map(); for (const entry of entries) map.set(key(entry), (map.get(key(entry)) || 0) + 1); return map; };
  const difference = (left, right) => {
    const available = count(right);
    return left.filter(entry => { const k = key(entry); const n = available.get(k) || 0; if (!n) return true; available.set(k, n - 1); return false; });
  };
  return { added: difference(current, previous), removed: difference(previous, current) };
}

/** Poll port snapshots until the consumer stops or the signal is aborted. */
export async function* watchPorts({ interval = 2000, signal, ...options } = {}) {
  if (!Number.isFinite(interval) || interval < 100 || interval > 86400000) throw new RangeError('Interval must be between 100 and 86400000 milliseconds.');
  if (signal !== undefined && (typeof signal !== 'object' || signal === null || typeof signal.addEventListener !== 'function' || typeof signal.aborted !== 'boolean')) throw new TypeError('signal must be an AbortSignal.');
  let previous;
  while (!signal?.aborted) {
    const current = await getPorts(options);
    if (signal?.aborted) return;
    const changes = previous ? diffPorts(previous, current) : { added: [], removed: [] };
    // Retain a private copy so consumer mutations do not alter later comparisons.
    previous = current.map(entry => ({ ...entry }));
    yield { current, ...changes, timestamp: new Date().toISOString() };
    if (signal?.aborted) return;
    try { await delay(interval, undefined, { signal }); }
    catch (error) { if (error.name === 'AbortError' && signal?.aborted) return; throw error; }
  }
}

/** Check a binding and, when occupied, gather process information if available. */
export async function inspectPort(port, { protocol = 'TCP', host = '127.0.0.1' } = {}) {
  const available = await checkPort(port, { protocol, host });
  protocol = protocol.toUpperCase();
  let conflicts = [];
  if (!available) {
    try { conflicts = await getPorts({ port, protocol, details: true }); }
    catch { /* Binding results are still useful if process enumeration is unavailable. */ }
  }
  return { port, protocol, host, available, conflicts };
}

export { loadConfig } from './config.js';
export { formatPorts } from './format.js';
export { runTui } from './tui.js';

export { getServiceName } from './services.js';
export { stopPortProcess, alertPortChanges } from './actions.js';
