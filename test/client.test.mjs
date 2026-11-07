import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import vm from 'node:vm';

test('client declares mic and assistant replay in DSH slots without blocking boot', async () => {
  let declared;
  const window = { __ModuleLoader__: { load(value) { declared = value; } } };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { window, globalThis: window });
  assert.equal(declared.id, 'dsh-voice-conversation-qq-web');
  const React = { createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}], useRef: value => ({ current: value }), useEffect: () => {} };
  const plugin = declared.factory(name => { assert.equal(name, 'react'); return React; });
  const registrations = [];
  plugin.apply({ slots: {
    inject(_name, register) { register(); },
    register(meta, component) { registrations.push({ meta, component }); return () => {}; },
  } });
  assert.deepEqual(registrations.map(item => item.meta.name),
    ['conversation.input.right', 'conversation.chat.assistant-actions']);
  assert.deepEqual(Array.from(plugin.inject), ['slots']);
});

test('browser PCM encoder produces a 16 kHz mono WAV without channel mixup', async () => {
  let declared;
  const window = { __ModuleLoader__: { load(value) { declared = value; } } };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), { window, globalThis: window });
  const plugin = declared.factory(() => ({ createElement: () => null, useState: () => {}, useRef: () => {}, useEffect: () => {} }));
  const wav = plugin.pcmWav({ sampleRate: 16000, numberOfChannels: 2,
    length: 2, getChannelData: channel => channel ? Float32Array.from([1, -1]) : Float32Array.from([1, -1]) });
  const bytes = Buffer.from(wav);
  assert.equal(bytes.toString('ascii', 0, 4), 'RIFF');
  assert.equal(bytes.toString('ascii', 8, 12), 'WAVE');
  assert.equal(bytes.readUInt32LE(24), 16000);
  assert.equal(bytes.readUInt16LE(22), 1);
  assert.equal(bytes.readInt16LE(44), 32767);
  assert.equal(bytes.readInt16LE(46), -32768);
});

test('assistant replay fetches a WAV over the authenticated DSH route and plays it', async () => {
  let declared;
  const window = { __ModuleLoader__: { load(value) { declared = value; } } };
  const requests = [];
  let played = 0;
  class AudioUrl extends URL {
    static createObjectURL() { return 'blob:mock'; }
    static revokeObjectURL() {}
  }
  const context = { window, globalThis: window, document: { baseURI: 'http://localhost/' },
    URL: AudioUrl, Blob,
    fetch: async (url, options) => { requests.push({ url, options }); return {
      ok: true, blob: async () => new Blob(['wav']),
    }; },
    Audio: class { play() { played++; queueMicrotask(() => this.onended?.()); return Promise.resolve(); } pause() {} },
  };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), context);
  const React = { createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}], useRef: value => ({ current: value }), useEffect: () => {} };
  const plugin = declared.factory(() => React);
  const components = [];
  plugin.apply({ slots: { inject: (_slot, callback) => callback(),
    register: (_meta, component) => { components.push(component); return () => {}; } } });
  const view = components[1]({ messageId: 'm1', useChat: selector => selector({ legacy: { nodes: [
    { kind: 'assistant', messageId: 'm1', blocks: [{ kind: 'text', text: '你好' }] },
  ] } }) });
  const button = view.children[0];
  assert.equal(button.props['aria-label'], '朗读这条回复');
  button.props.onClick();
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(requests.length, 1);
  assert.equal(requests[0].url, 'http://localhost/api/dsh-voice/tts');
  assert.equal(requests[0].options.credentials, 'same-origin');
  assert.equal(played, 1);
});

test('releasing before microphone permission resolves still stops the recording', async () => {
  let declared;
  let resolveStream;
  let stopped = 0;
  const window = { __ModuleLoader__: { load(value) { declared = value; } } };
  const context = { window, globalThis: window,
    document: { baseURI: 'http://localhost/' }, URL, Blob,
    navigator: { mediaDevices: { getUserMedia: () => new Promise(resolve => { resolveStream = resolve; }) } },
    MediaRecorder: class {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() { this.state = 'inactive'; stopped++; this.ondataavailable?.({ data: new Blob(['x']) });
        this.onstop?.(); }
    },
    AudioContext: class { async decodeAudioData() { return { sampleRate: 16000, length: 1,
      numberOfChannels: 1, getChannelData: () => new Float32Array(1) }; } async close() {} },
    fetch: async () => ({ ok: true, json: async () => ({ text: 'test' }) }),
  };
  vm.runInNewContext(await readFile(new URL('../src/client.js', import.meta.url), 'utf8'), context);
  const React = { createElement: (type, props, ...children) => ({ type, props, children }),
    useState: initial => [initial, () => {}], useRef: value => ({ current: value }), useEffect: () => {} };
  const plugin = declared.factory(() => React);
  const components = [];
  plugin.apply({ slots: { inject: (_slot, callback) => callback(),
    register: (_meta, component) => { components.push(component); return () => {}; } } });
  const view = components[0]({ inputActions: { captureInsertion: () => null,
    insertText: () => true } });
  const button = view.children[0];
  button.props.onPointerDown({ pointerType: 'mouse', button: 0 });
  button.props.onPointerUp();
  resolveStream({ getTracks: () => [{ stop() {} }] });
  await new Promise(resolve => setTimeout(resolve, 10));
  assert.equal(stopped, 1);
});
