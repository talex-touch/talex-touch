# Tuff v2.4.15-beta.4 Release Notes

## Summary Notes

- TuffEx table interaction fix: Resolve DataTable column filter popovers being constrained to trigger button width causing vertical character wrapping and distorted capsule layouts.
- Voice protocol and ecosystem expansion: Add Doubao IME cloud bidirectional streaming speech protocol adapter and publish a comprehensive desktop voice ecosystem survey report.
- Core performance optimizations: Streamline clipboard image signature calculation, cache speech model catalogs in main process, and introduce streaming frozen-offset delivery to minimize dictation latency.

## What's Changed

- Fix DataTable column filter popovers inheriting trigger button width (20px); explicitly disable reference width matching (`:match-reference-width="false"`) and configure minimum panel width with compact padding so date, tag, and numeric filters render correctly.
- Add `doubao-ime` cloud speech protocol and provider adapter supporting WebSocket binary bidirectional streaming, SAMICore frame envelopes, and Opus chunked transport; add an ecosystem survey covering Ali, Zhipu, Volcengine, and WeChat desktop voice architectures.
- Optimize clipboard image hashing by computing signatures directly from prefetched PNG bytes to avoid redundant image resizing and re-encoding; add 5-minute in-memory caching for speech model catalogs; add `frozenOffset` speculative partial commitment to live voice delivery to reduce typing latency.
