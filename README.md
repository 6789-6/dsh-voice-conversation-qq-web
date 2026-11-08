# DSH Voice Conversation · QQ + Web

> **Fish Audio / 语音 API：** 推荐路线使用 Fish Audio 合成语音，独立 ASR 服务识别收到的语音。原部署的识别端使用本地 SenseVoice；本插件定义接口，但不捆绑识别模型。可选 QQ 桥接在 ASR 失败时尝试 OneBot 原生转写。公开包不含 Key、音色 ID、参考音频或个人配置。

> **Fish Audio / speech API:** The reference route uses Fish Audio for synthesis and a separate ASR service for incoming speech. The original setup used local SenseVoice; this plugin defines the interface but does not bundle an ASR model. The optional QQ bridge can fall back to native OneBot transcription. No key, voice ID, reference recording, or personal configuration is included.

GitHub **Code** 页内语言切换：点击下方“中文 / English”，无需打开另一文件。两个折叠区共用 `name`，展开一个会收起另一个。[GitHub 折叠区说明](https://docs.github.com/en/get-started/writing-on-github/working-with-advanced-formatting/organizing-information-with-collapsed-sections)。

On GitHub's **Code** page, click “中文 / English” below to switch within this README. The sections share a `name`, so opening one closes the other.

<details name="language" open>
<summary><strong>🇨🇳 中文 · 点击切换</strong></summary>

## 使用路线

| 场景 | 数据路径 |
| --- | --- |
| 网页说话 | 按住麦克风 → DSH 已认证连接 → ASR → 输入草稿 → 用户确认发送 |
| 网页朗读 | 点击朗读 → DSH 已认证连接 → TTS → 浏览器播放 |
| QQ 收语音 | OneBot → 可选桥接 → ASR；失败时尝试 OneBot 原生转写 → 现有 QQ 插件 |
| QQ 发语音 | Agent 调用 `voice_tts` → TTS 生成 WAV → 现有 QQ 插件发送 `record` → OneBot 回执 |

**Fish Audio 只负责合成。** 插件要求 TTS 接口接受 `POST /v1/audio/speech`、JSON `{"input":"你好","response_format":"wav"}`，返回 WAV。Fish 原生接口 `POST https://api.fish.audio/v1/tts` 使用 `text`、`reference_id`、`format`、`prosody` 和 `model` 请求头，因此**不能直接填入插件的 `ttsUrl`**。仓库提供 `examples/fish-tts-adapter.mjs` 做私有格式转换；接口可参考 [Fish 官方 SDK](https://github.com/fishaudio/fish-audio-python)。其他符合插件接口的 TTS 也可以使用。

## 1. 准备

- DSH `0.2.1-rc.2` 或兼容 `0.2.x`，Node.js **24+**。先在独立 profile 验证，现网接入前备份 profile。
- 网页收语音需要独立 ASR 服务；网页朗读和 QQ 发语音需要返回 WAV 的 TTS 服务。只用其中一项时，另一项的 URL 可以留空。未配置 TTS 时不注册 `voice_tts`。
- QQ 功能还需要现有 `dsh-onebot-hub`、OneBot 和原有的权限及会话隔离机制。本项目的桥接**不能替代**权限网关。
- 将 Fish Key、音色 `reference_id`、适配器专用令牌、ASR 令牌和 OneBot 令牌分别放在仓库外的私有文件里；每个文件一行，Linux 上建议只允许服务账号读取（权限 `0600`）。不要把真实值放入 Git、README、截图或安装包。

以下 `<profile>` 和 `/private/...` 都是需要替换的占位符。容器里的 `127.0.0.1` 指**该容器自身**；跨容器服务应使用内部网络地址。

## 2. 下载与安装

从 [最新 GitHub Release](https://github.com/6789-6/dsh-voice-conversation-qq-web/releases/latest) 下载 `dsh-voice-conversation.tgz`，核对该 Release 显示的资产摘要。Linux 示例：

```sh
curl -fL -o dsh-voice-conversation.tgz https://github.com/6789-6/dsh-voice-conversation-qq-web/releases/latest/download/dsh-voice-conversation.tgz
dsh plugin --profile <profile> add ./dsh-voice-conversation.tgz
dsh --profile <profile> --dump-config
```

在输出中确认**只有一条** `dsh-voice-conversation-qq-web` 记录。安装包的 `cordis.patch.yml` 已插入插件，**不要再应用** `examples/cordis.patch.yml` 的手动 `insert`。自行打包可在仓库副本运行 `npm ci --ignore-scripts && npm pack`。当前公开下载方式是 GitHub Release，**尚未发布到 npm**。

## 3. 配置语音识别 ASR

ASR 服务须接受 `POST`、`Content-Type: audio/wav` 和 WAV 请求体；如需鉴权，使用 `Authorization: Bearer <ASR 令牌>`。成功响应是非空 JSON，例如：

```json
{"text":"请告诉我今天星期几"}
```

可以使用 SenseVoice 或其他实现，但本仓库不提供 ASR 推理服务。输入 WAV 上限 **2 MiB**，转写上限 **1000 字**。先确认服务在私有网络中符合上述接口，再设置插件 `asrUrl`、`asrTokenFile`。无鉴权服务可留空令牌文件路径。QQ 桥接另有 `VOICE_BRIDGE_ASR_URL` / `VOICE_BRIDGE_ASR_TOKEN_FILE`，可指向同一私有 ASR 服务。

## 4. 配置 Fish Audio 合成：从 Key 到回复

1. 在 Fish Audio 创建 API Key，并取得你有使用权的音色 `reference_id`。分别创建三个私有文件：Fish Key、`reference_id`、**另一个随机适配器令牌**。DSH 使用适配器令牌访问本地适配器，不直接使用 Fish Key；不需要把音色参考音频放到仓库里。
2. 克隆本仓库以运行可选适配器。复制 `examples/fish-tts.env.example` 到仓库外的私有环境文件，只填写三个秘密文件的**路径**。默认 `FISH_MODEL=s2-pro`、`FISH_SPEED=0.9`，可依音色调整。默认监听 `127.0.0.1:9003`，不要开放公网。
3. 替换示例中的私有环境文件与仓库路径，然后启动：

   ```sh
   node --env-file=/private/fish-tts.env /path/to/repository/examples/fish-tts-adapter.mjs
   ```

4. 在私有网络中测试：向 `http://127.0.0.1:9003/v1/audio/speech` 发送 `POST`，带 `Content-Type: application/json`、`Authorization: Bearer <适配器令牌>` 和 `{"input":"你好，我可以发语音。","response_format":"wav"}`。预期 `200`、`audio/wav`。测试客户端应从私有文件读取真实令牌，避免在命令行参数中暴露。`401` 查适配器令牌，`422` 查正文长度，`502` 查 Fish Key、音色使用权、额度、模型和网络。适配器不记录正文或音频。
5. 在插件配置中，将 `ttsUrl` 指向适配器私有地址，`ttsTokenFile` 指向**适配器令牌文件**，而不是 Fish Key 文件。`voice`、`model` 可留空，由适配器选择音色及模型。

每次合成正文最多 **180 字**，WAV 响应最多 **5 MiB**；长回复应分段。请求默认超时 30 秒，`timeoutMs` 可设置为 1000–150000 毫秒。

## 5. 在 DSH profile 中启用

按照 `examples/profile-override.patch.yml`，用插件 **`id` 覆盖已安装条目**，将地址与文件路径改成 DSH 进程实际可达、可读的位置：

```yaml
- id: dsh-voice-conversation-qq-web
  config:
    enabled: true
    asrUrl: http://127.0.0.1:9002/v1/asr
    asrTokenFile: /run/secrets/asr-token
    ttsUrl: http://127.0.0.1:9003/v1/audio/speech
    ttsTokenFile: /run/secrets/tts-token
    voice: ''
    model: ''
    timeoutMs: 30000
```

这里 `ttsTokenFile` 是**适配器令牌**路径。未用的服务可把对应 URL 和令牌文件路径留空。保存并重启该 DSH 实例，再用 `--dump-config` 检查生效配置和单条插件记录。网页 `/api/dsh-voice/asr`、`/api/dsh-voice/tts` 走 DSH **已认证连接**，插件没有单独开放匿名 HTTP 路由。

## 6. 网页操作与验收

1. 用 HTTPS 或 localhost 打开已认证的 DSH Web，进入工作区会话，允许浏览器使用麦克风。
2. **按住 🎤 说话，松开结束**。浏览器转为 16 kHz 单声道 WAV 并调用 ASR。
3. 等转写进入输入草稿，核对或修改文字，再手动发送；松开麦克风**不会自动发消息**。
4. 对已完成的助手回复点击“🔊 朗读”，浏览器播放 TTS；朗读不发送 QQ 消息。

若麦克风按钮不出现，检查插件启用、是否进入会话、安全上下文与麦克风权限。转写失败检查 ASR 地址、令牌文件和 2 MiB 限制；朗读失败检查 TTS 与 180 字限制。

## 7. 可选 QQ 桥接与验收

**先接模拟 OneBot 测试。** 沿用现有 QQ 插件的消息及会话机制，不复制或修改它的源码。推荐拓扑为 `DSH QQ hub → 原有权限网关 → 本语音桥接 → OneBot`。桥接上游指向 OneBot，原有网关的下游目标指向桥接。修改现网前备份原网关目标和 QQ 配置。

1. 在仓库外建立私有环境文件，参考 `examples/bridge.env.example` 配置 `VOICE_BRIDGE_UPSTREAM_URL`、上下游令牌文件、`VOICE_BRIDGE_ALLOWED_SENDERS_FILE`、`VOICE_BRIDGE_ASR_URL` 和可选 ASR 令牌文件。白名单文件**每行一个 QQ 账号 ID**，不得提交到 Git。
2. 在仓库副本安装依赖并启动桥接：

   ```sh
   npm ci --ignore-scripts
   node --env-file=/private/voice-bridge.env /path/to/repository/bin/voice-bridge.js
   ```

   默认监听 `127.0.0.1:3092`。跨容器时只允许网关通过内网连接，且上下游 Bearer 令牌须与连接端一致；桥接只接受一个下游客户端。
3. 在现有 QQ hub 中设置 `tts.provider=plugin`、`tts.plugin.tool=voice_tts`。确保 Agent 能调用 `voice_tts`，现有 QQ 插件能通过 `onebot_reply` 发送 `record`。普通回复可由 Agent 判断文字或语音；用户明确要求语音时应先尝试合成。`status=synthesized` **只代表 WAV 已生成**，之后须发送 `record`，得到成功回执才可说“已发送”；失败时如实反馈。
4. 用白名单账号发送短语音，再发“请用语音回复”；核对转写后的回答及可播放的 QQ 语音。模拟 ASR 超时，验证会尝试 OneBot 原生 `fetch_ptt_text`；用非白名单账号验证阻止；核对不同账号仍使用独立会话。桥接过滤非白名单私聊消息和群消息，但原权限网关仍须保留。

## 8. 排错与回退

| 现象 | 检查顺序 |
| --- | --- |
| 安装后没有配置项 | DSH 版本、`--dump-config` 插件 ID、是否错误叠加手动 `insert` |
| 网页转写失败 | 从 **DSH 进程**能否访问 ASR、令牌文件、`{"text":"..."}` 响应、2 MiB 限制 |
| Fish 适配器 `401` / `502` | `401` 查适配器令牌；`502` 查 Fish Key、音色权限、额度、模型及网络 |
| QQ 语音合成了但没送达 | 分别看 `voice_tts` 的 `synthesized` 和 `onebot_reply` 回执；确认 OneBot 能读取 `record` 文件路径 |
| QQ 收语音没转写 | 桥接白名单、连接、ASR 超时、OneBot `get_record` WAV 与 `fetch_ptt_text` 能力 |
| 网页麦克风不可用 | HTTPS/localhost、浏览器权限、是否进入会话 |

回退时停止桥接、把权限网关目标恢复为原 OneBot 地址、移除 profile 中本插件配置覆盖，再用 DSH 插件管理器移除安装包。保留备份直到网页和 QQ 都通过验收；插件不迁移聊天记录。进一步步骤见 [现网接入清单](docs/LIVE-INTEGRATION.md)。

## 9. 开发与隐私

`npm ci --ignore-scripts && npm test` 运行模拟服务测试；发布前检查 `npm pack --dry-run` 及实际压缩包。[隔离测试记录](docs/TEST-RESULTS.md)说明已验证范围；真实 QQ、外部语音服务及音色质量需安装者另行验收。临时 WAV 限大小并定时清理，日志不记录音频或转写正文。项目采用 [MIT 许可证](LICENSE)。

</details>

<details name="language">
<summary><strong>🇬🇧 English · click to switch</strong></summary>

## Speech routes

| Scenario | Data path |
| --- | --- |
| Web speech input | Hold mic → authenticated DSH connection → ASR → draft transcript → user confirms sending |
| Web read-aloud | Click read-aloud → authenticated DSH connection → TTS → browser playback |
| QQ speech input | OneBot → optional bridge → ASR; native OneBot transcription fallback → existing QQ plugin |
| QQ speech output | Agent calls `voice_tts` → TTS creates WAV → existing QQ plugin sends `record` → OneBot receipt |

**Fish Audio only synthesizes speech.** The plugin expects `POST /v1/audio/speech`, JSON `{"input":"Hello","response_format":"wav"}`, and WAV output. Fish's native `POST https://api.fish.audio/v1/tts` instead uses `text`, `reference_id`, `format`, `prosody`, and a `model` header. **Do not put the native Fish URL directly in `ttsUrl`.** The optional `examples/fish-tts-adapter.mjs` converts the formats privately; see the [official Fish SDK](https://github.com/fishaudio/fish-audio-python). Any other TTS provider implementing the plugin interface is also supported.

## 1. Prepare

- DSH `0.2.1-rc.2` or compatible `0.2.x`, plus Node.js **24+**. Verify in an isolated profile first; back up a production profile before rollout.
- Web speech input needs a separate ASR service; Web read-aloud and QQ output need a TTS service returning WAV. Leave an unused service URL empty. Without TTS, the plugin does not register `voice_tts`.
- QQ also requires an existing `dsh-onebot-hub`, OneBot implementation, and your existing permission and session isolation. The bridge **does not replace** a permission gateway.
- Put the Fish key, voice `reference_id`, local adapter token, ASR token, and OneBot tokens in separate private files **outside the repository**. One value per file; mode `0600` is recommended on Linux. Never commit real values or put them in screenshots or public packages.

`<profile>` and `/private/...` below are placeholders. Inside a container, `127.0.0.1` means **that container**; use private service addresses across containers.

## 2. Download and install

Download `dsh-voice-conversation.tgz` from the [latest GitHub Release](https://github.com/6789-6/dsh-voice-conversation-qq-web/releases/latest), and verify the asset digest shown there. Linux example:

```sh
curl -fL -o dsh-voice-conversation.tgz https://github.com/6789-6/dsh-voice-conversation-qq-web/releases/latest/download/dsh-voice-conversation.tgz
dsh plugin --profile <profile> add ./dsh-voice-conversation.tgz
dsh --profile <profile> --dump-config
```

Confirm **exactly one** `dsh-voice-conversation-qq-web` row. The package `cordis.patch.yml` inserts it; **do not also apply** the manual `examples/cordis.patch.yml` insert. To build from a checkout, run `npm ci --ignore-scripts && npm pack`. Public download is currently through GitHub Release; the package is **not yet on npm**.

## 3. Configure ASR

The ASR service must accept `POST`, `Content-Type: audio/wav`, and WAV bytes. If authenticated, it receives `Authorization: Bearer <ASR token>`. Successful JSON looks like:

```json
{"text":"What day is it today?"}
```

SenseVoice or another implementation can provide this endpoint; this repository does not run ASR inference. Input WAV is limited to **2 MiB** and transcript to **1000 characters**. Verify the contract on the private network, then set plugin `asrUrl` and `asrTokenFile`. Leave the token path empty if unused. The QQ bridge has separate `VOICE_BRIDGE_ASR_URL` / `VOICE_BRIDGE_ASR_TOKEN_FILE` settings and may share the private ASR service.

## 4. Configure Fish Audio: key to spoken reply

1. Create a Fish Audio API key and obtain a voice `reference_id` you are allowed to use. Create three private files: Fish key, `reference_id`, and **a separate random adapter token**. DSH calls the local adapter with the adapter token, never the Fish key. Reference audio is not needed in the repository.
2. Clone this repository for the optional adapter. Copy `examples/fish-tts.env.example` into a private env file outside the checkout and set the **paths** to the three secret files. Defaults are `FISH_MODEL=s2-pro`, `FISH_SPEED=0.9`, and bind address `127.0.0.1:9003`. Tune the voice settings as needed; never expose the listener publicly.
3. Replace the private env and checkout paths, then start with Node.js 24+:

   ```sh
   node --env-file=/private/fish-tts.env /path/to/repository/examples/fish-tts-adapter.mjs
   ```

4. Test the private endpoint: `POST http://127.0.0.1:9003/v1/audio/speech` with `Content-Type: application/json`, `Authorization: Bearer <adapter token>`, and `{"input":"Hello, I can speak.","response_format":"wav"}`. Expect `200` and `audio/wav`. Have your test client read the real token from its private file instead of putting it in a shell command argument. For `401`, check the adapter token; for `422`, text length; for `502`, Fish key, voice permission, balance, model, and network. The adapter logs neither text nor audio.
5. Set plugin `ttsUrl` to the private adapter URL and `ttsTokenFile` to the **adapter token file**, not the Fish key file. Leave plugin `voice` and `model` empty when the adapter selects them.

Each synthesis request allows **180 characters** of text and at most **5 MiB** of WAV; split longer replies. Requests default to a 30-second timeout; `timeoutMs` accepts 1000–150000 milliseconds.

## 5. Enable the DSH profile

Use `examples/profile-override.patch.yml` to override the **existing plugin ID**. Replace URLs and paths with values reachable and readable from the DSH process:

```yaml
- id: dsh-voice-conversation-qq-web
  config:
    enabled: true
    asrUrl: http://127.0.0.1:9002/v1/asr
    asrTokenFile: /run/secrets/asr-token
    ttsUrl: http://127.0.0.1:9003/v1/audio/speech
    ttsTokenFile: /run/secrets/tts-token
    voice: ''
    model: ''
    timeoutMs: 30000
```

`ttsTokenFile` points to the **adapter token**. Leave an unused service URL and token path empty. Save and restart this DSH instance, then check the effective configuration and single plugin row with `--dump-config`. Web `/api/dsh-voice/asr` and `/api/dsh-voice/tts` run through DSH's **authenticated connection**; no separate anonymous HTTP route is opened.

## 6. Web operation and acceptance

1. Open authenticated DSH Web over HTTPS or localhost, enter a workspace conversation, and allow microphone access.
2. **Hold 🎤 to speak and release to finish.** The browser converts audio to 16 kHz mono WAV and calls ASR.
3. Review or edit the transcript in the input draft, then send manually. Releasing the mic **does not auto-send**.
4. Click “🔊 Read aloud” on a completed assistant reply for browser playback. This does not send QQ audio.

If the mic control is absent, check plugin enablement, active conversation, secure context, and mic permission. For transcription failures check ASR URL, token file, and the 2 MiB limit; for playback failures check TTS and the 180-character limit.

## 7. Optional QQ bridge and acceptance

**Test against a mock OneBot first.** Existing QQ plugin code still owns messages and sessions; this project neither copies nor modifies it. Recommended topology: `DSH QQ hub → existing permission gateway → this voice bridge → OneBot`. The bridge upstream points to OneBot; the gateway downstream target points to the bridge. Back up the old gateway target and QQ configuration before production changes.

1. Create a private env file outside the checkout using `examples/bridge.env.example`. Configure `VOICE_BRIDGE_UPSTREAM_URL`, both token file paths, `VOICE_BRIDGE_ALLOWED_SENDERS_FILE`, `VOICE_BRIDGE_ASR_URL`, and optionally the ASR token file. The allowlist contains **one QQ account ID per line** and must stay out of Git.
2. In the checkout, install dependencies and start the bridge:

   ```sh
   npm ci --ignore-scripts
   node --env-file=/private/voice-bridge.env /path/to/repository/bin/voice-bridge.js
   ```

   It binds to `127.0.0.1:3092` by default. Across containers, use a private network reachable only by the gateway and match the upstream/downstream Bearer tokens at both ends. Only one downstream client is accepted.
3. In the existing QQ hub set `tts.provider=plugin` and `tts.plugin.tool=voice_tts`. Ensure the Agent can call `voice_tts` and the existing QQ plugin can send a `record` segment using `onebot_reply`. The Agent can choose text or voice for ordinary replies; it should try synthesis for an explicit voice request. `status=synthesized` **only means the WAV exists**. A later `record` send and successful receipt are required before saying voice was **sent**. Report failures honestly.
4. From an allowlisted account, send a short recording and then request a spoken reply. Confirm it answers the recording and sends playable QQ audio. Simulate an ASR timeout to check native OneBot `fetch_ptt_text` fallback. Check that a non-allowlisted account is blocked and separate QQ accounts keep separate conversations. The bridge filters non-allowlisted private messages and group messages; keep the existing permission gateway.

## 8. Troubleshooting and rollback

| Symptom | Check |
| --- | --- |
| No settings after installation | DSH version, plugin ID in `--dump-config`, accidental duplicate manual `insert` |
| Web transcription fails | ASR reachable **from DSH**, readable token file, `{"text":"..."}` response, 2 MiB limit |
| Fish adapter returns `401` / `502` | `401`: adapter token; `502`: Fish key, voice access, balance, model, network |
| QQ voice synthesized but not delivered | Compare `voice_tts`'s `synthesized` with the `onebot_reply` receipt; check OneBot can read the `record` path |
| Incoming QQ speech is not transcribed | Bridge allowlist, connections, ASR timeout, OneBot `get_record` WAV and `fetch_ptt_text` support |
| Browser microphone unavailable | HTTPS/localhost, browser permission, active conversation |

To roll back, stop the bridge, restore the permission gateway's old OneBot target, remove this plugin's profile override, and uninstall the package through DSH plugin management. Keep the backup until Web and QQ pass acceptance. The plugin does not migrate chat history. See the [production integration checklist](docs/LIVE-INTEGRATION.md).

## 9. Development and privacy

Run `npm ci --ignore-scripts && npm test` for mock-service tests; inspect `npm pack --dry-run` and the actual tarball before publishing. The [isolated test report](docs/TEST-RESULTS.md) explains the verified scope. Real QQ, external speech providers, and voice quality require separate installer acceptance. Temporary WAV files have size limits and scheduled cleanup; logs contain neither audio nor transcript bodies. [MIT license](LICENSE).

</details>
