import test from 'node:test';
import assert from 'node:assert/strict';
import { WebSocket, WebSocketServer } from 'ws';
import { startVoiceBridge } from '../src/bridge.js';

const wav = (() => { const b = Buffer.alloc(48); b.write('RIFF', 0); b.write('WAVE', 8); return b; })();
const delay = ms => new Promise(resolve => setTimeout(resolve, ms));
const open = (url, token) => new Promise((resolve, reject) => {
  const ws = new WebSocket(url, { headers: { authorization: `Bearer ${token}` } });
  ws.once('open', () => resolve(ws)); ws.once('error', reject);
});
const next = ws => new Promise(resolve => ws.once('message', data => resolve(JSON.parse(data.toString()))));

test('bridge transcribes only allowlisted private voice and preserves message identity', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => upstream.once('listening', resolve));
  const calls = [];
  let upstreamPeer;
  upstream.on('connection', ws => {
    upstreamPeer = ws;
    ws.on('message', data => {
      const action = JSON.parse(data.toString()); calls.push(action);
      if (action.action === 'get_record') ws.send(JSON.stringify({ status: 'ok', retcode: 0, echo: action.echo, data: { base64: wav.toString('base64') } }));
    });
  });
  const asr = { transcribe: async bytes => { assert.deepEqual(bytes, wav); return { text: '测试语音' }; } };
  const bridge = await startVoiceBridge({ WebSocket, WebSocketServer, upstreamUrl: `ws://127.0.0.1:${upstream.address().port}`,
    upstreamToken: 'up', downstreamToken: 'down', allowedSenders: ['10001'], asr,
    host: '127.0.0.1', port: 0 });
  try {
    for (let i = 0; i < 50 && !upstreamPeer; i++) await delay(10);
    const client = await open(bridge.url, 'down');
    upstreamPeer.send(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 20002, message_id: 8, message: [{ type: 'record', data: { file: 'blocked' } }] }));
    upstreamPeer.send(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 10001, message_id: 9, message: [{ type: 'record', data: { file: 'voice-9' } }] }));
    const event = await next(client);
    assert.equal(event.message_id, 9);
    client.send(JSON.stringify({ action: 'fetch_ptt_text', params: { message_id: 9 }, echo: 'request-1' }));
    const result = await next(client);
    assert.deepEqual(result, { status: 'ok', retcode: 0, echo: 'request-1', data: { text: '测试语音' } });
    assert.equal(calls[0].action, 'get_record');
    client.send(JSON.stringify({ action: 'send_msg', params: { message_type: 'private', user_id: 20002, message: 'x' }, echo: 'request-2' }));
    const blocked = await next(client);
    assert.equal(blocked.status, 'failed');
    assert.equal(calls.length, 1);
    client.close();
  } finally { await bridge.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('bridge falls back to native transcription if local ASR fails', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => upstream.once('listening', resolve));
  let peer;
  const actions = [];
  upstream.on('connection', ws => {
    peer = ws;
    ws.on('message', data => {
      const action = JSON.parse(data.toString()); actions.push(action.action);
      if (action.action === 'get_record') ws.send(JSON.stringify({ status: 'ok', echo: action.echo,
        data: { base64: wav.toString('base64') } }));
      if (action.action === 'fetch_ptt_text') ws.send(JSON.stringify({ status: 'ok', retcode: 0, echo: action.echo, data: { text: '原生转写' } }));
    });
  });
  const bridge = await startVoiceBridge({ WebSocket, WebSocketServer, upstreamUrl: `ws://127.0.0.1:${upstream.address().port}`,
    upstreamToken: 'up', downstreamToken: 'down', allowedSenders: ['10001'], asr: { transcribe: async () => { throw Error('offline'); } },
    host: '127.0.0.1', port: 0, logger: { warn() {} } });
  try {
    for (let i = 0; i < 50 && !peer; i++) await delay(10);
    const client = await open(bridge.url, 'down');
    peer.send(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 10001, message_id: 1, message: [{ type: 'record', data: { file: 'voice-1' } }] }));
    await next(client);
    client.send(JSON.stringify({ action: 'fetch_ptt_text', params: { message_id: 1 }, echo: 'x' }));
    const result = await next(client);
    assert.equal(result.data.text, '原生转写');
    assert.deepEqual(actions, ['get_record', 'fetch_ptt_text']);
    client.close();
  } finally { await bridge.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('bridge relays an allowlisted record send receipt without claiming delivery early', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => upstream.once('listening', resolve));
  let peer;
  const calls = [];
  upstream.on('connection', ws => {
    peer = ws;
    ws.on('message', data => {
      const call = JSON.parse(data.toString());
      calls.push(call);
      ws.send(JSON.stringify({ status: 'ok', retcode: 0, echo: call.echo, data: { message_id: 77 } }));
    });
  });
  const bridge = await startVoiceBridge({ WebSocket, WebSocketServer,
    upstreamUrl: `ws://127.0.0.1:${upstream.address().port}`,
    upstreamToken: 'up', downstreamToken: 'down', allowedSenders: ['10001'],
    host: '127.0.0.1', port: 0 });
  try {
    for (let i = 0; i < 50 && !peer; i++) await delay(10);
    const client = await open(bridge.url, 'down');
    const send = { action: 'send_private_msg', params: { user_id: '10001',
      message: [{ type: 'record', data: { file: '/tmp/voice-example.wav' } }] }, echo: 'send-voice' };
    client.send(JSON.stringify(send));
    const receipt = await next(client);
    assert.equal(receipt.echo, 'send-voice');
    assert.equal(receipt.status, 'ok');
    assert.equal(receipt.data.message_id, 77);
    assert.deepEqual(calls[0].params.message, send.params.message);
    client.close();
  } finally { await bridge.close(); await new Promise(resolve => upstream.close(resolve)); }
});

test('bridge falls back to native transcription when OneBot get_record times out', async () => {
  const upstream = new WebSocketServer({ host: '127.0.0.1', port: 0 });
  await new Promise(resolve => upstream.once('listening', resolve));
  let peer;
  const actions = [];
  upstream.on('connection', ws => {
    peer = ws;
    ws.on('message', data => {
      const call = JSON.parse(data.toString());
      actions.push(call.action);
      if (call.action === 'fetch_ptt_text') ws.send(JSON.stringify({ status: 'ok', retcode: 0,
        echo: call.echo, data: { text: '超时后的原生转写' } }));
    });
  });
  const bridge = await startVoiceBridge({ WebSocket, WebSocketServer,
    upstreamUrl: `ws://127.0.0.1:${upstream.address().port}`,
    upstreamToken: 'up', downstreamToken: 'down', allowedSenders: ['10001'],
    asr: { transcribe: async () => { throw Error('unexpected'); } },
    host: '127.0.0.1', port: 0, actionTimeoutMs: 30 });
  try {
    for (let i = 0; i < 50 && !peer; i++) await delay(10);
    const client = await open(bridge.url, 'down');
    peer.send(JSON.stringify({ post_type: 'message', message_type: 'private', user_id: 10001,
      message_id: 12, message: [{ type: 'record', data: { file: 'voice-12' } }] }));
    await next(client);
    client.send(JSON.stringify({ action: 'fetch_ptt_text', params: { message_id: 12 }, echo: 'timeout' }));
    const result = await next(client);
    assert.equal(result.data.text, '超时后的原生转写');
    assert.deepEqual(actions, ['get_record', 'fetch_ptt_text']);
    client.close();
  } finally { await bridge.close(); await new Promise(resolve => upstream.close(resolve)); }
});
