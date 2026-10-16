# Tuff v2.4.15-beta.6 Release Notes

## Summary Notes

- CoreBox preview auto-expansion: Automatically expand the CoreBox window to its maximum height (600px) when a file or plugin preview is active, eliminating media clipping and squashed letterbox artifacts on single-result searches.
- TuffEx squircle curvature and surface tokens: Introduce smooth superellipse corner mixins, align component surface materials and dark-mode contrast ramps, and upgrade Markdown editor components.
- Nexus documentation and design concept showcases: Add interactive demonstration surfaces covering curvature combs, light blending, refraction layering, and color science, along with a collaborative Markdown playground.
- Global accessibility and internationalization polish: Provide localized label support for icon-only buttons across dialogs, drawers, and alerts, and add a gradient variant to TxThinkingOrb.

## What's Changed

- Fix CoreBox clipping video and image previews into distorted letterbox stages when queries hit single rows (~114px window height); wire `hasPreview` through `useResize` and `useSearch` to smoothly expand the launcher to 600px during preview and adaptively restore window bounds on dismissal.
- Implement superellipse squircle curvature mixins powered by `corner-shape: superellipse` across TuffEx; expose `--tx-corner-smooth-*` tokens; rewrite Markdown editor collaboration overlays, toolbars, inline marks, and status panels; calibrate dark-mode neutral contrast ramps.
- Add over 20 interactive concept showcases to Nexus covering curvature combs, optical refraction, specular highlights, spring interruptions, and streaming pacing; provide an integrated collaborative Markdown editor demo room.
- Enhance component accessibility (a11y) by configuring localized `closeLabel` and `ariaLabel` props for TModal, TxDrawer, TxAlert, and TxToastHost to eliminate English speech reader fallbacks in Chinese UI; add `variant="gradient"` palette options to TxThinkingOrb.
