export function formatPorts(entries, { color: useColor = false, details = false, changes = null } = {}) {
  const color = (code, value) => useColor ? `\x1b[${code}m${value}\x1b[0m` : value;
  if (!entries.length && !changes?.removed.length) return 'No matching ports found.';
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
  const lines = [format(headers, headers.map(() => '1;36')), color('2', format(widths.map(width => '─'.repeat(width))))];
  for (const row of rows) {
    const offset = changes ? 1 : 0;
    const stateColor = row[offset + 3] === 'LISTEN' ? '32' : row[offset + 3] === 'UNCONN' ? '33' : '36';
    const codes = ['1', row[offset + 1] === 'TCP' ? '34' : '35', '', stateColor, '2', ''];
    if (changes) codes.unshift(row[0] === '+' ? '32' : row[0] === '-' ? '31' : '');
    lines.push(format(row, codes));
  }
  return lines.join('\n');
}

