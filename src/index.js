import { readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { VoiceServices, MAX_WAV_BYTES, MAX_TEXT_CHARS, speechToFile, pruneAudio } from './audio.js';

let Schema;
let defineTool = definition => definition;
try { Schema = (await import('@deepseek-ai/schemastery')).default; }
catch { Schema = (await import('schemastery')).default; }
try {
  const module = await import('@deepseek-ai/dsh-tools');
  if (typeof module.defineTool === 'function') defineTool = module.defineTool;
} catch {}

export const name = 'dsh-voice-conversation-qq-web';
export const inject = ['tools', 'connection'];
export const Config = Schema?.object({
  enabled: Schema.boolean().default(true),
  asrUrl: Schema.string().default(''),
  ttsUrl: Schema.string().default(''),
  asrTokenFile: Schema.string().default(''),
  ttsTokenFile: Schema.string().default(''),
  voice: Schema.string().default(''),
  model: Schema.string().default(''),
  audioDir: Schema.string().default(''),
  timeoutMs: Schema.number().default(30000),
});

function credential(file) {
  if (!file) return '';
  const value = readFileSync(file, 'utf8').trim();
  if (!value || /[\r\n]/.test(value)) throw new Error('invalid voice credential');
  return value;
}

async function boundedBody(request, limit) {
  const reader = request.body?.getReader();
  if (!reader) throw new Error('empty body');
  const parts = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > limit) throw new Error('body too large');
      parts.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(parts);
}

const json = (status, value) => new Response(JSON.stringify(value), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' },
});

export function apply(ctx, config = {}) {
  if (config.enabled === false) return;
  const asrToken = credential(config.asrTokenFile);
  const ttsToken = credential(config.ttsTokenFile);
  const services = new VoiceServices({
    asrUrl: config.asrUrl, ttsUrl: config.ttsUrl, asrToken, ttsToken,
    voice: config.voice, model: config.model, timeoutMs: config.timeoutMs,
  });
  const audioDir = config.audioDir || join(tmpdir(), 'dsh-voice-conversation');

  ctx.connection.fetch.register({
    path: '/api/dsh-voice/asr', methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'audio/wav') {
        return json(415, { error: 'wav_required' });
      }
      try {
        const bytes = await boundedBody(request, MAX_WAV_BYTES);
        try { return json(200, await services.transcribe(bytes)); }
        catch (error) {
          return json(error.message === 'invalid wav' ? 422 : 502,
            { error: error.message === 'invalid wav' ? 'invalid_wav' : 'asr_unavailable' });
        }
      } catch { return json(413, { error: 'invalid_size' }); }
    },
  });

  ctx.connection.fetch.register({
    path: '/api/dsh-voice/tts', methods: ['POST'], requestBody: 'streaming',
    async fetch(request) {
      if (request.headers.get('content-type')?.split(';', 1)[0]?.trim() !== 'application/json') {
        return json(415, { error: 'json_required' });
      }
      let text;
      try { text = JSON.parse((await boundedBody(request, 4096)).toString()).text; }
      catch { return json(400, { error: 'invalid_request' }); }
      if (typeof text !== 'string' || !text.trim() || text.length > MAX_TEXT_CHARS) {
        return json(422, { error: 'invalid_text' });
      }
      try {
        const bytes = await services.synthesize(text);
        return new Response(bytes, { status: 200, headers: {
          'content-type': 'audio/wav', 'content-length': String(bytes.length), 'cache-control': 'no-store',
        } });
      } catch { return json(502, { error: 'tts_unavailable' }); }
    },
  });

  if (services.ttsUrl) {
    ctx.tools.register(defineTool({
      name: 'voice_tts',
      description: '将文字合成为 WAV 语音文件。结果 status=synthesized 只表示文件已生成；要发给 QQ 好友，还须调用 onebot_reply 发送 record 段，收到发送成功回执后才能说已发出。用户明确要求语音时，先尝试此工具。',
      parameters: { text: { type: 'string', description: '要读出的文字，最多 180 字。' } },
      output: { schema: { type: 'string' }, render: (_args, value) => [{ type: 'text', text: value }] },
      async execute(args = {}) {
        try { return JSON.stringify(await speechToFile(services, args.text, audioDir)); }
        catch { return JSON.stringify({ status: 'failed', reason: 'tts_unavailable' }); }
      },
    }));
  }

  ctx.effect?.(() => {
    const timer = setInterval(() => {
      void pruneAudio(audioDir).catch(() => {});
    }, 15 * 60 * 1000);
    timer.unref?.();
    return () => clearInterval(timer);
  });
}
