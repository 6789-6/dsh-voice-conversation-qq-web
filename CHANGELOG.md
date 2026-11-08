# Changelog

## 0.1.4 — 2026-11-08

- Expanded the single-page Chinese and English README into a detailed installation, Fish Audio, ASR, Web, QQ bridge, troubleshooting, and rollback guide.
- No runtime behavior changed in this release.

## 0.1.3 — 2026-11-07

- Added a bundled schema fallback so clean DSH profiles expose the plugin configuration even when the official schema peer is not present in the profile.
- Kept official DSH packages as optional peers while retaining installable runtime files in the release tarball.
- Supersedes 0.1.2 for clean DSH profiles, where the schema peer could be absent.

## 0.1.2 — 2026-11-07

- Prepared the package for public GitHub Release distribution with repository, license, and DSH peer metadata.
- Moved the official schema package to a peer dependency and kept the standalone WebSocket runtime bundled.
- Updated the bilingual README with a stable release download path. The npm package is not yet published.

## 0.1.1 — 2026-11-07

- Added an optional generic Fish Audio TTS adapter and a complete same-page Chinese/English README.
- Kept API keys and voice IDs in runtime-only private files; no production integration or npm publication.

## 0.1.0 — 2026-11-07

- Added authenticated Web press-to-talk transcription and per-message read-aloud.
- Added configurable external ASR/TTS services and a synthesis tool with explicit delivery status.
- Added an optional allowlist-aware OneBot voice bridge with native ASR fallback.
- Added isolated mock tests, deployment examples, a package audit, and release documentation.

The npm package has not been published or connected to a production DSH or QQ account.
