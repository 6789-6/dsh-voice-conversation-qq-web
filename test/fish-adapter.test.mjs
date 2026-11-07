import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startFishAdapter } from '../examples/fish-tts-adapter.mjs';

test('Fish adapter keeps private values local and returns bounded WAV', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dsh-fish-test-'));
  const paths = { fish: join(dir, 'fish'), voice: join(dir, 'voice'), local: join(dir, 'local') };
  await Promise.all([writeFile(paths.fish, 'fish-test-key'), writeFile(paths.voice, 'private-voice-id'),
    writeFile(paths.local, 'adapter-test-key')]);
  const wav = Buffer.alloc(44);
  wav.write('RIFF', 0); wav.write('WAVE', 8);
  const calls = [];
  const server = await startFishAdapter({ env: {
    FISH_API_KEY_FILE: paths.fish, FISH_REFERENCE_ID_FILE: paths.voice,
    FISH_ADAPTER_TOKEN_FILE: paths.local, FISH_ADAPTER_PORT: '0', FISH_SPEED: '0.9',
  }, fetchImpl: async (url, options) => { calls.push({ url, options }); return new Response(wav); } });
  try {
    const url = `http://127.0.0.1:${server.address().port}/v1/audio/speech`;
    const denied = await fetch(url, { method: 'POST', body: '{}' });
    assert.equal(denied.status, 401);
    const sent = await fetch(url, { method: 'POST',
      headers: { authorization: 'Bearer adapter-test-key', 'content-type': 'application/json' },
      body: JSON.stringify({ input: '你好', response_format: 'wav' }),
    });
    assert.equal(sent.status, 200);
    assert.deepEqual(Buffer.from(await sent.arrayBuffer()), wav);
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, 'https://api.fish.audio/v1/tts');
    assert.equal(calls[0].options.headers.authorization, 'Bearer fish-test-key');
    assert.equal(calls[0].options.headers.model, 's2-pro');
    assert.deepEqual(JSON.parse(calls[0].options.body), {
      text: '你好', reference_id: 'private-voice-id', format: 'wav', prosody: { speed: 0.9 },
    });
  } finally {
    await new Promise(resolve => server.close(resolve));
    await rm(dir, { recursive: true, force: true });
  }
});
