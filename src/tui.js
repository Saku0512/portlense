import { getPorts } from './index.js';

const ESC = '\x1b[';
const clean = value => String(value ?? '').replace(/[\x00-\x1f\x7f-\x9f]/g, ' ');
const truncate = (value, width) => {
  const text = clean(value);
  if (width <= 0) return '';
  return text.length <= width ? text : text.slice(0, Math.max(0, width - 1)) + '…';
};

export function renderTui({ entries, selected, protocol, all, query, editing, error, updated, width = 80, height = 24, color = true }) {
  const paint = (code, value) => color ? `${ESC}${code}m${value}${ESC}0m` : value;
  const columns = Math.max(1, width - 1);
  const line = value => truncate(value, columns);
  const pad = (value, size) => truncate(value, size).padEnd(size);
  const current = entries[selected];
  const details = current ? [
    `Address  ${clean(current.address)}`,
    `User     ${clean(current.user || '-')}`,
    `Command  ${clean(current.command || '-')}`,
  ] : ['Select a socket to see its details.'];
  const detailLines = [];
  for (const detail of details) {
    if (columns < 10) { detailLines.push(line(detail)); continue; }
    let remaining = detail;
    while (remaining.length > columns && detailLines.length < 4) {
      detailLines.push(remaining.slice(0, columns));
      remaining = '         ' + remaining.slice(columns);
    }
    detailLines.push(line(remaining));
  }
  const shortcuts = editing
    ? [['Enter', 'Finish search'], ['Esc', 'Finish search'], ['Backspace', 'Delete']]
    : [['↑/↓', 'Select'], ['/', 'Search'], ['p', 'Protocol'], ['a', 'TCP mode'], ['r', 'Refresh'], ['q', 'Quit']];
  const helpLines = [];
  let helpLine = '';
  for (const [key, label] of shortcuts) {
    const item = `[${key}] ${label}`;
    if (helpLine && helpLine.length + 3 + item.length > columns) { helpLines.push(line(helpLine)); helpLine = ''; }
    helpLine += (helpLine ? '   ' : '') + item;
  }
  if (helpLine) helpLines.push(line(helpLine));
  const footer = [
    paint('1;36', line(' DETAILS '.padEnd(columns, '─'))),
    ...detailLines.map(line),
    ...(error ? [paint('31', line(`Error: ${error}`))] : []),
    ...helpLines.map(text => paint('36', text)),
  ];
  const header = [
    paint('1;36', line(' PORTLENSE  ·  LIVE PORT MONITOR '.padEnd(columns, '─'))),
    line(`Protocol: ${protocol || 'ALL'}   TCP: ${all ? 'all connections' : 'listening'}   Search: ${query || '(none)'}${editing ? ' _' : ''}   ${entries.length} sockets   ${updated || 'Loading…'}`),
  ];
  const showAddress = columns >= 76;
  const fixed = 2 + 7 + 7 + 13 + 8;
  const remaining = Math.max(4, columns - fixed);
  const processWidth = showAddress ? Math.max(8, Math.min(22, Math.floor(remaining * 0.32))) : remaining;
  const addressWidth = showAddress ? Math.max(0, remaining - processWidth - 1) : 0;
  const formatRow = (marker, port, proto, state, pid, processName, address) => line(
    `${marker} ${pad(port, 7)}${pad(proto, 7)}${pad(state, 13)}${pad(pid, 8)}${pad(processName, processWidth)}${showAddress ? ` ${pad(address, addressWidth)}` : ''}`
  );
  header.push(paint('1', formatRow(' ', 'PORT', 'PROTO', 'STATE', 'PID', 'PROCESS', 'ADDRESS')));
  const availableRows = Math.max(0, height - header.length - footer.length);
  const start = Math.max(0, Math.min(selected - availableRows + 1, Math.max(0, entries.length - availableRows)));
  const rows = [];
  for (let i = start; i < Math.min(entries.length, start + availableRows); i++) {
    const e = entries[i];
    const row = formatRow(i === selected ? '›' : ' ', e.port, e.protocol, e.state || '-', e.pid, e.process || '-', e.address || '-');
    rows.push(i === selected ? paint('7', row.padEnd(columns)) : row);
  }
  if (!entries.length && availableRows) rows.push(line(error ? 'Unable to load ports.' : 'No matching ports.'));
  while (rows.length < availableRows) rows.push('');
  return [...header, ...rows, ...footer].slice(0, Math.max(0, height)).join('\r\n');
}

