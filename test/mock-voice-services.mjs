import { createServer } from 'node:http';

const wav = Buffer.alloc(44 + 320);
wav.write('RIFF', 0);
wav.writeUInt32LE(wav.length - 8, 4);
wav.write('WAVEfmt ', 8);
wav.writeUInt32LE(16, 16);
wav.writeUInt16LE(1, 20);
wav.writeUInt16LE(1, 22);
wav.writeUInt32LE(16000, 24);
wav.writeUInt32LE(32000, 28);
wav.writeUInt16LE(2, 32);
wav.writeUInt16LE(16, 34);
wav.write('data', 36);
wav.writeUInt32LE(320, 40);

createServer((request, response) => {
  if (request.method !== 'POST') { response.writeHead(405).end(); return; }
  if (request.url === '/asr') {
    response.writeHead(200, { 'content-type': 'application/json' });
    response.end(JSON.stringify({ text: '模拟语音识别成功' }));
  } else if (request.url === '/tts') {
    response.writeHead(200, { 'content-type': 'audio/wav' });
    response.end(wav);
  } else response.writeHead(404).end();
}).listen(9002, '127.0.0.1');
