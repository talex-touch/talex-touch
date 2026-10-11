# Tuff v2.4.14 Release Notes

## Summary Notes

- Improve first-open input, keyboard navigation, and recommendations in CoreBox, with direct actions for directories and URLs.
- Use bounded scans, incremental reconciliation, and CPU yielding for file indexing; content indexing is off by default.
- Add folder projects and native CLI session resumption to Home, with input and resizing in embedded terminals.
- Support local models and cloud channels for dictation, retain recording drafts, and send voice messages.
- Strengthen plugin permissions, privacy, and login sessions; offer the local MCP Host as an opt-in Beta capability.
- Recover update downloads from expired signed URLs and keep local installation history with explicit failure states.

## What's New

- Run local AI CLIs in an existing folder project and resume their native sessions across panel closure and app restarts; embedded terminals use native PTYs.
- Select on-device recognition after installing a local voice model, independently of cloud dictation and its catalog; model installation and removal refresh available routes.
- Keep dictation recordings as Home drafts for playback, recognition retry, and voice-message sending; voice attachments include play, pause, seeking, duration, and waveform controls.
- Use the bundled Browser entry to open URLs in a local browser, configure search engines, and add shortcuts; the official JSON Formatter supports formatting, minifying, and validation.
- Use the main-window command palette and Home permission, mode, and model chips; the skill library can read installed agents' skill directories directly.
- Expose Tuff tools to compatible external AI clients through the local loopback MCP Host, with tool authorization and the user-confirmation boundary preserved.

## What's Changed

- Fix first-open CoreBox input focus, incorrect window preload paths, and missing search content when animations are disabled.
- Base recommendations on real usage history, time, and the foreground app, with separate reasons; show a learning hint rather than invented frequent items.
- Match keyboard grid navigation to rendered columns and let number keys execute or select; Esc dismisses overlays, attachments, and input in stages, while macOS Option shortcuts retain the physical key.
- Avoid recursively enumerating existing files when macOS watching starts and reconcile affected subtrees after changes; fix index-connection, lease, and shutdown cleanup.
- Bound full-scan and write batches and yield CPU between them; require resource and privacy confirmation for content indexing and clear retained text when it is disabled.
- Prevent stale results from overwriting newer searches, and let users retry the current query after waiting or failure.
- Show original clipboard images and OCR details; run native OCR in an isolated process, fix its post-result exit race, and avoid re-encoding large copied images on the main thread.
- Use the Fn/Ctrl dictation capsule, with optional denoising and length-based refinement; distinguish authentication, timeout, upstream availability, and model-catalog failures.
- Unify Home conversation layout and restored-history row measurement; preserve local CLI model options and consolidate configuration and routing through Provider Registry and Scene.
- Run plugins in an isolated host and bind permission answers to plugin identity and the permission set; retain truthful installation, enablement, and cancellation failures instead of marking incomplete installs usable.
- Support short- and long-term login sessions with safe renewal; account disabling, device revocation, and token-version changes still invalidate sessions.
- Move app management into split list/detail settings, consolidate advanced and duplicate entries, and improve skeleton loading, empty states, and assistive-technology feedback.
- Respect update-download concurrency limits without a fixed total timeout while data keeps arriving; switch to the fallback URL after a confirmed signed-URL HTTP 403 and retain completed chunks.
- Use the newly installed version for startup health acknowledgement and retain local installation history; continue enforcing signature and integrity checks.
- Wait for the previous MCP listener to close before rebinding, and share one listener across concurrent starts so a port race cannot disable the host switch.
- Give development builds their own single-instance lock and temporary files to avoid cross-build cleanup; update TuffEx voice, chart, and motion components with bilingual documentation.
- Correct Nexus client-IP trust and reduce telemetry database writes, with reorganized admin and documentation navigation.

## Breaking Changes

- Remove the floating voice entry and CoreBox's top-level local CLI button; invoke dictation with Fn/Ctrl and use the corresponding agent-management and project entries for local agents.
- Local CLIs no longer join AI routing by default and must be enabled in channel settings; the app manages the local speech-recognition route outside the editable channel list.
- Keep project conversations and attachments local and exclude them from cloud-sync snapshots; native session records remain with their providers.

## Known Limitations

- The MCP Host is an opt-in, local-loopback-only Beta capability outside the Stable core commitment; the complete external-client path has not been accepted across platforms.
- This release does not advertise automatic downgrade compatibility; recovery remains subject to the release manifest and health checks, and downgrading may not preserve all new data.
- A native Ghostty renderer is not embedded; equivalent foreground-app-switch recommendation scenarios have not been fully covered on Windows and Linux.
- Mainland China access improvements for Nexus remain under evaluation; this release does not change DNS, add a proxy, or migrate production builds.