export async function runTui(options = {}) {
  if (options.interval !== undefined && (!Number.isFinite(options.interval) || options.interval < 100 || options.interval > 86400000)) throw new RangeError('Interval must be between 100 and 86400000 milliseconds.');
  if (!process.stdin.isTTY || !process.stdout.isTTY || typeof process.stdin.setRawMode !== 'function') throw new Error('TUI requires an interactive terminal.');
  const input = process.stdin;
  const output = process.stdout;
  const originalRaw = input.isRaw;
  let entries = [], selected = 0, protocol = options.protocol?.toUpperCase() || '', all = !!options.all;
  let query = options.process || '', editing = false, error = '', updated = '', stopped = false, pending = false, queued = false;
  const color = options.color === 'always' || (options.color !== 'never' && !('NO_COLOR' in process.env));
  const render = () => {
    if (stopped) return;
    output.write(`${ESC}H${ESC}2J${renderTui({ entries, selected, protocol, all, query, editing, error, updated, width: output.columns || 80, height: output.rows || 24, color })}`);
  };
  const refresh = async () => {
    if (pending) { queued = true; return; }
    pending = true;
    try {
      const result = await getPorts({ ...options, protocol: protocol || undefined, all, process: query || undefined, details: true });
      if (!stopped) { entries = result; selected = Math.max(0, Math.min(selected, entries.length - 1)); error = ''; updated = new Date().toLocaleTimeString(); }
    } catch (err) { if (!stopped) error = err.message; }
    finally {
      pending = false;
      if (!stopped) render();
      if (queued && !stopped) { queued = false; void refresh(); }
    }
  };
  await new Promise((resolve, reject) => {
    let timer;
    const cleanup = () => {
      if (stopped) return;
      stopped = true;
      clearInterval(timer);
      input.off('data', onData);
      output.off('resize', render);
      process.off('SIGINT', onSignal);
      process.off('SIGTERM', onSignal);
      try { input.setRawMode(!!originalRaw); input.pause(); output.write(`${ESC}?25h${ESC}?1049l`); } catch { /* Terminal may already be closed. */ }
    };
    const finish = () => { cleanup(); resolve(); };
    const onSignal = () => finish();
    const handleKey = key => {
      if (key === '\u0003') return finish();
      if (editing) {
        if (key === '\r' || key === '\n' || key === '\u001b') editing = false;
        else if (key === '\u007f' || key === '\b') query = query.slice(0, -1);
        else if (!/[\x00-\x1f\x7f-\x9f]/.test(key)) query += key;
        selected = 0;
        render();
        void refresh();
      } else if (key === 'q' || key === 'Q') finish();
      else if (key === '\u001b[A' || key === 'k') { selected = Math.max(0, selected - 1); render(); }
      else if (key === '\u001b[B' || key === 'j') { selected = Math.min(Math.max(0, entries.length - 1), selected + 1); render(); }
      else if (key === '/') { editing = true; render(); }
      else if (key === 'p') { protocol = protocol === '' ? 'TCP' : protocol === 'TCP' ? 'UDP' : ''; selected = 0; void refresh(); }
      else if (key === 'a') { all = !all; selected = 0; void refresh(); }
      else if (key === 'r') void refresh();
    };
    const onData = buffer => {
      const keys = buffer.toString().match(/\x1b\[[AB]|[\s\S]/gu) || [];
      for (const key of keys) { if (stopped) break; handleKey(key); }
    };
    try {
      output.write(`${ESC}?1049h${ESC}?25l`);
      input.setRawMode(true);
      input.resume();
      input.on('data', onData);
      output.on('resize', render);
      process.on('SIGINT', onSignal);
      process.on('SIGTERM', onSignal);
      timer = setInterval(() => void refresh(), options.interval ?? 2000);
      render();
      void refresh();
    } catch (err) { cleanup(); reject(err); }
  });
}
