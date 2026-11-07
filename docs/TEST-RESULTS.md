# Isolated verification report

Date: 2026-11-07. Current source version: `0.1.3`. Isolated server DSH verification used core package `0.1.0`; the added Fish adapter was tested locally. Target DSH: `0.2.1-rc.2`.

The package was developed in a separate DSH profile on an internal Docker network, with its own state, workspace, port, and resource limit. The lab had no production DSH mount, model credential, or live QQ connection.

| Check | Result |
| --- | --- |
| Local deterministic tests (0.1.3 source) | 14 passed, 0 failed |
| Clean tarball install | `npm install --ignore-scripts` succeeded in a temporary directory; plugin entry and configuration schema imported |
| Isolated local DSH 0.2.1-rc.2 profile (0.1.3) | `dsh plugin add` succeeded; `pnpm peers check` found no issues; plugin entry and configuration schema imported |
| Isolated server DSH tests (0.1.0 core package) | 13 passed, 0 failed |
| DSH plugin manager install | Package loaded once in the composed profile |
| DSH plugin manager uninstall | Dependency removed from the isolated profile |
| Web browser boot | Mic control appeared after opening an isolated workspace |
| Web press-to-talk | Simulated microphone release inserted the mock transcript into the draft without sending it |
| Authenticated ASR/TTS routes | Mock ASR returned text and mock TTS returned a WAV; anonymous requests were rejected |
| QQ bridge | Fake OneBot verified allowlist filtering, ASR fallback, message identity, and `record` send receipt |
| Package audit | The actual tarball was scanned for private identifiers, addresses, paths, and key patterns; no matches |

The browser microphone and audio playback checks used deterministic test doubles. No real QQ account, real external speech provider, voice quality, or Agent model behavior was exercised. Those remain acceptance checks for a later, separately authorized production integration.

The private package is an intentional local tarball dependency. pnpm 11's default release-age verifier may query the public registry for its name during removal. The isolated profile used a name-specific `minimumReleaseAgeExclude` entry so package removal stayed offline; all other dependencies retained their normal policy.
