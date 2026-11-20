import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { getPorts, parseLsof, parseNetstat } from '../src/index.js';

const lsof = `p123\ncmy server\nf3\nPTCP\nn*:3000\nTST=LISTEN\nf4\nPTCP\nn127.0.0.1:4000->127.0.0.1:443\nTST=ESTABLISHED\np456\ncdaemon\nf5\nPUDP\nn[::1]:5353\n`;
test('parses listening TCP and UDP, with optional connections', () => {
  const entries = parseLsof(lsof);
  assert.deepEqual(entries.map(e => [e.port, e.protocol, e.process]), [[3000, 'TCP', 'my server'], [5353, 'UDP', 'daemon']]);
  assert.equal(parseLsof(lsof, { all: true }).length, 3);
});
test('parses Windows netstat output', () => {
  const entries = parseNetstat('  TCP  0.0.0.0:80  0.0.0.0:0  LISTENING  12\n  UDP  [::]:5353  *:*  34\n  TCP  127.0.0.1:5000  127.0.0.1:80  ESTABLISHED  12');
  assert.deepEqual(entries.map(e => [e.port, e.state, e.pid]), [[80, 'LISTEN', 12], [5353, 'UNCONN', 34]]);
});
test('CLI rejects invalid arguments', () => {
  for (const args of [['--port', '0'], ['--pid', '-1'], ['--interval', '1'], ['--watch', '--interval', '0'], ['--sort', 'address'], ['--color', 'invalid']]) {
    assert.throws(() => execFileSync(process.execPath, ['bin/portlense.js', ...args], { stdio: 'pipe' }));
  }
});
test('CLI finds a real listening server', async (t) => {
  if (process.platform === 'win32') return t.skip('integration test requires lsof');
  try { execFileSync('lsof', ['-v'], { stdio: 'ignore' }); } catch { return t.skip('lsof unavailable'); }
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const child = spawn(process.execPath, ['bin/portlense.js', '--json', '--port', String(port)]);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  const code = await new Promise(resolve => child.on('close', resolve));
  assert.equal(code, 0);
  assert.ok(JSON.parse(output).some(entry => entry.port === port && entry.pid === process.pid));
  const ownEntry = JSON.parse(output).find(entry => entry.pid === process.pid);
  assert.ok(ownEntry.process);
  const matching = await getPorts({ port, pid: process.pid, process: ownEntry.process.toUpperCase() });
  assert.ok(matching.some(entry => entry.pid === process.pid));
  assert.deepEqual(await getPorts({ port, process: 'unlikely-process-name-xyz' }), []);
  assert.deepEqual(await getPorts({ port, pid: 999999999 }), []);
  assert.ok((await getPorts({ port, state: 'listen', sort: 'process' })).some(entry => entry.pid === process.pid));
  assert.deepEqual(await getPorts({ port, state: 'not-a-state' }), []);
  const colored = execFileSync(process.execPath, ['bin/portlense.js', '--port', String(port), '--color', 'always'], { encoding: 'utf8' });
  assert.match(colored, /\x1b\[/);
  const plain = execFileSync(process.execPath, ['bin/portlense.js', '--port', String(port), '--color', 'never'], { encoding: 'utf8' });
  assert.doesNotMatch(plain, /\x1b\[/);
  const json = execFileSync(process.execPath, ['bin/portlense.js', '--port', String(port), '--color', 'always', '--json'], { encoding: 'utf8' });
  assert.ok(JSON.parse(json).some(entry => entry.port === port));

  const watch = spawn(process.execPath, ['bin/portlense.js', '--watch', '--interval', '0.1', '--json', '--port', String(port)]);
  t.after(() => watch.kill());
  let stream = '';
  await new Promise((resolve, reject) => {
    const timeout = setTimeout(() => reject(new Error('watch did not produce two snapshots')), 5000);
    watch.on('error', reject);
    watch.stdout.on('data', chunk => {
      stream += chunk;
      if (stream.trim().split('\n').length >= 2 && stream.endsWith('\n')) {
        clearTimeout(timeout);
        resolve();
      }
    });
  });
  watch.kill();
  const snapshots = stream.trim().split('\n').map(line => JSON.parse(line));
  assert.ok(snapshots.slice(0, 2).every(snapshot => snapshot.some(entry => entry.port === port)));

});

test('bind checks, port search, and process details', async (t) => {
  const { checkPort, findPort } = await import('../src/index.js');
  const { createSocket } = await import('node:dgram');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  assert.equal(await checkPort(port), false);
  assert.equal(await findPort({ from: port, to: port }), null);
  const child = spawn(process.execPath, ['bin/portlense.js', 'check', String(port), '--json']);
  let output = '';
  child.stdout.on('data', chunk => { output += chunk; });
  assert.equal(await new Promise(resolve => child.on('close', resolve)), 1);
  assert.equal(JSON.parse(output).available, false);
  if (process.platform !== 'win32') {
    const details = await getPorts({ port, details: true });
    const own = details.find(entry => entry.pid === process.pid);
    assert.ok(own?.user);
    assert.ok(own?.command);
  }
  const udp = createSocket('udp4');
  await new Promise(resolve => udp.bind(0, '127.0.0.1', resolve));
  t.after(() => udp.close());
  assert.equal(await checkPort(udp.address().port, { protocol: 'udp' }), false);
});

test('watch differences account for duplicate sockets', async () => {
  const { diffPorts } = await import('../src/index.js');
  const entry = { protocol: 'TCP', port: 3000, address: '*:3000', state: 'LISTEN', pid: 1, process: 'node' };
  assert.deepEqual(diffPorts([entry, entry], [entry]), { added: [], removed: [entry] });
  assert.deepEqual(diffPorts([entry], [entry, entry]), { added: [entry], removed: [] });
});

test('config defaults can be overridden by CLI options', async (t) => {
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'portlense-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'config.json');
  await writeFile(config, JSON.stringify({ color: 'always', sort: 'pid', interval: 1 }));
  const output = execFileSync(process.execPath, ['bin/portlense.js', '--config', config, '--color', 'never'], { encoding: 'utf8' });
  assert.doesNotMatch(output, /\x1b\[/);
  await writeFile(config, '{"sort":"invalid"}');
  assert.throws(() => execFileSync(process.execPath, ['bin/portlense.js', '--config', config], { stdio: 'pipe' }));
});

test('TUI renders selection and sanitizes process data', async () => {
  const { renderTui } = await import('../src/tui.js');
  const output = renderTui({
    entries: [{ port: 3000, protocol: 'TCP', state: 'LISTEN', pid: 12, process: 'node', address: '127.0.0.1:3000', user: 'me', command: 'node\x1b[2Jserver.js' }],
    selected: 0, protocol: '', all: false, query: '', editing: false, error: '', updated: 'now', color: false,
  });
  assert.match(output, /› 3000/);
  assert.match(output, /127\.0\.0\.1:3000/);
  assert.doesNotMatch(output, /\x1b/);
});

test('TUI requires a terminal', () => {
  assert.throws(() => execFileSync(process.execPath, ['bin/portlense.js', '--tui'], { stdio: 'pipe' }), /interactive terminal/);
});

test('TUI uses the terminal width and anchors details at the bottom', async () => {
  const { renderTui } = await import('../src/tui.js');
  const entry = { port: 3000, protocol: 'TCP', state: 'LISTEN', pid: 12, process: 'node', address: '127.0.0.1:3000', user: 'me', command: 'node server.js' };
  const view = renderTui({ entries: [entry], selected: 0, protocol: '', all: false, query: '', editing: false, error: '', updated: 'now', color: false, width: 100, height: 20 });
  const lines = view.split('\r\n');
  assert.equal(lines.length, 20);
  assert.match(lines[2], /ADDRESS/);
  assert.match(lines[3], /127\.0\.0\.1:3000/);
  assert.ok(lines.some(line => /DETAILS/.test(line)));
  assert.match(lines.join(' '), /\[q\] Quit/);
  assert.match(lines.join(' '), /\[\/\] Search/);
  assert.ok(lines.every(line => line.length <= 99));
});


test('TUI shows search editing shortcuts and wraps help in narrow terminals', async () => {
  const { renderTui } = await import('../src/tui.js');
  const base = { entries: [], selected: 0, protocol: '', all: false, query: '', error: '', updated: '', color: false, width: 50, height: 20 };
  const editing = renderTui({ ...base, editing: true });
  assert.match(editing, /\[Enter\] Finish search/);
  const normal = renderTui({ ...base, editing: false });
  assert.match(normal, /\[\/\] Search/);
  assert.match(normal, /\[q\] Quit/);
});

test('watchPorts reports actual changes and stops on abort', async (t) => {
  if (process.platform !== 'win32') {
    try { execFileSync('lsof', ['-v'], { stdio: 'ignore' }); } catch { return t.skip('lsof unavailable'); }
  }
  const { watchPorts } = await import('../src/index.js');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const port = server.address().port;
  const controller = new AbortController();
  const watcher = watchPorts({ port, interval: 100, signal: controller.signal });
  t.after(() => { controller.abort(); server.close(); });
  const initial = (await watcher.next()).value;
  assert.ok(initial.current.some(entry => entry.port === port));
  assert.deepEqual(initial.added, []);
  assert.deepEqual(initial.removed, []);
  initial.current.length = 0;
  await new Promise(resolve => server.close(resolve));
  const changed = (await watcher.next()).value;
  assert.ok(changed.removed.some(entry => entry.port === port));
  const next = watcher.next();
  controller.abort();
  assert.equal((await next).done, true);
});

test('API rejects invalid options and invalid watch intervals', async () => {
  const { watchPorts } = await import('../src/index.js');
  await assert.rejects(getPorts({ protocol: 'invalid' }), /Protocol/);
  await assert.rejects(getPorts({ port: 0 }), /Port/);
  await assert.rejects(getPorts({ sort: 'invalid' }), /sort/);
  await assert.rejects(watchPorts({ interval: 1 }).next(), /Interval/);
  const controller = new AbortController();
  controller.abort();
  assert.equal((await watchPorts({ signal: controller.signal }).next()).done, true);
});

test('API exposes conflict inspection and table formatting', async (t) => {
  const { inspectPort, formatPorts } = await import('../src/index.js');
  const server = createServer();
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => server.close());
  const port = server.address().port;
  const inspection = await inspectPort(port);
  assert.equal(inspection.available, false);
  assert.equal(inspection.protocol, 'TCP');
  if (process.platform !== 'win32') assert.ok(inspection.conflicts.some(entry => entry.pid === process.pid));
  const entry = { port, protocol: 'TCP', state: 'LISTEN', pid: 42, process: 'node', address: '*:' + port, user: 'me', command: 'node server.js' };
  const table = formatPorts([entry], { color: true, details: true, changes: { added: [entry], removed: [] } });
  assert.match(table, /\x1b\[/);
  assert.match(table, /COMMAND/);
  assert.match(table, /node server\.js/);
  assert.match(table, /\+/);
});

test('API configuration loading validates explicit files', async (t) => {
  const { loadConfig } = await import('../src/index.js');
  const { mkdtemp, writeFile, rm } = await import('node:fs/promises');
  const { tmpdir } = await import('node:os');
  const { join } = await import('node:path');
  const dir = await mkdtemp(join(tmpdir(), 'portlense-api-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const config = join(dir, 'config.json');
  await writeFile(config, '{"interval":1,"color":"never"}');
  assert.deepEqual(await loadConfig(config), { interval: 1, color: 'never' });
  await assert.rejects(loadConfig(join(dir, 'missing.json')), /Cannot load config/);
  await writeFile(config, '{"unknown":true}');
  await assert.rejects(loadConfig(config), /Invalid config option/);
});


test('search, service labels, and sound alerts', async (t) => {
  const { getServiceName, alertPortChanges } = await import('../src/index.js');
  assert.equal(getServiceName(443, 'tcp'), 'HTTPS');
  assert.equal(getServiceName(22, 'udp'), '');
  assert.throws(() => getServiceName(0), /Port/);
  let output = '';
  const stream = { write: value => { output += value; } };
  assert.equal(alertPortChanges({ added: [], removed: [] }, { stream }), false);
  assert.equal(alertPortChanges({ added: [{}], removed: [] }, { stream }), true);
  assert.equal(output, '\x07');
  if (process.platform !== 'win32') {
    const server = createServer();
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    t.after(() => server.close());
    const port = server.address().port;
    const ports = await getPorts({ search: String(port) });
    assert.ok(ports.some(entry => entry.port === port && entry.pid === process.pid));
    assert.ok(ports.every(entry => typeof entry.service === 'string'));
  }
});

test('stopPortProcess validates and stops only the selected child process', async (t) => {
  if (process.platform === 'win32') return t.skip('lsof integration test');
  const { stopPortProcess } = await import('../src/index.js');
  await assert.rejects(stopPortProcess({ pid: 1 }), /protected/);
  const child = spawn(process.execPath, ['-e', "require('node:net').createServer().listen(0, '127.0.0.1', function(){ console.log(this.address().port) })"], { stdio: ['ignore', 'pipe', 'pipe'] });
  t.after(() => { if (child.exitCode === null && child.signalCode === null) child.kill(); });
  const port = await new Promise((resolve, reject) => {
    child.stdout.once('data', data => resolve(Number(data.toString().trim())));
    child.once('error', reject);
  });
  const entry = (await getPorts({ port, pid: child.pid }))[0];
  assert.ok(entry);
  await assert.rejects(stopPortProcess({ ...entry, address: 'invalid:1234' }), /changed/);
  const ended = new Promise(resolve => child.once('exit', (code, signal) => resolve({ code, signal })));
  await stopPortProcess(entry);
  assert.equal((await ended).signal, 'SIGTERM');
});
