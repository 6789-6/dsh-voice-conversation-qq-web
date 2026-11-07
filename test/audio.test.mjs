import test from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { mkdtemp, readFile, readdir } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceServices, speechToFile, pruneAudio } from '../src/audio.js';

const wav = (() => {
  const b = Buffer.alloc(48);
  b.write('RIFF', 0); b.writeUInt32LE(40, 4); b.write('WAVEfmt ', 8);
  b.writeUInt32LE(16, 16); b.writeUInt16LE(1, 20); b.writeUInt16LE(1, 22);
  b.writeUInt32LE(16000, 24); b.writeUInt32LE(32000, 28);
  b.writeUInt16LE(2, 32); b.writeUInt16LE(16, 34);
  b.write('data', 36); b.writeUInt32LE(4, 40);
  return b;
})();

async function server(handler) {
  const s = createServer(handler);
  await new Promise(resolve => s.listen(0, '127.0.0.1', resolve));
  return { url: `http://127.0.0.1:${s.address().port}`, close: () => new Promise(resolve => s.close(resolve)) };
}

test('ASR accepts bounded WAV and keeps token out of result', async () => {
  let calls = 0;
  const svc = await server(async (req, res) => {
    calls++;
    assert.equal(req.headers.authorization, 'Bearer test-secret');
    assert.equal(req.headers['content-type'], 'audio/wav');
    for await (const _ of req) {}
    res.setHeader('content-type', 'application/json');
    res.end(JSON.stringify({ text: '今天好吗？' }));
  });
  try {
    const voice = new VoiceServices({ asrUrl: `${svc.url}/asr`, asrToken: 'test-secret' });
    assert.deepEqual(await voice.transcribe(wav), { text: '今天好吗？' });
    await assert.rejects(voice.transcribe(Buffer.from('not audio')), /invalid wav/i);
    assert.equal(calls, 1);
  } finally { await svc.close(); }
});

test('TTS returns bounded WAV, stores it privately, and expires files', async () => {
  const svc = await server(async (req, res) => {
    assert.equal(req.headers.authorization, 'Bearer test-secret');
    const chunks = []; for await (const c of req) chunks.push(c);
    const body = JSON.parse(Buffer.concat(chunks).toString());
    assert.equal(body.input, '你好');
    assert.equal(body.response_format, 'wav');
    res.setHeader('content-type', 'audio/wav'); res.end(wav);
  });
  const dir = await mkdtemp(join(tmpdir(), 'voice-plugin-test-'));
  try {
    const voice = new VoiceServices({ ttsUrl: `${svc.url}/tts`, ttsToken: 'test-secret', voice: 'sample' });
    const out = await speechToFile(voice, '你好', dir);
    assert.equal(out.status, 'synthesized');
    assert.deepEqual(await readFile(out.path), wav);
    await pruneAudio(dir, { now: Date.now() + 24 * 60 * 60 * 1000, maxAgeMs: 1000 });
    assert.equal((await readdir(dir)).length, 0);
  } finally { await svc.close(); }
});

test('service errors do not masquerade as a sent voice message', async () => {
  const svc = await server((_req, res) => { res.writeHead(502); res.end('provider unavailable'); });
  try {
    const voice = new VoiceServices({ ttsUrl: `${svc.url}/tts` });
    await assert.rejects(voice.synthesize('你好'), /tts unavailable/i);
  } finally { await svc.close(); }
});
