Changelog
### Unreleased
- Added `--site` tethering mode to preselect and validate a single Discourse site at startup.
  - In this mode, `discourse_select_site` is not exposed and all tools operate against the chosen site.
  - Remote tool discovery (when enabled via `tools_mode` ≠ `discourse_api_only`) now runs immediately at startup for the tethered site.
 - Added `--default-search` to prefix every search query with a configurable string for targeted searches.
### 0.1.1 (2025-08-20)
