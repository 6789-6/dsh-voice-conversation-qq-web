(async (page) => {
  await page.route('**/api/dsh-voice/asr', route => route.fulfill({
    status: 200,
    contentType: 'application/json',
    body: JSON.stringify({ text: '模拟转写内容' }),
  }));
  await page.evaluate(() => {
    navigator.mediaDevices.getUserMedia = async () => ({
      getTracks: () => [{ stop() {} }],
    });
    window.MediaRecorder = class {
      constructor() { this.state = 'inactive'; this.mimeType = 'audio/webm'; }
      start() { this.state = 'recording'; }
      stop() {
        this.state = 'inactive';
        this.ondataavailable?.({ data: new Blob([new Uint8Array(16)]) });
        this.onstop?.();
      }
    };
    window.AudioContext = class {
      async decodeAudioData() {
        return {
          sampleRate: 16000, length: 160, numberOfChannels: 1,
          getChannelData: () => new Float32Array(160),
        };
      }
      async close() {}
    };
  });
  await page.getByRole('textbox', { name: /描述你想要构建的内容/ }).fill('');
  const mic = page.getByRole('button', { name: '按住说话' });
  await mic.dispatchEvent('pointerdown', { pointerType: 'mouse', button: 0 });
  await page.getByRole('button', { name: '停止录音' }).waitFor();
  await page.getByRole('button', { name: '停止录音' }).dispatchEvent('pointerup', { pointerType: 'mouse', button: 0 });
  await page.getByRole('status', { name: '' }).filter({ hasText: '转写已填入输入框' }).waitFor();
  const draft = await page.getByRole('textbox', { name: /描述你想要构建的内容/ }).innerText();
  if (draft !== '模拟转写内容') throw Error(`Unexpected transcript draft: ${draft}`);
  return { mic: true, transcriptInserted: true, autoSubmitted: false };
})
