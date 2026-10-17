# Tuff v2.4.15-beta.7 Release Notes

## Summary Notes

- TuffEx button size animation fix: resolve an issue where `useFlip` ignored `height: false` on cancellation and froze an inline height style, collapsing the button.
- Update status button layout guard: enforce minimum height and flex-shrink constraints on update status action buttons in Settings.
- Application update health acknowledgment recovery: prioritize startup health verification for awaiting-health attempts during lifecycle restoration, preventing successful updates from being misreported as stale failures.

## What's Changed

- Fix `useFlip` utility under `mode: 'size'` to respect `opt.size.height` when freezing interrupted dimensions, and add `min-height: var(--tx-button-height)` to `.tx-button` to prevent height collapse.
- Enhance `SettingUpdateStatus` action button styling with `min-height: var(--tx-button-height, 32px)` and `flex-shrink: 0` to prevent layout collapse.
- Fix lifecycle restoration order in `UpdateService`: prioritize `confirmStartupHealth` for attempts in `awaiting-health` or `handoff-started`, transitioning successfully verified updates to `healthy` (updated) instead of falling into `UPDATE_ATTEMPT_STALE`.
