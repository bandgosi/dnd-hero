# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

"D&D Герой" — a Russian-language D&D 5e character sheet Progressive Web App. The entire application is a single self-contained `index.html` (~4,700 lines: CSS, HTML, and JavaScript) with no framework, no dependencies, no build step, and no tests. All D&D content (spells, items, rules) is embedded as local Russian-language data, so the app works fully offline.

## Development

There is no build/lint/test tooling. To run locally, serve the directory over HTTP (the service worker does not work from `file://`):

```bash
python3 -m http.server 8000
# open http://localhost:8000
```

**When changing `index.html`, bump `CACHE_NAME` in `sw.js`** (e.g. `dnd-hero-v16` → `dnd-hero-v17`) and the "версия N" label on the welcome screen in `index.html` (kept in sync manually). The service worker is cache-first; installed PWA clients will not receive changes until the cache version changes. The app shows an in-app "Доступно обновление" toast when a new service worker installs.

## File Layout

- `index.html` — the whole app: `<style>` block (~line 18), HTML body (two screens: `screen-welcome`, `screen-main`; six tabs: character, spells, dice, inventory, notes, guide; modal overlays), and one `<script>` block.
- `sw.js` — cache-first service worker precaching the app shell (including `fonts/`). It contains a network-only passthrough for `open5e.com`, but the app no longer calls that API — all data is local.
- `manifest.json` — PWA manifest (Russian, portrait, standalone).
- `icons/` — all icon sizes referenced by the manifest and `<head>`; keep `icons/icon-192.png` and `icons/icon-512.png` in sync with `sw.js`'s `ASSETS` list.
- `fonts/` — self-hosted Cinzel (variable, 400–700) and Crimson Text woff2 (latin subset; neither font has Cyrillic — Russian text falls back to Georgia by design). Declared via `@font-face` in `index.html`, precached in `sw.js`.
- `backup/` — snapshot of the pre-v16 version (`index.html`, `sw.js`, `manifest.json`), kept for rollback.

## JavaScript Architecture

The script is organized into `// ============ SECTION ============` blocks (STATE, INIT, TABS, ABILITIES, HP, COMBAT, SPELLS, DICE, INVENTORY, SAVE/LOAD, GUIDE, AI HELPER, local databases). Search these markers to navigate.

### State & Persistence

- A single global mutable `state` object holds the active character (abilities, HP, spells, inventory, conditions, attacks, hit dice, etc.).
- Character-sheet form inputs are NOT in `state`; the ids listed in `FIELD_IDS` are read directly from the DOM when saving.
- Persistence is localStorage under `STORE_KEY = 'dnd_store_v4'` — a multi-character store: `{ active: id, list: [{ id, name, data: { state, fields } }] }`. `saveAll()` snapshots the current character into the active slot; it also runs on a 5-second `setInterval` started in `startApp()`.
- `loadData()` migrates a legacy single-character save (`dnd_hero_save`) on first run, and seeds a default character ("Шептун") if the store is empty.
- **When adding a new persistent value**: add it to `state` with a fallback default in `applyCharacter()` AND to `blankCharacterData()`; or, for a form field, add its element id to `FIELD_IDS`. Missing either breaks loading of existing saves or new characters.

### Rendering

- No framework: `render*()` functions rebuild sections via `innerHTML` template strings. After mutating `state`, call the relevant `render*()` (or `renderAll()`) and `saveAll()`.
- Event handlers are inline `onclick="..."` attributes, so all handler functions must remain in global scope.
- Any user-supplied text interpolated into `innerHTML` must go through `esc()` (HTML-escape helper defined in the STATE section).

### Game Data

All rules content lives in constants inside `index.html`, in Russian:

- `DB_SPELLS`, `DB_WEAPONS`, `DB_ARMOR`, `DB_MAGIC_ITEMS`, `DB_GEAR` (combined in `DB_ALL`) — browsable knowledge base (spells/items overlay).
- `QA_DB` — rules Q&A for the "AI helper" (fully local, keyword search; there is no actual AI/API call).
- `CLASS_GUIDES` — per-class guide tab content.
- Derived-stat logic uses `CLASS_HIT_DIE`, `CASTING_ABILITY`, `SKILLS_DATA`, `XP_TABLE`; class names are Russian strings ('Воин', 'Маг', 'Колдун', …) used as lookup keys — keep spelling consistent across all these tables.
- Spell slot **totals are always computed** from class + level via `syncSpellSlots()` (SRD tables `FULL_CASTER_SLOTS` / `HALF_CASTER_SLOTS` / `PACT_SLOTS` for warlock); only `used` counts are user state. Never hand-edit slot totals in saves.

## Conventions

- All UI text, data, and most code comments are in Russian; keep new UI strings in Russian.
- The app has **zero external network dependencies** (fonts are self-hosted) — keep it that way; everything must work fully offline.
- Ability order is always СИЛ, ЛОВ, ТЕЛ, ИНТ, МУД, ХАР (indexes 0–5) across `state.abilities`, `saveProfs`, and `CASTING_ABILITY`.
- On tablet/desktop widths (≥700px) the app is constrained to a 640px centered column via a media query; test layout changes at both 390px and wide widths.
