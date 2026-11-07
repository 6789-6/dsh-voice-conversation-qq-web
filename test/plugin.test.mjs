import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { apply } from '../src/index.js';

const wav = (() => { const b = Buffer.alloc(48); b.write('RIFF', 0); b.write('WAVE', 8); return b; })();

test('host plugin registers authenticated-channel routes and synthesis tool', async () => {
  const calls = [];
  const server = createServer(async (req, res) => {
    calls.push({ path: req.url, auth: req.headers.authorization });
    for await (const _ of req) {}
    if (req.url === '/asr') { res.setHeader('content-type', 'application/json'); res.end('{"text":"识别成功"}'); }
    else { res.setHeader('content-type', 'audio/wav'); res.end(wav); }
  });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const dir = await mkdtemp(join(tmpdir(), 'voice-host-test-'));
  const tokenFile = join(dir, 'token');
  await writeFile(tokenFile, 'private-test-token\n', { mode: 0o600 });
  const routes = new Map(); const tools = new Map(); const cleanups = [];
  const ctx = {
    connection: { fetch: { register(route) { routes.set(route.path, route); return () => routes.delete(route.path); } } },
    tools: { register(tool) { tools.set(tool.name, tool); return () => tools.delete(tool.name); } },
    effect(callback) { cleanups.push(callback()); },
  };
  try {
    apply(ctx, { enabled: true, asrUrl: `http://127.0.0.1:${server.address().port}/asr`,
      ttsUrl: `http://127.0.0.1:${server.address().port}/tts`, asrTokenFile: tokenFile,
      ttsTokenFile: tokenFile, audioDir: dir });
    const asrRoute = routes.get('/api/dsh-voice/asr');
    const ttsRoute = routes.get('/api/dsh-voice/tts');
    assert.equal(asrRoute.requestBody, 'streaming');
    assert.equal(ttsRoute.requestBody, 'streaming');
    const asr = await asrRoute.fetch(new Request('http://localhost/api/dsh-voice/asr', {
      method: 'POST', headers: { 'content-type': 'audio/wav' }, body: wav,
    }));
    assert.equal(asr.status, 200);
    assert.deepEqual(await asr.json(), { text: '识别成功' });
    const invalid = await asrRoute.fetch(new Request('http://localhost/api/dsh-voice/asr', {
      method: 'POST', headers: { 'content-type': 'audio/wav' }, body: 'invalid',
    }));
    assert.equal(invalid.status, 422);
    const tts = await ttsRoute.fetch(new Request('http://localhost/api/dsh-voice/tts', {
      method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ text: '你好' }),
    }));
    assert.equal(tts.status, 200);
    assert.deepEqual(Buffer.from(await tts.arrayBuffer()), wav);
    const output = JSON.parse(await tools.get('voice_tts').execute({ text: '你好' }));
    assert.equal(output.status, 'synthesized');
    assert.deepEqual(await readFile(output.path), wav);
    assert.equal(calls.length, 3);
    assert.ok(calls.every(call => call.auth === 'Bearer private-test-token'));
    assert.equal(JSON.stringify(output).includes('private-test-token'), false);
  } finally {
    for (const cleanup of cleanups) if (typeof cleanup === 'function') cleanup();
    await new Promise(resolve => server.close(resolve));
  }
});
