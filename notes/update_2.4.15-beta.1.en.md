# Tuff v2.4.15-beta.1 Release Notes

## Summary Notes

- CoreBox adds detach and transfer window shortcuts with customizable keybindings in settings.
- Refine MetaOverlay blur synchronization so only the Flow picker page blurs the background.
- Introduce SDKAPI 261011 to decouple host capabilities and open them to external plugins.
- Upgrade all official plugins to 261011, consolidate window and system actions, and provide package build scripts.
- TuffEx Button supports progress states, and UpdateService improves cross-channel release resolution.

## What's Changed

- Add window-level shortcut registrations for Detach (default ⌘D / Ctrl+D) and Transfer (default ⌘⇧D / Ctrl+Shift+D) in settings without hijacking global OS shortcuts.
- Update MetaOverlay blur to only blur the host window and plugin WebContentsView on Flow picker pages, with blur cleanup on actions lists and ⌘K pass-through from plugin views.
- Add SDKAPI 261011 (compatible with 20261011) to expose Host Capability APIs to authorized external plugins and unblock installation/uninstallation of official plugins.
- Upgrade all 28 official plugins to 261011, add standard package.json build configurations for 9 plugins, and consolidate window-presets and quick-actions into core action plugins.
- Refine touch-quickops keywords by removing overbroad terms that collided with native settings search.
- Enhance TuffEx Button with dynamic progress animation and documentation demos, and use semver-safe version comparisons in UpdateService for cross-channel builds.
