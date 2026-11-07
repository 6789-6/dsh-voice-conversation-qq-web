#!/usr/bin/env node
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { WebSocket, WebSocketServer } from 'ws';
import { VoiceServices } from '../src/audio.js';
import { startVoiceBridge } from '../src/bridge.js';

function lines(path) {
  if (!path) throw new Error('bridge private file missing');
  return readFileSync(path, 'utf8').split(/\r?\n/).map(line => line.trim()).filter(Boolean);
}

function secret(path) {
  const items = lines(path);
  if (items.length !== 1) throw new Error('bridge credential invalid');
  return items[0];
}

export function loadBridgeConfig(env = process.env) {
  const allowedSenders = lines(env.VOICE_BRIDGE_ALLOWED_SENDERS_FILE);
  if (!allowedSenders.length || allowedSenders.some(id => !/^\d{4,20}$/.test(id))) {
    throw new Error('bridge sender allowlist invalid');
  }
  const port = Number(env.VOICE_BRIDGE_PORT ?? 3092);
  if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('bridge port invalid');
  return {
    upstreamUrl: env.VOICE_BRIDGE_UPSTREAM_URL,
    upstreamToken: secret(env.VOICE_BRIDGE_UPSTREAM_TOKEN_FILE),
    downstreamToken: secret(env.VOICE_BRIDGE_DOWNSTREAM_TOKEN_FILE),
    allowedSenders,
    host: env.VOICE_BRIDGE_HOST || '127.0.0.1',
    port,
    asrUrl: env.VOICE_BRIDGE_ASR_URL || '',
    asrToken: env.VOICE_BRIDGE_ASR_TOKEN_FILE ? secret(env.VOICE_BRIDGE_ASR_TOKEN_FILE) : '',
  };
}

async function main() {
  const config = loadBridgeConfig();
  const asr = config.asrUrl ? new VoiceServices({ asrUrl: config.asrUrl, asrToken: config.asrToken }) : null;
  const bridge = await startVoiceBridge({ WebSocket, WebSocketServer, ...config, asr });
  console.log('dsh-voice bridge ready');
  const stop = async () => { await bridge.close(); process.exit(0); };
  process.once('SIGINT', stop);
  process.once('SIGTERM', stop);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch(error => { console.error(`dsh-voice bridge failed: ${error.message}`); process.exitCode = 1; });
}
