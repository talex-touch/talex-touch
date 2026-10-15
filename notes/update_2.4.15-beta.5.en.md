# Tuff v2.4.15-beta.5 Release Notes

## Summary Notes

- TuffEx component refactoring and accessibility enhancements: DataTable introduces custom column widths, sticky frozen columns, dedicated column filter components, empty states, and sortable columns; DropdownMenu adds checkable menu items and keyboard accessibility.
- System wallpaper caching and cross-platform optimization: Cache desktop wallpaper paths to eliminate redundant subprocess spawns; migrate cross-platform wallpaper tests and document background timeout contracts.
- OCR queue throttling and image dimension constraints: Add request queue throttling and debouncing to OCR services; constrain maximum image dimensions during preprocessing to protect core process memory.
- Native audio and scenario specifications: Restore global Escape key passthrough to external applications; add voice SDK integration specifications for Android vehicle and KTV environments.

## What's Changed

- TuffEx enhancements: Extract the standalone TxDataTableColumnFilter component, resolve filter width constraints, support measured column widths, flexible layout, sticky columns, empty state slots, and sort status synchronization; add checked state support and keyboard navigation for TxDropdownItem.
- Desktop wallpaper performance: Cache desktop wallpaper paths across system modules to prevent repeated child process execution; migrate platform test suites to new conventions and solidify background timeout contracts.
- OCR robustness improvements: Introduce queue throttling and debounce controls for OCR requests with image resizing unit tests; constrain input image dimensions prior to engine processing to eliminate memory spikes.
- Native audio and voice documentation: Restore global Escape key passthrough across active external application windows; author architectural integration specifications for Android vehicle and KTV voice SDK deployments.
