import { randomUUID, timingSafeEqual } from 'node:crypto';

const MAX_FRAME_BYTES = 3 * 1024 * 1024;
const MAX_RECORD_BYTES = 2 * 1024 * 1024;
const RECORD_TTL_MS = 10 * 60 * 1000;
const MAX_PENDING = 200;

function sameToken(actual, wanted) {
  const left = Buffer.from(String(actual ?? ''));
  const right = Buffer.from(`Bearer ${wanted}`);
  return left.length === right.length && timingSafeEqual(left, right);
}

function recordOf(event) {
  const segments = Array.isArray(event?.message) ? event.message : [];
  return segments.find(part => part?.type === 'record' && typeof part?.data?.file === 'string')?.data.file || '';
}

export async function startVoiceBridge({ WebSocket, WebSocketServer, upstreamUrl, upstreamToken,
  downstreamToken, allowedSenders = [], asr, host = '127.0.0.1', port = 0,
  actionTimeoutMs = 15000, logger = console } = {}) {
  if (!WebSocket || !WebSocketServer || !upstreamUrl || !upstreamToken || !downstreamToken) {
    throw new Error('bridge connection configuration incomplete');
  }
  const allowed = new Set(allowedSenders.map(String));
  const records = new Map();
  const pending = new Map();
  let client = null;
  let upstream = null;
  let closed = false;
  let reconnect = null;

  const send = (ws, packet) => {
    if (ws?.readyState === WebSocket.OPEN) ws.send(JSON.stringify(packet));
  };
  const fail = (echo, reason = 'not allowed') =>
    send(client, { status: 'failed', retcode: 403, echo, message: reason });

  const clearPending = () => {
    for (const item of pending.values()) clearTimeout(item.timer);
    pending.clear();
  };
  const trackPending = (internal, call) => {
    const timer = setTimeout(() => {
      if (!pending.delete(internal)) return;
      if (call.kind === 'record') forwardNative(call);
      else send(client, { status: 'failed', retcode: 504, echo: call.echo, message: 'OneBot timeout' });
    }, actionTimeoutMs);
    timer.unref?.();
    pending.set(internal, { ...call, timer });
  };

  function forwardNative(call) {
    if (!upstream || upstream.readyState !== WebSocket.OPEN) {
      fail(call.echo, 'upstream unavailable'); return;
    }
    const internal = `voice-${randomUUID()}`;
    trackPending(internal, { kind: 'native', echo: call.echo });
    send(upstream, { action: 'fetch_ptt_text', params: { message_id: call.params.message_id }, echo: internal });
  }

  async function handleRecord(call, response) {
    const encoded = response?.data?.base64;
    try {
      if (response?.status !== 'ok' || typeof encoded !== 'string' ||
        encoded.length > Math.ceil(MAX_RECORD_BYTES * 4 / 3) + 4 ||
        !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('invalid record');
      const bytes = Buffer.from(encoded, 'base64');
      if (bytes.length < 44 || bytes.length > MAX_RECORD_BYTES ||
        bytes.toString('ascii', 0, 4) !== 'RIFF' || bytes.toString('ascii', 8, 12) !== 'WAVE') {
        throw new Error('invalid wav');
      }
      const result = await asr.transcribe(bytes);
      if (!result?.text) throw new Error('empty transcript');
      send(client, { status: 'ok', retcode: 0, echo: call.echo, data: { text: result.text } });
    } catch {
      logger.warn?.('Voice ASR unavailable; falling back to OneBot');
      forwardNative(call);
    }
  }

  function connectUpstream() {
    if (closed) return;
    const ws = new WebSocket(upstreamUrl, {
      headers: { authorization: `Bearer ${upstreamToken}` }, maxPayload: MAX_FRAME_BYTES,
    });
    upstream = ws;
    ws.on('message', data => {
      if (ws !== upstream || data.length > MAX_FRAME_BYTES) return;
      let packet;
      try { packet = JSON.parse(data.toString()); } catch { return; }
      if (packet.echo !== undefined) {
        const call = pending.get(String(packet.echo));
        if (!call) return;
        pending.delete(String(packet.echo));
        clearTimeout(call.timer);
        if (call.kind === 'record') { void handleRecord(call, packet); return; }
        send(client, { ...packet, echo: call.echo });
        return;
      }
      if (packet.post_type === 'message') {
        if (packet.message_type !== 'private' || !allowed.has(String(packet.user_id))) return;
        const file = recordOf(packet);
        if (file && packet.message_id !== undefined) {
          records.set(String(packet.message_id), { file, userId: String(packet.user_id), at: Date.now() });
          if (records.size > 1000) records.delete(records.keys().next().value);
        }
      }
      send(client, packet);
    });
    ws.on('error', () => {});
    ws.on('close', () => {
      if (ws !== upstream) return;
      upstream = null;
      clearPending();
      if (client) client.close(1011, 'upstream unavailable');
      if (!closed) reconnect = setTimeout(connectUpstream, 1000);
    });
  }

  const server = new WebSocketServer({ host, port, maxPayload: MAX_FRAME_BYTES,
    verifyClient: info => sameToken(info.req.headers.authorization, downstreamToken) });
  await new Promise((resolve, reject) => {
    if (server.address()) resolve();
    else { server.once('listening', resolve); server.once('error', reject); }
  });
  server.on('connection', ws => {
    if (client && client.readyState === WebSocket.OPEN) { ws.close(1008, 'one client only'); return; }
    client = ws;
    ws.on('message', data => {
      if (data.length > MAX_FRAME_BYTES || ws !== client) return;
      let call;
      try { call = JSON.parse(data.toString()); } catch { return; }
      const action = String(call?.action ?? '');
      const params = call?.params ?? {};
      const echo = call?.echo;
      if (!action || !upstream || upstream.readyState !== WebSocket.OPEN) { fail(echo, 'upstream unavailable'); return; }
      if (pending.size >= MAX_PENDING) { fail(echo, 'too many pending actions'); return; }
      if (action === 'fetch_ptt_text') {
        const entry = records.get(String(params.message_id));
        if (!entry || Date.now() - entry.at > RECORD_TTL_MS) { fail(echo); return; }
        if (!asr) { forwardNative(call); return; }
        const internal = `voice-${randomUUID()}`;
        trackPending(internal, { kind: 'record', echo, params: { message_id: params.message_id } });
        send(upstream, { action: 'get_record', params: { file: entry.file, out_format: 'wav' }, echo: internal });
        return;
      }
      if (/^send_(msg|private_msg|group_msg)$/.test(action)) {
        if (action === 'send_group_msg' || !allowed.has(String(params.user_id)) ||
          (action === 'send_msg' && params.message_type !== 'private')) { fail(echo); return; }
      }
      if (action === 'get_record' && ![...records.values()].some(item => item.file === params.file)) { fail(echo); return; }
      const internal = `voice-${randomUUID()}`;
      trackPending(internal, { kind: 'passthrough', echo });
      send(upstream, { action, params, echo: internal });
    });
    ws.on('close', () => { if (client === ws) { client = null; clearPending(); } });
    ws.on('error', () => {});
  });
  connectUpstream();

  return {
    url: `ws://${host}:${server.address().port}`,
    async close() {
      closed = true;
      if (reconnect) clearTimeout(reconnect);
      client?.terminate();
      upstream?.terminate();
      clearPending();
      for (const ws of server.clients) ws.terminate();
      await new Promise(resolve => server.close(resolve));
    },
  };
}
