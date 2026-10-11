# Tuff v2.4.14 Release Notes

## Summary Notes

- Home keeps a voice draft after dictation, with playback, recognition retry, and voice-message sending.
- Refine the Home conversation layout, project action menus, composer chips, and mode-choice motion.
- Preserve model options for local CLI providers, while keeping project conversations and attachments in local storage.
- Add TuffEx voice-playback, flow-light, and voice-wave components; reduce Nexus telemetry writes and fix client-IP trust.
- Add the local loopback MCP Host as an opt-in Beta capability, with safer listener rebinding.

## What's New

- Compatible external AI clients can call Tuff tools through the local loopback MCP Host; every call still requires user confirmation.

## What's Changed

- Keep the latest recording after dictation so it can be replayed or recognized again even if recognition fails; show explicit sending and dismissal states.
- Save voice attachments with conversation messages, with play, pause, seeking, duration, and waveform controls.
- Unify Home conversation outputs and panel layout, and fix row measurement when restoring conversation history.
- Add transitions to composer chips and mode choices, and refine project action menus.
- Preserve model options for local CLI providers so available local-model entries do not disappear after configuration loads.
- Exclude project conversations from cloud-sync snapshots and keep their conversations and attachments in local project storage.
- Give development builds their own single-instance lock and temporary-file directory to avoid interference with installed builds.
- Add TxVoiceClip, TxFlowLight, and organic voice-wave motion to TuffEx, with component examples and interaction documentation.
- Align TuffEx 0.7.0 version metadata, component lifecycle, and bilingual documentation, and update size-audit baselines for new components.
- Adjust Nexus telemetry queries and indexes to reduce database writes for ordinary events while preserving aggregation and retention behavior.
- Prefer CF-Connecting-IP behind Cloudflare so forged X-Forwarded-For values cannot bypass device-authorization IP limits or corrupt audit records.
- Wait for the old MCP listener to finish closing before rebinding after a port change or restart.
- Show the MCP Host Beta status in settings while keeping it disabled by default and preserving the user-confirmation boundary.

## Known Limitations

- Project conversations remain local and do not sync across devices.
- Mainland China access improvements for Nexus are still under evaluation; this release does not change DNS, add another proxy, or migrate production builds.
- The MCP Host currently supports local loopback only and remains an opt-in Beta capability outside the Stable core commitment.
