import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { loadBridgeConfig } from '../bin/voice-bridge.js';

test('bridge config reads private files without embedding account IDs or credentials in the package', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'bridge-config-'));
  const up = join(dir, 'up'); const down = join(dir, 'down'); const users = join(dir, 'users');
  await writeFile(up, 'up-secret\n'); await writeFile(down, 'down-secret\n');
  await writeFile(users, '10001\n10002\n');
  const value = loadBridgeConfig({ VOICE_BRIDGE_UPSTREAM_URL: 'ws://127.0.0.1:9001',
    VOICE_BRIDGE_UPSTREAM_TOKEN_FILE: up, VOICE_BRIDGE_DOWNSTREAM_TOKEN_FILE: down,
    VOICE_BRIDGE_ALLOWED_SENDERS_FILE: users, VOICE_BRIDGE_ASR_URL: 'http://127.0.0.1:9002/asr' });
  assert.deepEqual(value.allowedSenders, ['10001', '10002']);
  assert.equal(value.upstreamToken, 'up-secret');
  assert.equal(value.downstreamToken, 'down-secret');
  assert.equal(value.host, '127.0.0.1');
  assert.equal(value.port, 3092);
});
