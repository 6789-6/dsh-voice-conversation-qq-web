window.__ModuleLoader__.load({
  id: 'dsh-voice-conversation-qq-web',
  factory: (require) => {
    const module = { exports: {} };
    const React = require('react');
    const h = React.createElement;
    const endpoint = name => new URL(`api/dsh-voice/${name}`, document.baseURI).toString();

    function pcmWav(audio) {
      const targetRate = 16000;
      const rate = audio.sampleRate;
      const ratio = rate / targetRate;
      const count = Math.ceil(audio.length / ratio);
      const channels = Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i));
      const out = new Uint8Array(44 + count * 2);
      const view = new DataView(out.buffer);
      const put = (offset, word) => [...word].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)));
      put(0, 'RIFF'); view.setUint32(4, 36 + count * 2, true); put(8, 'WAVE');
      put(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true);
      view.setUint16(22, 1, true); view.setUint32(24, targetRate, true);
      view.setUint32(28, targetRate * 2, true); view.setUint16(32, 2, true);
      view.setUint16(34, 16, true); put(36, 'data'); view.setUint32(40, count * 2, true);
      for (let i = 0; i < count; i++) {
        const start = Math.floor(i * ratio);
        const end = Math.min(audio.length, Math.max(start + 1, Math.floor((i + 1) * ratio)));
        let sum = 0;
        for (let j = start; j < end; j++) {
          for (const channel of channels) sum += channel[j];
        }
        const sample = Math.max(-1, Math.min(1, sum / ((end - start) * channels.length)));
        view.setInt16(44 + i * 2, sample < 0 ? sample * 32768 : sample * 32767, true);
      }
      return out;
    }

    async function jsonResponse(response) {
      if (!response.ok) throw Error(`语音服务暂不可用（${response.status}）`);
      return response.json();
    }

    function MicControl(props) {
      const [recording, setRecording] = React.useState(false);
      const [busy, setBusy] = React.useState(false);
      const [notice, setNotice] = React.useState('');
      const active = React.useRef(null);
      const releaseRequested = React.useRef(false);
      const start = async () => {
        if (active.current || busy || !props.inputActions) return;
        releaseRequested.current = false;
        setNotice('');
        try {
          const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
          const recorder = new MediaRecorder(stream);
          const state = { recorder, stream, chunks: [], span: props.inputActions.captureInsertion() };
          active.current = state;
          recorder.ondataavailable = event => { if (event.data?.size) state.chunks.push(event.data); };
          recorder.onstop = async () => {
            setRecording(false);
            state.stream.getTracks().forEach(track => track.stop());
            if (active.current === state) active.current = null;
            setBusy(true);
            try {
              const blob = new Blob(state.chunks, { type: recorder.mimeType });
              if (blob.size > 2 * 1024 * 1024) throw Error('录音过长，请缩短后重试');
              const context = new AudioContext();
              let wav;
              try { wav = pcmWav(await context.decodeAudioData(await blob.arrayBuffer())); }
              finally { await context.close(); }
              if (wav.byteLength > 2 * 1024 * 1024) throw Error('录音过长，请缩短后重试');
              const result = await jsonResponse(await fetch(endpoint('asr'), {
                method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'audio/wav' }, body: wav,
              }));
              if (!props.inputActions.insertText(result.text, state.span)) {
                setNotice(`草稿已变化，转写未覆盖它：${result.text}`);
              } else setNotice('转写已填入输入框，请确认后发送');
            } catch (error) { setNotice(error?.message || '转写失败'); }
            finally { setBusy(false); }
          };
          recorder.start();
          setRecording(true);
          if (releaseRequested.current) recorder.stop();
        } catch (error) { setNotice(error?.message || '无法使用麦克风'); }
      };
      const stop = () => {
        releaseRequested.current = true;
        const recorder = active.current?.recorder;
        if (recorder?.state === 'recording') recorder.stop();
      };
      React.useEffect(() => () => {
        try { active.current?.recorder?.stop(); } catch {}
        active.current?.stream?.getTracks().forEach(track => track.stop());
      }, []);
      return h('span', { style: { display: 'inline-flex', alignItems: 'center', gap: 4 } },
        h('button', {
          type: 'button', title: recording ? '松开发送语音转写' : '按住说话，松开后转写到输入框',
          'aria-label': recording ? '停止录音' : '按住说话', disabled: busy || !props.inputActions,
          onPointerDown: event => { if (event.pointerType !== 'mouse' || event.button === 0) void start(); },
          onPointerUp: stop, onPointerCancel: stop,
          onKeyDown: event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); void start(); } },
          onKeyUp: event => { if (event.key === ' ' || event.key === 'Enter') { event.preventDefault(); stop(); } },
          style: { border: '1px solid currentColor', borderRadius: 7, padding: '5px 8px',
            background: recording ? '#ba4949' : 'transparent', color: 'inherit', cursor: 'pointer' },
        }, recording ? '● 录音中' : busy ? '转写中…' : '🎤'),
        notice ? h('span', { role: 'status', style: { fontSize: 11, maxWidth: 220 } }, notice) : null);
    }

    function AssistantReplay(props) {
      const nodes = props.useChat ? props.useChat(snapshot => snapshot.legacy.nodes) : [];
      const node = nodes?.find(item => item.kind === 'assistant' && String(item.messageId) === String(props.messageId));
      const text = node?.blocks?.filter(block => block.kind === 'text').map(block => block.text).join('\n').trim() || '';
      const [playing, setPlaying] = React.useState(false);
      const [error, setError] = React.useState('');
      const current = React.useRef(null);
      const cancelled = React.useRef(false);
      React.useEffect(() => () => { if (current.current) current.current.pause(); }, []);
      if (!text) return null;
      const play = async () => {
        if (playing) { cancelled.current = true; current.current?.pause(); setPlaying(false); return; }
        cancelled.current = false;
        setPlaying(true); setError('');
        try {
          for (const chunk of text.match(/[\s\S]{1,180}/g) || []) {
            if (cancelled.current) break;
            const response = await fetch(endpoint('tts'), {
              method: 'POST', credentials: 'same-origin', headers: { 'content-type': 'application/json' },
              body: JSON.stringify({ text: chunk }),
            });
            if (cancelled.current) break;
            if (!response.ok) throw Error(`朗读失败（${response.status}）`);
            const url = URL.createObjectURL(await response.blob());
            try {
              await new Promise((resolve, reject) => {
                const audio = new Audio(url); current.current = audio;
                audio.onended = resolve; audio.onpause = resolve;
                audio.onerror = () => reject(Error('播放失败'));
                audio.play().catch(reject);
              });
            } finally { URL.revokeObjectURL(url); current.current = null; }
          }
        } catch (reason) { setError(reason?.message || '朗读失败'); }
        finally { setPlaying(false); }
      };
      return h('span', null,
        h('button', { type: 'button', 'aria-label': '朗读这条回复', title: '朗读这条回复',
          onClick: () => { void play(); }, style: { border: 0, background: 'transparent', color: 'inherit', cursor: 'pointer' },
        }, playing ? '■ 停止' : '🔊 朗读'),
        error ? h('span', { role: 'status' }, error) : null);
    }

    const apply = ctx => {
      try {
        ctx.slots.inject('conversation.input.right', () => {
          try { return ctx.slots.register({ name: 'conversation.input.right', id: 'dsh-voice-mic', order: 50 }, MicControl); }
          catch { return () => {}; }
        });
        ctx.slots.inject('conversation.chat.assistant-actions', () => {
          try { return ctx.slots.register({ name: 'conversation.chat.assistant-actions', id: 'dsh-voice-replay', order: 50 }, AssistantReplay); }
          catch { return () => {}; }
        });
      } catch { /* A failed optional UI must not block DSH Web boot. */ }
    };
    module.exports.apply = apply;
    module.exports.inject = ['slots'];
    module.exports.pcmWav = pcmWav;
    return module.exports;
  },
});
