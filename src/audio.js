import { randomUUID } from 'node:crypto';
import { mkdir, readdir, stat, unlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

export const MAX_WAV_BYTES = 2 * 1024 * 1024;
export const MAX_SPEECH_BYTES = 5 * 1024 * 1024;
export const MAX_TEXT_CHARS = 180;

export function validWav(data, limit = MAX_WAV_BYTES) {
  return Buffer.isBuffer(data) && data.length >= 44 && data.length <= limit &&
    data.toString('ascii', 0, 4) === 'RIFF' && data.toString('ascii', 8, 12) === 'WAVE';
}

function endpoint(value) {
  if (!value) return '';
  const parsed = new URL(value);
  if (!['http:', 'https:'].includes(parsed.protocol) || parsed.username || parsed.password) {
    throw new Error('invalid voice endpoint');
  }
  return parsed.href;
}

async function readBounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) throw new Error('empty voice response');
  const chunks = [];
  let size = 0;
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('voice response too large');
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks);
}

export class VoiceServices {
  constructor({ asrUrl = '', ttsUrl = '', asrToken = '', ttsToken = '', voice = '', model = '',
    timeoutMs = 30000, fetchImpl = fetch } = {}) {
    this.asrUrl = endpoint(asrUrl);
    this.ttsUrl = endpoint(ttsUrl);
    this.asrToken = asrToken;
    this.ttsToken = ttsToken;
    this.voice = voice;
    this.model = model;
    this.timeoutMs = Math.max(1000, Math.min(150000, timeoutMs));
    this.fetch = fetchImpl;
  }

  async transcribe(wav) {
    if (!validWav(wav)) throw new Error('invalid wav');
    if (!this.asrUrl) throw new Error('asr unavailable');
    const headers = { 'content-type': 'audio/wav' };
    if (this.asrToken) headers.authorization = `Bearer ${this.asrToken}`;
    const response = await this.fetch(this.asrUrl, {
      method: 'POST', headers, body: wav, signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error('asr unavailable');
    const result = await response.json();
    const text = result?.text;
    if (typeof text !== 'string' || !text.trim() || text.length > 1000) throw new Error('invalid transcript');
    return { text: text.trim() };
  }

  async synthesize(text) {
    const input = String(text ?? '').trim();
    if (!input || input.length > MAX_TEXT_CHARS || input.includes('\0')) throw new Error('invalid speech text');
    if (!this.ttsUrl) throw new Error('tts unavailable');
    const body = { input, response_format: 'wav' };
    if (this.voice) body.voice = this.voice;
    if (this.model) body.model = this.model;
    const headers = { 'content-type': 'application/json', accept: 'audio/wav' };
    if (this.ttsToken) headers.authorization = `Bearer ${this.ttsToken}`;
    const response = await this.fetch(this.ttsUrl, {
      method: 'POST', headers, body: JSON.stringify(body), signal: AbortSignal.timeout(this.timeoutMs),
    });
    if (!response.ok) throw new Error('tts unavailable');
    const bytes = await readBounded(response, MAX_SPEECH_BYTES);
    if (!validWav(bytes, MAX_SPEECH_BYTES)) throw new Error('invalid speech audio');
    return bytes;
  }
}

export async function speechToFile(services, text, dir) {
  const bytes = await services.synthesize(text);
  await mkdir(dir, { recursive: true, mode: 0o700 });
  const target = join(dir, `voice-${randomUUID()}.wav`);
  await writeFile(target, bytes, { flag: 'wx', mode: 0o600 });
  return { status: 'synthesized', path: target, bytes: bytes.length };
}

export async function pruneAudio(dir, { now = Date.now(), maxAgeMs = 60 * 60 * 1000 } = {}) {
  let names;
  try { names = await readdir(dir); } catch (error) {
    if (error?.code === 'ENOENT') return 0;
    throw error;
  }
  let removed = 0;
  for (const name of names) {
    if (!/^voice-[0-9a-f-]{36}\.wav$/.test(name)) continue;
    const file = join(dir, name);
    try {
      if ((await stat(file)).mtimeMs <= now - maxAgeMs) { await unlink(file); removed++; }
    } catch (error) { if (error?.code !== 'ENOENT') throw error; }
  }
  return removed;
}
