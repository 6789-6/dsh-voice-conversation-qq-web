# Later production integration

These are instructions for a separate rollout. The isolated development run did not apply them to a live DSH or QQ service.

1. Back up the target DSH profile and the existing QQ hub/gateway configuration. Verify the DSH and `dsh-onebot-hub` versions against the package requirements, and test the tarball in a staging profile first.
2. Verify the package checksum, inspect the tarball, then install it with `dsh plugin --profile <profile> add ./dsh-voice-conversation-qq-web-0.1.1.tgz --offline`. Confirm `dsh --profile <profile> --dump-config` has exactly one `dsh-voice-conversation-qq-web` entry.
3. Apply the **id-targeted** configuration from `examples/profile-override.patch.yml` to the private profile. Set ASR/TTS endpoint URLs and paths to private token files. Keep tokens and any voice identity parameters out of the package. Do not apply the example's manual `insert` patch on top of the package bundle.
4. Verify Web authentication still protects `/api/dsh-voice/asr` and `/api/dsh-voice/tts`. Test press-to-talk, transcript confirmation, and read-aloud through the authenticated Web UI. A transcript remains a draft until the user sends it.
5. For QQ, keep the existing per-account conversation and memory policy. Place the optional voice bridge between the existing permission gateway and the OneBot implementation: `DSH QQ hub -> permission gateway -> voice bridge -> OneBot`. Bind the bridge to a private interface, supply its allowlist and tokens through private files, and start with a fake OneBot first. The bridge is not a replacement for the permission gateway.
6. Configure the QQ hub's TTS provider as `plugin` and its plugin tool as `voice_tts`. The Agent may choose text or voice for ordinary replies. For an explicit voice request, instruct it to try `voice_tts`, then pass the returned path to `onebot_reply` as a `record` part. Only a successful `onebot_reply` receipt means the voice was sent; `status: synthesized` means only that audio was created.
7. Test an allowlisted account's inbound speech, native transcription fallback after ASR failure, outgoing voice, failed-send reporting, and a blocked account. Confirm separate QQ accounts keep separate sessions. Verify the persona and voice quality with the selected external providers before enabling broader use.

For private tarball packages, pnpm 11 may check an unpublished package name against the public registry when removing it. If that happens, add only `dsh-voice-conversation-qq-web` to `minimumReleaseAgeExclude` in that profile's `pnpm-workspace.yaml`, after reviewing the tarball and checksum. Do not disable the policy globally.

Rollback: stop the bridge, restore the QQ gateway's previous OneBot target, remove the plugin's profile override, and remove the package from the target profile. Keep the prior profile backup until Web and QQ acceptance checks pass. No conversation data migration is required by this plugin.
