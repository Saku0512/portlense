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
