import { getPorts } from './index.js';

// Recheck the selected socket immediately before sending the termination signal.
export async function stopPortProcess(entry) {
  if (!entry || !Number.isSafeInteger(entry.pid) || entry.pid <= 1 || entry.pid === process.pid) throw new Error('Invalid or protected process ID.');
  if (!Number.isInteger(entry.port) || !['TCP', 'UDP'].includes(entry.protocol) || typeof entry.address !== 'string' || typeof entry.process !== 'string') throw new TypeError('A valid port entry is required.');
  const current = await getPorts({ pid: entry.pid, port: entry.port, protocol: entry.protocol, all: true });
  if (!current.some(item => item.address === entry.address && item.process === entry.process && item.state === entry.state)) throw new Error('The selected socket or process has changed; refresh and try again.');
  process.kill(entry.pid, 'SIGTERM');
}

// The terminal bell is opt-in and may be disabled by terminal settings.
export function alertPortChanges(changes, { stream = process.stdout } = {}) {
  if (!changes || !Array.isArray(changes.added) || !Array.isArray(changes.removed)) throw new TypeError('Changes must include added and removed arrays.');
  if (changes.added.length || changes.removed.length) { stream.write('\x07'); return true; }
  return false;
}
