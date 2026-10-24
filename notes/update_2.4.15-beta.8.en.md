# Tuff v2.4.15-beta.8 Release Notes

## Summary Notes

- CoreBox search animation optimization: disable list item entrance stagger and result transition animations by default to reduce render stalls and boost responsiveness.
- Search and file index capacity management (A18): enforce storage size caps with a 2% deletion reserve; automatically evict older files when full and expose the capacity horizon in Settings.
- Settings page and navigation fallback recovery: fix navigation guard issue where clicking Settings without browser workspace enabled redirected back to home, and restore category sidebar navigation.
- Application discovery resilience: fallback to bounded folder traversal when macOS Spotlight index is stale or rebuilding, preventing empty installed application results.

## What's Changed

- Set `appSetting.animation.listItemStagger` and `resultTransition` to `false` by default, keeping CoreBox result updates immediate and high frame-rate.
- Introduce `search_keyword_postings` integer document postings (migration 0055) to compress keyword mappings; modularize FileProvider into dedicated services.
- Enforce search index size caps (min of 8 GiB or 2% volume), introduce capacity eviction mode (purging bottom 10% quantile older files) with a write deletion reserve, and display capacity horizon notices in Settings.
- Fix `ShellSidebar.vue` navigation guards: route directly to `/setting` when `browserWorkspace` is disabled, and restore complete category sidebar navigation and back controls.
- Enhance Darwin application discovery (`darwin.ts`) to merge `mdfind` with bounded filesystem traversal, ensuring installed apps remain indexed during Spotlight rebuilds.
