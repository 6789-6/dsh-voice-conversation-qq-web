// Optional loopback adapter: DSH's WAV contract -> Fish Audio's native /v1/tts.
// Keep all token and reference ID files outside the repository.
import { createServer } from 'node:http';
import { readFileSync } from 'node:fs';
import { timingSafeEqual } from 'node:crypto';
import { pathToFileURL } from 'node:url';

const MAX_REQUEST = 4096;
const MAX_AUDIO = 5 * 1024 * 1024;

function privateLine(path) {
  if (!path) throw Error('private file path required');
  const value = readFileSync(path, 'utf8').trim();
  if (!value || /[\r\n]/.test(value)) throw Error('invalid private file');
  return value;
}

function authorized(actual, token) {
  const a = Buffer.from(String(actual ?? ''));
  const b = Buffer.from(`Bearer ${token}`);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function bounded(stream, max) {
  const chunks = [];
  let size = 0;
  for await (const chunk of stream) {
    size += chunk.length;
    if (size > max) throw Error('body too large');
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks);
}

export async function startFishAdapter({ env = process.env, fetchImpl = fetch } = {}) {
  const fishKey = privateLine(env.FISH_API_KEY_FILE);
  const localToken = privateLine(env.FISH_ADAPTER_TOKEN_FILE);
  const referenceId = privateLine(env.FISH_REFERENCE_ID_FILE);
  const model = env.FISH_MODEL || 's2-pro';
  const speed = Number(env.FISH_SPEED ?? '0.9');
  const host = env.FISH_ADAPTER_HOST || '127.0.0.1';
  const port = Number(env.FISH_ADAPTER_PORT ?? '9003');
  const fishUrl = env.FISH_API_URL || 'https://api.fish.audio/v1/tts';
  if (!Number.isFinite(speed) || speed < 0.5 || speed > 2 ||
      !Number.isInteger(port) || port < 0 || port > 65535 ||
      !['http:', 'https:'].includes(new URL(fishUrl).protocol)) throw Error('invalid adapter config');

  const server = createServer(async (request, response) => {
    const reply = (status, reason) => {
      response.writeHead(status, { 'content-type': 'application/json', 'cache-control': 'no-store' });
      response.end(JSON.stringify({ error: reason }));
    };
    if (request.url !== '/v1/audio/speech' || request.method !== 'POST') { reply(404, 'not_found'); return; }
    if (!authorized(request.headers.authorization, localToken)) { reply(401, 'unauthorized'); return; }
    let input;
    try {
      const body = JSON.parse((await bounded(request, MAX_REQUEST)).toString());
      if (body.response_format !== 'wav' || typeof body.input !== 'string' ||
          !body.input.trim() || body.input.length > 180) throw Error('invalid request');
      input = body.input.trim();
    } catch { reply(422, 'invalid_request'); return; }
    try {
      const upstream = await fetchImpl(fishUrl, {
        method: 'POST', signal: AbortSignal.timeout(30000),
        headers: { authorization: `Bearer ${fishKey}`, 'content-type': 'application/json', model },
        body: JSON.stringify({ text: input, reference_id: referenceId, format: 'wav',
          prosody: { speed } }),
      });
      if (!upstream.ok || !upstream.body) throw Error('upstream unavailable');
      const audio = await bounded(upstream.body, MAX_AUDIO);
      if (audio.length < 44 || audio.toString('ascii', 0, 4) !== 'RIFF' ||
          audio.toString('ascii', 8, 12) !== 'WAVE') throw Error('invalid audio');
      response.writeHead(200, { 'content-type': 'audio/wav',
        'content-length': String(audio.length), 'cache-control': 'no-store' });
      response.end(audio);
    } catch { reply(502, 'tts_unavailable'); }
  });
  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return server;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  startFishAdapter().then(server => {
    console.log(`Fish adapter listening on ${server.address().address}:${server.address().port}`);
  }).catch(error => { console.error(`Fish adapter startup failed: ${error.message}`); process.exitCode = 1; });
}
