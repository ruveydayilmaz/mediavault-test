# MediaVault

An Obsidian plugin for tracking movies and TV shows: reviews and rewatches
(with full rating history — never overwritten), episode-by-episode progress,
TV Time / Trakt import and sync, mood-based "comfort media" recommendations,
and a full analytics dashboard — all stored directly inside your vault.

**Status: v1.0.0 — feature-complete.** All 17 planned milestones are built,
tested, and wired together. See [CHANGELOG.md](./CHANGELOG.md) for the full
list of what's included and known limitations.

## Features at a glance

- **Library**: TMDB-backed search/add, grid/list/table views, filters, sort, pagination
- **Reviews**: unlimited watch sessions per title, rating-evolution chart, full timeline
- **TV tracking**: season/episode hierarchy, batch mark-watched, favorite episodes
- **Import**: TV Time / CSV / JSON, with dry-run preview and safe re-import
- **Trakt sync**: OAuth, bi-directional history/rating sync, generated history note
- **Notes**: auto-generated per-title markdown notes with frontmatter, safely
  regenerated without ever touching what you write in them
- **Analytics**: genre/actor/studio breakdowns, watch trends, calendar heatmap
- **Comfort Finder**: mood-based filtering (energy, attention, heaviness, tags) with presets
- **Recommendations**: TMDB discovery scored against your taste, plus comfort-based picks from your own library

## Development

```bash
npm install
npm run dev     # watch mode, rebuilds on change
npm run build   # type-check + production build
npm test        # run the Vitest suite
```

## Testing

The test suite (`tests/unit/*.test.ts`, run via `npm test`) focuses on the
invariants that matter most for a media-tracking tool:

- **Never overwrite reviews** — rewatches always create a new `WatchSession`
- **Idempotent imports** — re-importing the same TV Time file or re-running
  a Trakt sync never creates duplicates
- **Note regeneration never destroys user content** — content written before,
  inside, or after the plugin-managed section of a note survives regeneration
- Broad coverage of analytics, comfort filtering/ranking, and the
  recommendation engine

A minimal `tests/mocks/obsidian.ts` stands in for the real Obsidian API
(only available inside the app at runtime) so the suite can run in plain
Node via Vitest.

## Installing into a vault

1. Run `npm run build` (produces `main.js` in this folder).
2. Create a folder in your vault: `<Vault>/.obsidian/plugins/mediavault/`
3. Copy `manifest.json`, `main.js`, and `styles.css` into that folder.
4. In Obsidian: Settings → Community plugins → enable "MediaVault".
5. Add your TMDB API key in the plugin's settings tab (required for search/import).
   Trakt sync is optional and configured in the same tab.

Alternatively, symlink this whole repo into
`<Vault>/.obsidian/plugins/mediavault/` and run `npm run dev` for hot
reloading (requires the "Hot Reload" community plugin).

## Project structure

```
src/
  main.ts             Plugin entry point — commands, ribbon, view registration
  constants.ts        Shared constants (view types, ribbon icon, etc.)
  types/              Shared TypeScript types + enums
  models/             Data model interfaces (MediaItem, WatchSession, Episode, ComfortProfile...)
  services/
    storage/            Repositories (indexed CRUD over VaultData), migrations
    analytics/          Pure analytics computation + memoization
    comfort/             Filter/rank/join logic for comfort media
    recommendation/      Affinity scoring + recommendation orchestration
    importer/            TV Time / CSV / JSON import pipeline
    note-generator/       Markdown note generation with safe regeneration
    review-logic.ts       Rewatch numbering, rating evolution
    watch-session-service.ts  Add/edit/delete watch sessions
    episode-import.ts     TMDB episode metadata import
    trakt-sync.ts, trakt-token.ts, trakt-note-generator.ts
    media-import.ts       TMDB → MediaItem conversion
    library-query.ts      Filter/sort/search/paginate
  api/                TMDB and Trakt HTTP clients + normalization
  ui/
    views/              Library dashboard, Analytics dashboard (workspace tabs)
    modals/             Add media, watch session, episode tracker, comfort finder,
                         recommendations, import, Trakt auth, etc.
    components/         Shared rendering: charts, heatmap, virtual list, poster cards
  settings/           Plugin settings + settings tab
tests/
  unit/               Vitest test suite
  mocks/              Minimal "obsidian" module mock for tests
```

## Development philosophy

Built in vertical slices — each milestone (0 through 17) produced a working
plugin, from scaffold → data layer → core library UI → integrations →
advanced analytics/recommendations, in that order. See `CHANGELOG.md` for
what shipped at each stage.
