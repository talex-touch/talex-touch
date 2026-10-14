# Tuff v2.4.15-beta.2 Release Notes

## Summary Notes

- Local Semantic Search & Multimodal Indexing: Introduce verified on-device EmbeddingGemma runtime with image vector extraction, PDF/code chunk indexing, exact content snippet hits, and disk capacity safety pauses.
- Search Performance & Main-Thread Relief: Offload file candidate hydration to the search read worker, clamp Spotlight timeouts, and add n-gram typo tolerance with deep match preview.
- CoreBox Enhancements & Snippet Navigation: Search installed plugins directly, trigger features via command prefix plus space, and integrate Quick Flow actions, file context sharing, and clipboard preview improvements.
- System Performance Diagnostics: Add performance and process tree inspection dashboards with detailed metrics for CPU, memory, worker threads, and event loop lag telemetry.
- Web-View Translation & Plugin Refinements: Open translation in a dedicated WebContent view, enforce consistent component border-box sizing in TuffEx, and improve plugin localization and official dev seeds.

## What's Changed

- Integrate local EmbeddingGemma runtime for bounded content chunks and exact snippet recall, with automatic indexing pauses before disk exhaustion.
- Improve file search responsiveness by offloading candidate hydration to a read worker, clamping Spotlight query timeouts, and recovering filename typos with n-grams.
- Refine CoreBox command workflows to enter features by typing prefix and space, manage installed plugins from search, and separate Quick Flow and file sharing actions.
- Enhance file previews and expression cards with highlighted text snippets, keep original card titles, and fix date arithmetic parsing and Chinese physical constants.
- Add a Performance section in Settings with full process trees, worker thread metrics, event loop lag monitoring, and granular component resource diagnostics.
- Upgrade translation plugin to open as a dedicated WebContent page, improve clipboard preview authorization, and ensure clean dismissal states.
- Streamline Nexus model routing and provider registry, default navigation to analytics, add usage trend charts and probe bars, and dynamically fetch models.
