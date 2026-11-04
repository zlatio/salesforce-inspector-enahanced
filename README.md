<img src="assets/icon.svg" width="64" height="64" alt="">

# Salesforce Inspector Enhanced

A Chrome extension for Salesforce admins and developers: inspect and edit any record, write and manage SOQL, and keep an eye on org limits. It has a modern UI with light and dark themes.

It uses your existing Salesforce browser session. There's nothing to configure and no connected app.

| Record inspector (light) | SOQL (dark) |
|---|---|
| ![Record inspector](docs/screenshots/record-light.png) | ![SOQL](docs/screenshots/query-dark.png) |
| **Org limits & licenses** | **Toolbar popup** |
| ![Limits](docs/screenshots/limits-light.png) | ![Popup](docs/screenshots/popup-dark.png) |

More screenshots are in [`docs/screenshots`](docs/screenshots). Short walkthroughs: [record inspector](docs/videos/record-inspector.mp4) · [SOQL](docs/videos/soql.mp4) ([dark](docs/videos/soql-dark.mp4)) · [limits](docs/videos/limits.mp4) · [command palette](docs/videos/palette.mp4).

## Features

### Objects & records
- Browse every object in the org. You can filter by standard, custom, custom metadata, settings or platform events, and jump straight to a record by pasting its ID.
- **Record view** lists all fields with their label, API name, type and value:
  - Lookups show the related record's name.
  - Id, Name, Record Type and Owner are pinned to the top.
  - Defaults to fields with a value, and search tells you when a match is hidden by the active filter.
- **Inline editing** with a type-aware editor for each field: picklists, multi-select, dates and times, numbers, lookups and long text.
  - Changes are staged and shown as *old → new*, then confirmed in a review dialog.
  - **Safety:** the review dialog re-reads the record and warns you if someone changed it since you loaded it. Every save shows a toast with **Undo**.
  - **Production orgs:** editing is locked until you turn on "Edit production data". The header gets a red edge and the save buttons say *production*.
- **Field details drawer** shows the full describe: formula, help text, picklist values, capabilities and raw JSON. It also has **Find records with this value**, which writes a correctly typed SOQL query for you.
- **Child relationships** with *Count all*, which batches the COUNT() queries through the Composite Batch API (25 per call). Record types and the raw JSON are on their own tabs.

### SOQL
- CodeMirror editor with SOQL highlighting and context-aware autocomplete:
  - object names after `FROM`
  - fields, matched by API name *or label*
  - relationship traversal (`Owner.Name`)
  - sub-query relationship names
  - picklist values, booleans and date literals after an operator
- Query tabs, history (per org) and saved queries (shared across orgs). Runs with the Tooling API or `queryAll` (include deleted records).
- Errors are underlined at the reported row/column.
- Virtualized results grid:
  - sort, column resize, row filter, keyboard navigation
  - drill into sub-query results
  - Ids link to the record view
- **Copy** puts the visible (filtered and sorted) rows on the clipboard as tab-separated text, ready for Excel (`Ctrl+Shift+C`). Export also offers CSV and JSON.

### Org limits & usage
- KPI tiles for daily API requests, data and file storage, and async Apex.
- One **attention list** covers limits *and* user / permission set licenses at 75% or more, plus licenses that expire within 60 days.
- All `/limits` values grouped by category, with per-app breakdowns. Changes are tracked over time: every API call the extension makes records a usage sample, so the API trend fills in as you work.
- Licenses, and record counts by object (business data only, or everything).

### Everywhere
- **Toolbar popup** (pin the extension, or press `Alt+Shift+K`): this is the main entry point. It detects the record or object on the current Salesforce page and reuses the org's Inspector tab instead of opening new ones.
- **In-page launcher** (opt-in): a small tab on the right edge of Salesforce pages that opens the same popup as a floating panel. Turn it on with "In-page button" in the popup footer.
- **Command palette** (`Ctrl/⌘+K`):
  - objects, recent records, saved queries, Setup pages and theme
  - `Account.Industry` jumps to a field
  - `Ctrl+Enter` queries an object; `Shift+Enter` opens it in Object Manager
- **Keyboard shortcuts:**
  - `g` then `o` / `q` / `l` switches between Objects, Query and Limits
  - `/` focuses search
  - `Alt+E` toggles edit mode (in production it can only lock editing)
  - `Ctrl/⌘+S` reviews and saves
  - `Alt+Shift+K` opens the popup
  - `Alt+Shift+I` inspects the current page
  - The browser-level shortcuts can be changed at `chrome://extensions/shortcuts`.
- Light, dark or system theme. Text meets WCAG AA contrast in both themes, and every control is reachable from the keyboard.

## Install (development)

```bash
npm install
npm run build        # type-checks, then builds into dist/
```

Then open `chrome://extensions`, enable **Developer mode**, click **Load unpacked** and select the `dist/` folder.

`npm run build:fast` skips the type check. After changing `assets/icon.svg`, run `node scripts/icons.mjs` (needs `rsvg-convert`) to regenerate the PNG icons.

## How it works

| Piece | Role |
|---|---|
| `src/background` | Service worker. Reads the `sid` session cookie (content scripts can't), maps Lightning hosts to the My Domain API host, and handles keyboard commands. |
| `src/content` | The in-page launcher, isolated in a shadow root. It opens the popup in an iframe panel. |
| `src/popup` | Toolbar popup and in-page panel. |
| `src/app` | The full-page app (`app.html?host=…#/inspect|query|limits`). |
| `src/lib/sf.ts` | REST client: Bearer session, cached describes, Composite Batch API, and `Sforce-Limit-Info` tracking. |
| `src/styles/tokens.css` | Design tokens. Every color comes from here, and light and dark are defined side by side. |

Built with Preact, Preact Signals, CodeMirror 6 and Vite. There are no runtime network calls other than to your own Salesforce org.

Inspired by [Salesforce Inspector Reloaded](https://github.com/tprouvot/Salesforce-Inspector-reloaded), which was used as a reference for the session/cookie approach. No code was copied.
