# DSH Voice Conversation · QQ + Web

> **Fish Audio / 语音 API：** 本项目优先说明原部署采用的 **Fish Audio 语音合成**路线。Fish 负责发声；收语音由独立 ASR 负责（原部署使用本地 SenseVoice），失败时可回退 OneBot 原生转写。仓库不含 Fish Key、音色 ID、参考音频或任何个人配置。

> **Fish Audio / speech API:** The reference setup uses **Fish Audio for speech synthesis** and a separate ASR service for incoming speech (local SenseVoice in the original setup), with optional OneBot native transcription fallback. No key, voice ID, reference recording, or personal configuration is included.

GitHub **Code** 页内语言切换：点击下方“中文 / English”标题，即可在这份 `README.md` 内切换语言，无需跳到另一个文件。两个折叠区使用相同的 `name`，展开一种语言时会收起另一种；已用 GitHub Markdown 渲染接口核对。[GitHub 折叠区说明](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)。

On GitHub's **Code** page, click “中文 / English” below to switch language in this same README. The two sections share a `name`, so opening one closes the other. No separate language file or page navigation is needed.

<details name="language" open>
<summary><strong>🇨🇳 中文 · 点击切换</strong></summary>

## Fish Audio：从 Key 到语音回复

**接口区别。** 本插件要求 TTS 服务接收 `POST /v1/audio/speech`，JSON 为 `{"input":"...","response_format":"wav"}`，返回 WAV。Fish 原生接口是 `POST https://api.fish.audio/v1/tts`，字段为 `text`、`reference_id`、`format`、`prosody`，模型放在 `model` 请求头中。因此**不能把 Fish 原生地址直接填入 `ttsUrl`**。仓库的 `examples/fish-tts-adapter.mjs` 提供私有转换层；请求格式参考 [Fish 官方 SDK](https://github.com/fishaudio/fish-audio-python)。

1. 在 Fish Audio 创建 API Key，并取得有使用权的音色 `reference_id`。将 **Fish Key、音色 ID、适配器专用令牌**分别放在仓库外三个仅服务账号可读的文件中（建议权限 `0600`）；不要提交音色样本。
2. 安装 Node.js 24+，按 `examples/fish-tts.env.example` 设置三个 `*_FILE` 路径、`FISH_MODEL` 和 `FISH_SPEED`，运行 `node examples/fish-tts-adapter.mjs`。示例默认 `s2-pro`、语速 `0.9`，安装者可按音色调整。适配器默认只监听 `127.0.0.1:9003`；容器部署时使用受限私有网络，不能开放到公网。
3. 先测试适配器：携带 `Authorization: Bearer <适配器令牌>` 向其 `/v1/audio/speech` 发送 `{"input":"你好，我可以发语音。","response_format":"wav"}`。成功应返回 `200`、`audio/wav`。`401` 检查适配器令牌；`502` 检查 Fish Key、音色使用权、额度、模型及网络。适配器不会记录正文或音频。
4. 在**隔离**的 DSH `0.2.1-rc.2` 或兼容 `0.2.x` Web profile 中，运行 `npm ci --ignore-scripts && npm pack`，然后 `dsh plugin --profile web add ./dsh-voice-conversation-qq-web-0.1.1.tgz --offline`。用 `dsh --profile web --dump-config` 确认插件只有一条。包名带 `qq-web`，因为较短的 npm 名称已被其他项目占用。
5. 按 `examples/profile-override.patch.yml` 对已安装条目做 `id` 定向配置：`ttsUrl` 指向适配器的私有地址，`ttsTokenFile` 指向其专用令牌文件；`asrUrl` 和 `asrTokenFile` 指向**独立的识别服务**。ASR 必须接受 `POST audio/wav` 并返回 `{"text":"识别内容"}`。Fish 在本路线只负责合成，不能代替 ASR。不要再应用手动 `insert` 示例补丁。
6. 重启隔离 DSH，在已认证的网页选择工作区，按住 🎤、松开，确认转写进入草稿后手动发送。对完成的助手回复点击“🔊 朗读”。音频请求走 DSH 已认证的连接通道。
7. 可选 QQ：已有 `dsh-onebot-hub`、OneBot 和权限网关时，将可选语音桥接置于网关之后，先接模拟 OneBot 测试。按 `examples/bridge.env.example` 配置白名单私聊账号、上下游令牌和 ASR 地址；枢纽设置 `tts.provider=plugin`、`tts.plugin.tool=voice_tts`。普通回复由 Agent 选文字或语音；用户明确要求语音时应尝试 `voice_tts`，再用 `onebot_reply` 的 `record` 段发送返回的文件。`status=synthesized` 仅表示已合成，**只有发送成功回执才能说已发出**。入站 ASR 失败时桥接尝试原生转写。

## 能力与边界

- 网页支持按住说话、转写确认、逐条朗读；浏览器录音转为 16 kHz 单声道 WAV，不自动提交草稿。
- QQ 桥接只转发白名单私聊事件，沿用已有 QQ 插件的会话机制；它**不能替代**原有 OneBot 权限网关。
- 临时音频限大小、定时清理；插件日志不写音频或转写正文。凭据、音色 ID、QQ 白名单均由部署环境的私有文件提供。
- 安装包和公开仓库不含个人账号、域名、服务器地址、聊天记录或声音样本。现网接入步骤见 `docs/LIVE-INTEGRATION.md`；隔离测试范围见 `docs/TEST-RESULTS.md`。

## 开发与许可

`npm ci --ignore-scripts && npm test` 运行模拟 ASR/TTS、OneBot、Fish 适配器和网页组件测试。发布前检查 `npm pack --dry-run` 与实际压缩包。代码采用 MIT 许可证；`private: true` 阻止向 npm 发布。

</details>

<details name="language">
<summary><strong>🇬🇧 English · click to switch</strong></summary>

## Fish Audio: from API key to spoken reply

**The interfaces differ.** This plugin expects `POST /v1/audio/speech` with `{"input":"...","response_format":"wav"}` and a WAV response. Fish Audio's native API is `POST https://api.fish.audio/v1/tts`, with `text`, `reference_id`, `format`, `prosody`, and a `model` header. **Do not put the native Fish URL directly in `ttsUrl`.** The optional `examples/fish-tts-adapter.mjs` converts between them. See the [official Fish SDK](https://github.com/fishaudio/fish-audio-python).

1. Create a Fish API key and select a voice `reference_id` you may use. Store the **Fish key, voice ID, and a separate local adapter token** in three service-only files outside this repository (for example mode `0600`). Never commit reference audio.
2. Install Node.js 24+, set the three `*_FILE` paths plus `FISH_MODEL` and `FISH_SPEED` following `examples/fish-tts.env.example`, and run `node examples/fish-tts-adapter.mjs`. The example defaults to `s2-pro` and speed `0.9`; tune them for your voice. It binds to `127.0.0.1:9003` by default. Container deployments need a restricted private network, never a public endpoint.
3. Test the adapter first: send `{"input":"Hello, I can speak.","response_format":"wav"}` to `/v1/audio/speech` with `Authorization: Bearer <adapter token>`. Expect `200` and `audio/wav`. A `401` points to the local token; a `502` points to Fish credentials, voice permission, balance, model, or network. The adapter does not log speech content or audio.
4. In an **isolated** DSH `0.2.1-rc.2` or compatible `0.2.x` Web profile, run `npm ci --ignore-scripts && npm pack`, then `dsh plugin --profile web add ./dsh-voice-conversation-qq-web-0.1.1.tgz --offline`. Check `dsh --profile web --dump-config` for exactly one plugin row. The `qq-web` suffix avoids an unrelated package using the shorter npm name.
5. Use the id-targeted `examples/profile-override.patch.yml`: set `ttsUrl` to the adapter's private URL and `ttsTokenFile` to its local token file. Point `asrUrl` and `asrTokenFile` to a **separate transcription service** accepting `POST audio/wav` and returning `{"text":"transcript"}`. Fish provides synthesis here; it is not ASR. Do not add the manual `insert` patch over the package bundle.
6. Restart isolated DSH. In authenticated Web, select a workspace, hold and release 🎤, review the transcribed draft, and send it yourself. Click “🔊 Read aloud” on a completed assistant message. Audio stays on DSH's authenticated connection.
7. Optional QQ: with existing `dsh-onebot-hub`, OneBot, and a permission gateway, put the optional voice bridge after the gateway and test against a mock OneBot first. Configure allowlisted private senders, both tokens, and ASR with `examples/bridge.env.example`. Set the hub's `tts.provider=plugin` and `tts.plugin.tool=voice_tts`. The Agent may choose text or speech normally. For an explicit voice request it should try `voice_tts`, then send the returned file through a `record` part in `onebot_reply`. `status=synthesized` means audio exists; **only a successful send receipt proves QQ delivery**. Failed inbound ASR falls back to native transcription.

## Features and limits

- Web press-to-talk, draft confirmation, and per-message read-aloud. Browser audio becomes 16 kHz mono WAV; transcripts are not auto-submitted.
- The optional QQ bridge forwards only allowlisted private events and keeps the existing QQ session model. It is **not** a replacement for the OneBot permission gateway.
- Temporary audio has size and expiry limits; plugin logs contain neither audio nor transcript bodies. Keep keys, voice IDs, and account allowlists in private runtime files.
- The package and public repository contain no personal accounts, domains, server addresses, chat history, or voice samples. See `docs/LIVE-INTEGRATION.md` for later rollout and `docs/TEST-RESULTS.md` for isolated test scope.

## Development and license

Run `npm ci --ignore-scripts && npm test` for deterministic ASR/TTS, OneBot, Fish adapter, and Web component tests. Inspect `npm pack --dry-run` and the actual tarball before publishing. MIT licensed; `private: true` prevents npm publication.

</details>
