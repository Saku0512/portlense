import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawn } from 'node:child_process';
import { createServer } from 'node:net';
import { parseLsof, parseNetstat } from '../src/index.js';

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
  assert.throws(() => execFileSync(process.execPath, ['bin/portlense.js', '--port', '0'], { stdio: 'pipe' }));
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
});
