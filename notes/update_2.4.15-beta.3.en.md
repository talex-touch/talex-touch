# Tuff v2.4.15-beta.3 Release Notes

## Summary Notes

- Update and startup improvements: Add an update handoff lock, prefer APFS clone copies for macOS installation and recovery, and run packaged-build attestation verification in the background.
- Expanded voice input: Add Nexus realtime recognition and custom script providers, introduce a terminology vocabulary, and support opt-in AI polishing that replaces live-delivered text when dictation ends.
- Improved TuffEx data interactions: Select automatically offers search for larger option lists, while DataTable gains semantic cells and type-aware column filters.
- Expanded bilingual developer documentation: Add design concepts and engineering rules, introduce interactive sound auditions, and fix delayed component-document rendering and missing TuffEx build artifacts during Nexus development startup.
- Add a bilingual promotional video player to the website with language switching, chapter navigation, and preserved playback progress.

## What's Changed

- Add an active update handoff lock with process, token, and expiry checks, and validate lock-file field types. When the external update helper is still running, the old application exits to yield to installation rather than prematurely requesting recovery. macOS installation, backup, and recovery prefer APFS clone copies, with conventional copying as a fallback.
- Run packaged-build attestation verification in the background so module startup no longer waits for ASAR hashing to finish; verification results remain recorded and available to callers.
- Add a Nexus Realtime recognition route that obtains a short-lived token through the signed-in session and connects to Qwen realtime speech recognition. Fix JSON decoding of token responses and fall back to buffered recognition if token acquisition fails.
- Add a custom script voice provider for streaming sessions or uploaded-file transcription, with HTTP, WebSocket, and timeout support for developers integrating their own recognition services.
- Add a hotword and terminology field to voice settings for names, specialized terms, and English abbreviations. Custom words are merged and deduplicated with built-in technical vocabulary, then passed to recognition requests, local Whisper prompts, and AI polish context.
- Support end-of-session polishing of live-delivered dictation through the `livePolish` request option. Recheck that the target application has not changed before replacing text, preventing revisions from being delivered to another application.
- Enable Select search automatically when the option count reaches 8 by default, for both single and multiple selection. Developers can adjust `searchThreshold` or explicitly set `searchable: false` to disable automatic search.
- Add semantic DataTable column types for numbers, dates, tags, sources, and actions, with text search, multi-select tag filters, numeric ranges, date shortcuts, and custom tag-filter options.
- Expand Chinese and English design-system documentation with concepts and engineering constraints for geometry and curvature, surface materials, dark palettes and contrast, typography, micro-motion, and AI streaming interfaces.
- Add an interactive audition panel to the sound documentation for 7 micro-interaction feedback sounds, with live parameter adjustments to help developers choose and customize interface audio.
- Stop deferring component-document bodies while the performance panel is pending. When TuffEx build artifacts are missing during Nexus development startup, attempt an automatic build and allow a fallback to source development mode.
- Add a Chinese and English promotional video modal showcasing Tuff's core experience. The player offers chapter navigation and preserves playback position and playing state when switching video languages.

## Known Limitations

- Nexus realtime voice usage settlement currently relies on client-reported audio duration and text volume, not independent server-side metering; the cloud voice billing flow has not completed real end-to-end acceptance testing.
