# Changelog

All notable changes to MediaVault are documented in this file.

## [4.24.0] — Browse Grid Fix & Safer Delete Actions

- Explore Browse/Search grid: removed the parallel `.mediavault-explore-grid` CSS/class entirely — now renders directly into the literal `.mediavault-grid` container (same class as Library), with cards using `.mediavault-card`/`.mediavault-card-poster` (grid layout mode in the shared `renderDiscoverCard`), so there's truly one grid implementation, not two kept in sync.
- List item removal (list detail's ✕ button, Add-to-List modal's uncheck) now shows a native confirm dialog clarifying only list membership is affected, not the library item itself.
- New reusable `addDestructiveMenuItem` helper (`ui/components/destructive-menu-item.ts`): hamburger-menu Delete actions now require a second click (label/icon flip to a red "Confirm ..." state) instead of a separate `confirm()` dialog. Since Obsidian's Menu closes on any item click, the confirming state is achieved by immediately reopening an identical menu via a `rebuild` callback. Applied to: media detail hero menu Delete, watch-entry menu Delete, list detail hamburger Delete list.



- Favorites arrow now opens the corresponding built-in Favorite Movies/TV Series list detail directly (new `onArrowClick` callback, separate from the desktop View All button), skipping the Favorite Lists picker page entirely.
- Explore Browse/Search grid: root cause was `.mediavault-explore-card`'s hardcoded `width: 140px` fighting the CSS grid's own column-track sizing. Added a `layout: "grid"` mode to the shared `renderDiscoverCard` that reuses the Library's width-less `.mediavault-card`/`.mediavault-card-poster` classes instead, so the grid tracks — not a hardcoded width — control sizing. Rows (Discover/Recommendations) keep the fixed-width row layout unchanged.



- Favorites arrow now opens the "View All" filtered library page (Movies or TV, based on active tab), matching the desktop button instead of the built-in Favorite Lists picker.
- Library tab strip: preserved horizontal scrollLeft across re-renders (was reset to 0 each time the bar was rebuilt).
- Pagination: smooth-scrolls the grid into view after changing pages.
- Genre filter redesigned as a 3-row horizontal-scrolling visual grid (background image + dark overlay + centered name) — reuses the exact same `filterCriteria.genres` array/refresh callback as the old checkboxes. Images resolved once per genre from the first locally-owned title and cached permanently in a new `genreImageCache` setting; never re-resolved once cached.
- Added a global delegated "Done" keyboard handler (`enterkeyhint="done"` + Enter-blurs) for single-line `<input>` elements across the plugin.
- Added a base input-visibility rule (background/border via Obsidian's own `--background-modifier-form-field`) scoped to `[class*="mediavault-"]`, placed early in the cascade so any more specific existing input styling still wins.



- Root cause: `SettingsRepository.get()` only ever returned settings.json as-stored; new optional fields (`favoriteListSortModes`/`favoriteListManualOrder`) are only backfilled during a schema-version-bump migration, which doesn't run for vaults already on the current version. `getSystemFavoriteLists()` read `settings.favoriteListSortModes.movies` on an object missing that key entirely, throwing and silently killing the whole Favorites section render. `get()`/`update()` now always merge against `DEFAULT_SETTINGS` first, fixing this for every settings field added this way (not just the new ones).



- Added `runtime` as a new shared `ListSortMode` (available to all lists, not just the built-in ones).
- Favorite Movies/TV Series now support every sort mode via new settings fields (`favoriteListSortModes`, `favoriteListManualOrder`) since they have no repository record to hold this — `ListDetailModal`'s sort-mode change and manual drag-reorder branch to settings persistence for system lists, CustomListRepository for regular ones, reusing the same `sortListMedia`/`ListSortMode` machinery throughout.
- Favorites carousel now orders movies/shows via `sortListMedia(systemList, allMedia)` instead of raw filter order, so it always reflects the saved sort/manual order.



- Moved the mobile nav arrow to the right side of the Favorites/Lists headers.
- Added built-in "Favorite Movies"/"Favorite TV Series" smart lists (`CustomList.isSystem`, `getSystemFavoriteLists()`) — computed live from favorite status, never persisted, never in the Lists carousel. New `FavoriteListsModal` opens from the Favorites arrow. `ListDetailModal` special-cases system lists: no menu, no sort picker, no manual reorder, no remove-from-list.
- Filmography grid now uses the exact Library grid sizing/breakpoints; poster rendering reuses `.mediavault-card-poster` (wrapper + img) instead of a bespoke img-only class.
- New shared `renderDiscoverCard` component (`ui/components/discover-card.ts`) — Explore (Discover/Browse/Search) and the Recommended For You modal both render cards through it now, eliminating the separate `.mediavault-rec-*` implementation. Recommendations modal's own vertical scroll container was removed (per the prior roadmap's modal-root max-height fix); it's now the sole vertical scroller with horizontal-only rec rows.



- Removed arbitrary vh-based max-height caps (Image Picker, Recommendations, Episode Tracker, Import, Analytics, Comfort Profile, Comfort Finder modals) — these conflicted with the mobile fullscreen modal-content sizing, capping well short of available height and compressing grid rows. Lists now grow naturally; the modal's own scroll container handles overflow.
- Detail modal tabs disappearing: root cause was flex items (tab bar, hero, body) lacking `flex-shrink: 0` inside the mobile fullscreen flex-column contentEl — when tab content overflowed, the flex algorithm could squeeze the tab bar toward zero height. Added `flex-shrink: 0` to hero/body/tabs; no sticky positioning involved.
- Log Watch modal footer gap: contentEl's own bottom safe-area padding sat below the sticky footer (sticky respects the scrollport's padding edge), leaving a gap. Zeroed contentEl's padding-bottom when a sticky `.mediavault-modal-buttons`/`.mediavault-detail-actions` footer is present; the footer's own padding now reaches the true bottom edge.



- **Banner/Poster picker grid**: audited the existing aspect-ratio-based sizing (already structurally correct) and hardened `.mediavault-image-picker-grid` with an explicit `width: 100%; min-width: 0;` against CSS Grid's documented "`auto-fill` collapses to one column when the container's own width is indefinite" failure mode, regardless of which ancestor context renders it.
- **Discover Recommendations grid**: found `.mediavault-explore-poster`/`.mediavault-rec-poster` were near-duplicates of the Library grid's `.mediavault-card-poster` (only a mismatched border-radius differed). Consolidated `.mediavault-card-poster`/`.mediavault-rec-poster` into one shared rule and aligned `.mediavault-explore-poster` to match, per the requirement that recommendation cards use the exact same sizing system as every other poster grid. Also added `align-items: flex-start` to the row containers to remove any implicit flex-stretch sizing ambiguity.
- **Sticky menu button — real root cause found**: the three-dot menu button was a *child* of `.mediavault-detail-hero`, which has `transform: translateY(-50px)` on mobile. A transform on an ancestor creates a new containing block for `position: fixed` descendants, so the button's "fixed" positioning was actually scoped to the hero's own moving box, not the viewport — it only looked fixed until the first scroll. Moved the button to be a sibling of the hero (same DOM level as the Back button) and made it unconditionally `position: fixed` on all platforms, exactly mirroring the Back button's strategy, removing the old split desktop-absolute/mobile-fixed rules.
- **Non-sticky tabs**: removed the sticky positioning added to Details-modal tabs in the previous roadmap — it anchored to a JS-measured `--mediavault-detail-hero-height` custom property that could be stale, causing the tab bar to lock in underneath the still-visible hero banner while its `border-bottom` peeked out below, looking like a fixed element even though the tabs themselves were hidden. Tabs (and their border) now scroll away naturally in normal document flow, matching every other use of `.mediavault-detail-tabs`; horizontal scroll is unaffected. Removed the now-dead `--mediavault-detail-hero-height` JS measurement, since nothing else consumed it.
- **Universal modal header positioning — real root cause found**: only the Details modal was hiding Obsidian's native `.modal-header`/`.modal-close-button`. Every *other* modal using the universal `renderModalHeader` (Actor Details, Image Picker, Lists, Comfort Finder, Recommendations, Analytics, Import, Trakt Auth, and more) still showed Obsidian's own empty native title bar sitting above our custom header row — that's the entire "large empty space above the header" bug, on both desktop and mobile. Extended the hide-native-header treatment to every MediaVault modal via the same `.modal:has(> .modal-content[class*="mediavault-"])` pattern used elsewhere; our custom header row's Back button is a full functional replacement for the native close button. Removed the two now-redundant partial rules this replaced (the Details-only header hide, and a mobile-only close-button hide).



- **Adult Content Filter**: new "Show Adult (+18) Content" setting (off by default). Threaded through `TMDBService` as `include_adult` on every search/discover/trending/popular call; `getRecommendations`/`getSimilar` don't accept `include_adult` server-side, so those are filtered client-side using TMDB's own `adult` flag instead. That flag didn't exist anywhere in the codebase's TMDB types before this — added to `TMDBRawSearchResultItem`/`TMDBSearchResult` and threaded through `normalizeSearchResult`, per the spec's explicit instruction to use TMDB's flag rather than a local heuristic (there was no heuristic to replace — audited, none existed). Cache keys for every affected endpoint now include the setting so toggling it doesn't serve stale cached results.
- **Bottom Safe Area audit**: root-caused why Library pagination (and Watch Next/Lists/Explore/Analytics) still hid beneath Obsidian's floating mobile toolbar despite existing safe-area padding — `env(safe-area-inset-bottom)` only reflects the OS-level home-indicator area, not Obsidian's own floating toolbar height, which is a separate, stacked obstruction (and is 0 on many devices that still have the toolbar). Changed those five views' bottom padding from `max(24px, safe-area-inset-bottom)` to `calc(var(--mobile-toolbar-height, 48px) + safe-area-inset-bottom)`, additive rather than maxed. Left mobile modal action bars alone — they render fullscreen above the toolbar already (per 4.12.0's fullscreen-modal work), so only the safe-area inset applies there.

## [4.16.0] — Mobile Input & Accessibility (Mobile roadmap, Milestone 3)

- **Comment Composer root cause found**: the movie/show Comments tab's "Add Comment" button had no click handler wired up at all — a sibling code path for per-episode comments already had one. That's the entire "tapping does nothing" bug. Fixed both paths, and added auto-focus on the textarea when the composer opens (wasn't there before either).
- **Long usernames**: added a `title` attribute for the full name plus CSS ellipsis truncation (`max-width: 55%`) on `.mediavault-comment-author`, replacing the previous flex-wrap behavior that let a long name push the rating/date onto their own line unpredictably.
- **Keyboard dismissal**: Obsidian's mobile webview has no way to attach a native "Done" accessory above the system keyboard, so added the documented fallback — a small chevron "Done" button (mobile-only) inside the composer that blurs the textarea without cancelling or posting, plus `enterkeyhint="done"` and blur-on-cancel.

## [4.15.0] — Mobile UI & Navigation Improvements (Mobile roadmap, Milestone 2)

- **Show All Navigation**: Favorites and Lists section headers now get a mobile-only arrow-style nav icon (left-aligned via CSS `order`) that opens the corresponding full page; desktop keeps the existing "View All" text button. Lists had no "view all" affordance at all before this — added one, wired to the existing `plugin.activateListsView()`.
- **Carousel spacing**: root-caused the oversized gap between the Favorites/Lists carousels on mobile to `margin-bottom: 12px` stacking on top of the parent grid's own `gap` once the two sections switch from side-by-side columns to stacked rows at narrow widths — removed the redundant margin; also dropped the shared `min-height: 200px` on mobile since stacked sections no longer need to match height for visual alignment.
- **Sticky banner menu**: already implemented as `position: fixed`, but had a copy-paste bug — `right: max(8px, env(safe-area-inset-left))` used the *left* safe-area inset for a *right*-aligned button. Fixed to `safe-area-inset-right`.
- **Filmography tabs**: found the shared `.mediavault-detail-tabs` mobile scroll/sticky CSS rule entirely commented out, breaking horizontal scroll for both Media Details tabs and Filmography tabs (they share the class). Restored horizontal scrolling universally; re-scoped the *sticky positioning* half specifically to the real Details modal (`:not(.mediavault-actor-modal)`), since Filmography/Actor Details has no hero banner to measure `--mediavault-detail-hero-height` against and would've been mispositioned by the original unscoped rule.

## [4.14.0] — Mobile Layout & Spacing Polish (Mobile roadmap, Milestone 1)

- **Discover grid bug found and fixed**: `.is-phone .mediavault-explore-card { width: 100% }` was unscoped, so it also applied to the horizontally-scrolling Trending/Popular/Recommended rows (not just the Browse/Search grid), collapsing every row to a single full-width card — the reported "one oversized item per row." Scoped the override to `.mediavault-explore-grid` only; rows now keep their fixed card width and multi-item horizontal scroll, matching the Favorites carousel.
- **Consistent grid sizing**: unified `.mediavault-explore-grid` (was 150px) and `.mediavault-list-detail-grid` (was 120/100/85px across its own bespoke breakpoints) to the exact sizing and breakpoints already used by the Library grid (140px desktop, 4-col/3-col mobile breakpoints). Favorites carousel and Comfort results were already consistent — audited, left untouched. Cast grid intentionally excluded per spec.
- **Media Detail Modal hero-to-description gap**: root-caused to `transform: translateY(-50px)` on the mobile hero banner — a transform that doesn't affect layout flow, so the 50px it visually moved through was left behind as dead space before the next section. Fixed with a compensating `margin-bottom: -50px`.
- **Library toolbar-to-grid gap**: root-caused to the library root's flex `gap: 12px` applying on both sides of the empty filter-panel spacer even when no filter panel was open, effectively doubling the gap. Changed its `:empty` rule from zeroing margin (had no effect on flex `gap`) to `display: none`.



- **Filters**: sort (field + direction) and page-size controls now render inside the expandable Filter panel on mobile instead of the toolbar — extracted into shared `renderSortControls()`/`renderPageSizeControl()` methods so the exact same controls, wiring, and settings-persistence are reused rather than duplicated, just mounted in a different container depending on screen tier. Desktop/tablet keep them in the toolbar, unchanged. The page-navigation Prev/Next buttons at the bottom of the results themselves are unchanged — those are page navigation, not toolbar clutter, and weren't the "pagination controls" the spec meant to relocate (matched to the page-size selector as the actual toolbar control).
- **Narrow screen layout (≤380px)**: the search input now spans the full width on its own row, with the Filter button and Media Type selector on the row below via `order` (no DOM changes needed — same elements, just reflowed at that breakpoint).
- **Grid toggle removed on mobile**: previously mobile rendered a single-option Grid-only toggle button (dead clutter, since there was nothing to toggle to); `renderViewToggle()` now returns immediately on mobile and renders nothing. Desktop/tablet keep the full Grid/List/Table toggle.

## [4.12.0] — Mobile Modal Layout Fixes (New roadmap, Milestone 3)

- **Sticky Tabs**: the Media Detail tab bar (Episodes/Cast/Comments/etc.) now stays pinned directly below the sticky hero banner instead of scrolling out of view. The hero's rendered height is measured once per render (`requestAnimationFrame` after layout) and exposed as a `--mediavault-detail-hero-height` CSS custom property, which the tab bar's `top` reads — so it sticks at exactly the right offset regardless of title wrapping or safe-area insets, rather than a guessed fixed value. Desktop is untouched (tabs aren't sticky there).
- **Hero Banner edge-to-edge fix**: root-caused the left/right padding on the banner to the hero inheriting the modal-content's own horizontal padding, same as every other child. Fixed by giving the hero container itself negative margins (offsetting exactly the modal's `max(16px, safe-area-inset)` padding) so only the hero — image and overlay together, since both are absolutely `inset: 0` within it — extends edge-to-edge, while the rest of the modal (and the hero's own inner title/meta content) keeps its normal padding.
- Removed an old `top: -30%` hack on the mobile banner image/overlay that was misaligning the overlay from the image (overlay no longer "exactly matches banner height" once shifted). It's no longer needed now that the hero itself is edge-to-edge — the absolutely-positioned image and overlay are naturally aligned and full-bleed.
- Added a phone-only offset for the hero's three-dot menu button so it clears the safe-area/notch now that the hero extends under it.

## [4.11.0] — Responsive Favorites & Lists Carousels (New roadmap, Milestone 2)

- **Mobile**: the Favorites carousel now always mirrors the Library grid's column count exactly — `mobileGridColumns()` reads the same 380px breakpoint the grid's own CSS uses (3 columns at ≤380px, 4 above it), and the carousel's card width is computed as `calc((100% - (N-1)*gap) / N)` so it's always in lockstep, never a separately-tuned approximation. When there are fewer favorites than slots, placeholder cards fill the remainder so the row's width stays stable instead of collapsing or stretching.
- **Desktop/web**: `desktopFavoritesCount()` is a continuous function of the carousel's own available width (not the device) — `round(width / 150px)` clamped to the spec's 3–6 range — so the poster count grows and shrinks smoothly as the pane is resized instead of jumping at fixed breakpoints. Recomputed on every resize via the view's existing `ResizeObserver`, not just on tier changes, and only triggers a (cheap) Favorites-only re-render when the count actually changes.
- Removed the old `max-width: 1100px` cap on the Favorites/Lists row so it genuinely shares the full available pane width ~50/50, per spec — previously this silently capped how wide the row (and therefore how many desktop posters) could ever grow.
- Lists carousel needed no changes — its tiles were already percentage-width (`flex: 0 0 100%`) from earlier work, so they already adapt to whatever width the 50/50 split gives them.
- Incidentally removed an unused `Platform` import from `favorites-carousel.ts` that was flagged by lint before this milestone (not a new issue introduced here, but no longer present either).

## [4.10.0] — Comment Composer & Universal Modal Navigation (New roadmap, Milestone 1)

- **Public Comment Composer**: audited against the spec and found it was already fully built from earlier work — it renders directly below the Comments header (not at the bottom of the list), pushes existing comments down, collapses on submit/cancel, and refreshes the list immediately after a successful post. No changes needed here.
- **Universal Back Button**: this was the real gap. It previously existed only as a `position: fixed`, mobile-only overlay circle, with each modal separately rendering its own title elsewhere — despite a stale code comment claiming it was already hidden on desktop (it wasn't; it just had no accompanying title anywhere).
  - New `renderModalHeader()` (`modal-chrome.ts`): a shared Back button + title row rendered identically on desktop and mobile, used by every MediaVault modal except Movie/Series/Episode Details.
  - New `renderInlineBackButton()`: for List Details, which already builds its own rich title row (editable title, imported badge, hamburger menu) — the Back button is prepended to that row instead of duplicating a new one.
  - Updated all 14 non-Details modals (Actor Details, Comfort Finder/Profile, Create/Add-to List, Drop Series, Image Picker, Import, Movie Progress, Notification History, Recommendations, Trakt Auth, Watch Session, List Detail) to use the shared header.
  - `MediaDetailModal` (Movie/Series/Episode Details) is unchanged per spec — it keeps its existing hero-banner header and fixed-overlay back button, since it already has its own back affordance and layout.
  - "Back" always just closes the current modal — every MediaVault modal that stacks on top of another already leaves its parent open underneath rather than closing it, so this is already exactly "return to the previous screen" with no separate navigation-stack bookkeeping needed; closing the last modal is indistinguishable from the spec's "simply close" fallback.
- **Known gap**: the uploaded canonical source jumped from v4.7.0 (last documented milestone) to v4.9.0 with no changelog entries for 4.8.0/4.9.0 — flagging rather than inventing history for work this session didn't do.
- **Also flagging**: the uploaded ZIP contains no `tests/` directory at all, despite `vitest.config.ts` expecting one. `tsc -noEmit` and `eslint src` are clean; `vitest run` currently has nothing to run. Nothing was written to fill this gap, per standing instruction never to add new tests — but it's worth restoring the test directory from wherever it was dropped, since "patch pre-existing tests broken by interface changes" isn't possible without it.

## [4.7.0] — GDPR Import Matching Accuracy & Diagnostics

### Milestone 1 — Improve GDPR Import Matching Accuracy
- New `extractTitleMetadata()` (`services/importer/normalize.ts`): every imported title is now run through a full parenthetical-metadata extractor before TMDB search, not just a year-only regex. Classifies trailing `(...)` groups as a release year, an ISO country code (`(KR)`, `(US)`, ...), a spelled-out language name (`(Korean)`), or — when none of those apply — a probable alternate/original title (`(First Sequence)`, `(Nanatsu no Taizai)`), and strips them from the search title.
- `tmdb-match.ts` scoring now takes country/language hints into account as a tiebreaker between otherwise-similar candidates (weighted ~10-15%, neutral when no hint was extracted, so titles without any parenthetical are scored exactly as before).
- `TMDBSearchResult` now carries `country`/`language` (TMDB's TV search results already return `origin_country`/`original_language` — previously discarded during normalization).
- Every GDPR construction site in `gdpr.ts` (watches, reviews, ratings, favorites, list items) now attaches these hints via a shared `titleMatchHints()` helper.

### Milestone 2 — Investigate Missing Watch Time & Import Completeness
- Audited the full GDPR pipeline against a real TV Time export and found two real bugs:
  - `tracking-prod-records.csv` rows with `type: "rewatch"` (real movie rewatch events, own runtime/release date) were silently dropped by a filter that only accepted `type: "watch"`. Now imported identically to a `"watch"` row.
  - Rows where TV Time puts a year in the `season_number` column (anthology/podcast-style entries like "Rotten Mango," "Formula 1," "Studio Ghibli" collections) were silently turned into bogus episode watches that could never match a real TMDB episode. These are now diverted to a diagnosed warning (`looksLikeYearNotSeason()`) instead of failing invisibly downstream.
- `ImportReport` gained a full diagnostics block: `totalRecordsParsed`, `matchedMediaCount`/`unmatchedMediaCount`, `matchedEpisodes`/`unmatchedEpisodes`, `totalImportedRuntimeSeconds`, and `skippedByReason` (a tally of every skip site in the pipeline, grouped by human-readable reason).
- The import report modal now shows a "Diagnostics" section with these totals plus a "Why records were skipped" breakdown, so a gap against TV Time's own reported watch time is explainable rather than a black box.

## [2.7.0] — TV Time Style Lists (New roadmap, Milestone 7)

- Redesigned the Lists grid cards: the four-poster banner now fills the whole card as a wide strip with title/description/meta (item count · last updated · owner) overlaid at the bottom behind a gradient scrim, instead of sitting in a separate info block underneath — matches the visual direction of the provided TV Time reference image (markup/CSS built from scratch, not copied)
- The already-existing home carousel (`custom-lists-carousel.ts`) turned out to already use this same banner+overlay+pagination-dots treatment from earlier work — left as-is since it already matched the reference
- `ListDetailModal` gains a matching banner strip at the top of its header, plus a meta row (item count · last updated · owner) above the editable title/description fields
- New `CustomList.owner` field (`string | null`, always `null` today — MediaVault has no multi-user concept yet) — future-proofs the "Owner" slot in both the card and detail header, per spec; renders as "You" until it means something
- New `formatRelativeDate()` (`list-service.ts`) — "3d ago" style formatting for "Last updated", shared by both the grid card and the detail header
- Drag-and-drop reordering, remove/add item, search-while-adding (via Obsidian's native fuzzy picker), and sort mode were all already fully implemented from earlier work — audited and left alone, no duplicate logic added

## [2.6.0] — Watch Next Animations (New roadmap, Milestone 6)

- Marking an episode watched from the Watch Next sidebar no longer instantly wipes/rebuilds the card: the current card now slides right and fades out (~300ms), and — if the same show has another unwatched episode — the same DOM node is repopulated with it and slides/fades in from the left, so nothing in the queue jumps position
- If the show has nothing left queued, the card collapses (height/margin/padding to 0) and is removed instead of being swapped; if that empties the whole queue, the empty state fades in in its place
- The mutation (`markEpisodeWatched`) and the exit animation now run in parallel via `Promise.all`, so the button press feels immediate rather than blocking on the write; the button itself is disabled for the duration to prevent a double-fire mid-animation
- `refreshLibraryViews()` gains an optional `{ skipWatchNext: true }` — Watch Next now drives its own DOM update after a mark-watched action instead of being caught by the normal full-rebuild refresh that every other mutation still triggers there
- New `.mediavault-watch-next-card` transition CSS (`is-leaving` / `is-entering` / `is-collapsing`), scoped to Watch Next cards specifically so it doesn't affect the visually-similar cards used in Upcoming/Favorites

## [2.5.0] — Default "Recent" Sorting (New roadmap, Milestone 5)

- New `MediaItem.lastWatchedDate` aggregate, kept in sync by `watch-session-service`'s existing `syncMediaAggregates` alongside `averageRating`/`watchCount` — the most recent `watchDate` across a title's sessions, or `null` if it has none yet
- New shared `recentSortKey()` (`library-query.ts`): latest watch date if present, else `createdAt`, newest first — reused by both the library sort and the new `CustomList` "Recent" sort mode rather than re-derived
- `LibrarySortField`/`ListSortMode` both gain a `"recent"` option, now the default for the library (Home/Movies/TV/Favorites/Search all share one `LibraryQuery` pipeline, so one default change covers all of them) and for newly-created custom lists (manual drag-and-drop reordering remains fully available, just no longer the default)
- **Real gap found and fixed**: `MediaVaultSettings.defaultSort` already existed but was completely dead — defined, defaulted, never read anywhere. It's now wired to `LibraryView`'s sort dropdown (plus a new `defaultSortDirection` alongside it) so the user's last choice persists across sessions instead of resetting every time the view reopens
- Patched one pre-existing `library-query` test whose title-sort assertion relied on the old default; split it into an explicit-sort-field test rather than depending on `DEFAULT_LIBRARY_QUERY`'s field

## [2.4.0] — Media Detail Tabs (New roadmap, Milestone 4)

- `MediaDetailModal` gains a "Watch History | Episodes" tab bar (TV shows only — movies have no Episodes tab and just show Watch History directly). Switching tabs re-renders from scratch, so the inactive tab's content is never left mounted off-screen
- The standalone `EpisodeTrackerModal` is retired: its season accordion, per-episode checkboxes (with Smart Episode Completion), favorite toggles, and TMDB episode import all now live in the Episodes tab. The "Track episodes" command and any other entry point now open the Media Detail modal directly on that tab instead of a separate popup
- New `.mediavault-detail-tabs` / `.mediavault-detail-tab` styles, matching the existing Progress Tabs treatment; all the season/episode CSS classes carried over unchanged since the markup itself was ported as-is

## [2.3.0] — Smart Episode Completion (New roadmap, Milestone 3)

- New `findUnwatchedPrecedingEpisodes()` (`episode-status-sync.ts`) — pure function returning a show's unwatched episodes strictly before a given target, ordered by season/episode number, ready to hand straight to `markSeasonWatched`
- The Episode Tracker's per-episode checkbox now runs this check before marking watched: if earlier episodes/seasons are still unwatched, it prompts once ("You haven't marked previous episodes as watched...") and, on confirmation, backfills them all in a single batch (one status recalculation, one auto-generated watch log per newly-watched episode via Milestone 2's hook) — declining marks only the checked episode
- Never prompts when everything before the target is already watched, per spec — the check is a plain existence test on the unwatched-preceding list, no separate "already asked" flag needed
- Only wired into the individual episode checkbox — "Mark season watched" already covers its own episodes in one batch and needs no backfill prompt

## [2.2.0] — Automatic Watch Logs (New roadmap, Milestone 2)

- `markEpisodeWatched`/`markSeasonWatched` (`episode-status-sync.ts`) — the single funnel already shared by the UI checkbox, TV Time import, and Trakt sync — now append a `WatchSession` whenever an episode transitions from unwatched to watched, so episode progress and watch history can never drift apart again
- New optional `WatchSession.episodeId` links an auto-created session back to the episode that generated it; movie sessions and manually-logged show-level watches leave it `null`
- Dedup is state-based, not existence-based: re-marking an already-watched episode (redundant UI event, re-running an import, re-syncing Trakt) is a no-op for logging — only a genuine unwatched→watched transition creates a session. Unmarking never deletes a session, consistent with the never-overwrite/never-delete-reviews invariant everywhere else
- **Real gap found and fixed**: TV Time's TV-episode watch import and Trakt's episode-history pull were both already calling `markEpisodeWatched`, but neither path ever created a matching `WatchSession` — only movie imports did. Both now get correct watch logs for free from the shared funnel, no importer/sync-specific changes needed
- Patched two pre-existing Trakt-sync tests whose session-count assertions predated this behavior change

## [2.1.0] — Universal Delete System (New roadmap, Milestone 1)

- New `deleteMedia()` (`media-delete-service.ts`) permanently removes a movie or TV series and everything that references it: watch sessions (reviews/ratings live there), episodes + episode progress (TV only), comfort profile, notifications, the generated note file, and its id from every custom list's `mediaIds` — the list itself is preserved, only the reference is dropped. Favorites need no separate cleanup since `isFavorite` lives on the `MediaItem` record itself
- New `deleteByMediaId` helpers on `EpisodeRepository`, `EpisodeProgressRepository`, `ComfortRepository`, `NotificationRepository`, mirroring the existing `WatchSessionRepository.deleteByMediaId` pattern, plus `CustomListRepository.removeMediaEverywhere`
- `MediaDetailModal` gets a "Delete" action with the spec's itemized confirmation dialog; wired everywhere the modal is opened with plugin access so it triggers a full cross-view refresh (statistics, Watch Next, favorites, filters, dashboard, lists) — all of which were already computed live from storage, so refresh is just re-render, nothing to invalidate
- List deletion (already correctly scoped to the list itself, preserving media/history/favorites) now also gets a confirmation dialog, matching the same UX pattern

## [1.4.0] — Dashboard statistics (Post-MVP roadmap, Milestone 1)

First milestone of the new post-MVP feature roadmap: a stats section at the top of the library view.

- New `StatisticsService` with the four spec'd methods (`getMovieCount`, `getMovieRuntime`, `getEpisodeCount`, `getEpisodeRuntime`), computed fresh from watch sessions and episode progress on every call — never a cached counter that can drift
- Four responsive stat cards at the top of the library dashboard: Movies Watched, Movie Watch Time, Episodes Watched, TV Watch Time — using a CSS grid that naturally reflows from 4 columns to 2×2 (or a single column) as the pane narrows, matching the desktop/mobile layouts in the spec, with no JS breakpoint logic needed
- `formatWatchTime()` matches the spec's exact display convention (`"31d 4h"` for long durations, `"Xh Ym"`, or `"Ym"` for anything under an hour)
- Movie watch time counts runtime per watch *event* (a rewatched movie counts again — consistent with the existing analytics dashboard's convention), while the "Movies Watched" count is distinct titles, matching the spec's "418 movies / 31d 4h" pairing
- Auto-refreshes via the same `refreshLibraryViews()` path already triggered after adding media, logging a watch, marking an episode, deleting a watch log, and Trakt sync — plus a gap I found and fixed: **imports never triggered a refresh at all**, so the stats (and the rest of the library view) would show stale data until the view was manually reopened. `ImportModal` now takes an `onImported` callback, wired to refresh both the library and analytics views after a successful commit.
- 10 new tests covering movie/episode counting and runtime summation (including the rewatch-double-counts-runtime behavior and the spec's exact "31d 4h" example), empty-library zero-output, and the async service wrapper

## [1.3.0] — Import progress indicator (roadmap Milestone 6: polish)

- `commitBundle()` now accepts an optional progress callback, called after every item across all five stages (watch history, comments, likes, ratings, favorites) with a running done/total count and a stage label
- `ImportModal` shows a live progress bar and "Stage: done / total" text while importing, instead of a static "Importing..." notice — updated in place via direct DOM references rather than a full re-render per item, so it stays responsive even on imports with hundreds of entries
- New test verifying progress is reported once per item across stages and reaches the total by the end

Row-level error logging, skip-malformed-rows-and-continue, and the full import report were already in place from the 1.2.0 modular rewrite. The roadmap's suggested `canHandle(file)/preview(file)/import(file)` importer interface wasn't adopted as-is — the existing `TVTimeImporter.detect(parsed, format)/parse(parsed)` interface already satisfies the "new export = new class + one registration line" extensibility goal, and operating on already-parsed content (rather than each importer re-reading/re-parsing the raw file) keeps file I/O centralized in one place.

## [1.2.0] — Modular TV Time importer

Replaced the single-strategy TV Time importer with a fully modular, extensible system supporting every TV Time export format and category, not just one JSON/CSV shape.

- **New `ImportManager`** (`services/importer/tvtime/manager.ts`) — auto-detects format (JSON/CSV) and export category, then dispatches to the matching importer. Adding support for a new TV Time export is one new module implementing `TVTimeImporter` plus one line registering it — nothing else changes.
- **Ten importer strategies**, each independently testable: `JsonMovieImporter`, `JsonSeriesImporter` (nested seasons/episodes), `JsonListImporter` (detects custom lists like "Costume C-Drama" and clearly labels them "not yet supported" rather than mis-importing them — list support is a planned follow-up), `CsvFollowedShowsImporter` (the `nb_episodes_seen`/`tv_show_name`/`is_favorited` shape), plus CSV importers for comments, likes, ratings, favorites, watched episodes, and watched movies
- **Common internal models** (`WatchImport`, `ReviewImport`, `LikeImport`, `RatingImport`, `FavoriteImport`) — the rest of the plugin never knows or cares whether data came from JSON or CSV
- **Comments** become watch-session or episode reviews, attached to an existing watch or creating one if needed — never overwriting a review that's already there
- **Likes** and **favorites** import as preserved metadata (`liked`/`likedAt` on episodes, `isFavorite` on media)
- **Ratings** fill in only if no rating exists yet — never silently overwritten
- **Duplicate detection** now matches in priority order: TVDB id → IMDb id → TV Time's own UUID → title+year → TMDB lookup (only for genuinely new titles, to avoid doubling API calls on a cancelled import)
- Import preview now shows the detected format/category up front (e.g. "CSV → Episode Comments") plus counts before anything is written; the post-import report breaks down movies/shows imported, episodes updated, comments/likes/ratings/favorites imported, duplicates merged, skipped, and errors

**Bug fixes found and fixed while wiring this up:**
- The importer redesign had been left mid-migration: `import-modal.ts` still referenced now-deleted files, and several modules in `services/importer/tvtime/` had relative import paths off by one directory level — the project didn't actually compile. Rewrote `ImportModal` to use the new `ImportManager`/`previewBundle`/`commitBundle` pipeline end-to-end, and fixed the path bugs.
- `parseJSON` rejected a single bare JSON object (exactly TV Time's real per-file movie/series export shape — not wrapped in an array or a `{movies, episodes, ...}` object), throwing "Unrecognized JSON structure" on genuine sample exports. Fixed to accept a bare object as one record.
- The "Favorites" filter in the library dashboard checked a status enum value that nothing sets anymore, rather than the `isFavorite` boolean the new importer (and everything else) actually uses — imported favorites were invisible to the filter. Fixed the filter and added a manual ★ favorite toggle to the media detail view (there was previously no way to set it by hand at all).
- 14 new/rewritten tests using the exact real-world sample JSON/CSV shapes provided, covering detection, parsing, full commit (including TVDB-id dedup on re-import and never-overwriting an existing rating)

## [1.1.0] — Automatic status system

Fixed a bug where every item stayed stuck on "Plan to Watch" regardless of actual watch progress. Status is now automatically derived and kept in sync everywhere.

- New centralized `StatusService.calculateMediaStatus()` — the single source of truth for status logic, replacing what would otherwise be scattered conditionals
- **Movies**: Plan to Watch (no sessions) → Finished (1+ sessions); stays Finished across rewatches
- **TV shows**: Plan to Watch (no watched episodes) → Currently Watching (some but not all released episodes watched) → Finished (all released episodes watched AND TMDB says Ended/Canceled) or **Waiting for New Season** (all released episodes watched but TMDB says Returning Series/In Production/Planned/Pilot)
- New `MediaItem.tvStatus` field capturing TMDB's raw show status, normalized from the TV details endpoint, to distinguish "done" from "more episodes coming"
- Manual overrides (Dropped, On Hold) are never overwritten by automatic recalculation
- Centralized through every mutation path: logging/deleting a watch (`watch-session-service.ts`), marking an episode or season watched (`episode-status-sync.ts`, replacing direct repository calls in the episode tracker UI), TV Time/CSV/JSON import, and Trakt sync — all now funnel through the same service, so there's exactly one place status logic can go wrong
- All views re-derive status from storage on their next read, so the library dashboard, media detail modal, and analytics reflect status changes immediately with no reload required
- 16 new tests covering every scenario from the spec: movie add/first-watch/rewatch/delete-all-sessions, TV plan-to-watch/currently-watching/waiting-for-new-season/finished (both by TMDB status and by "no remaining episodes"), unreleased-episode exclusion, and both manual overrides — plus fixes to 3 pre-existing test mocks that hadn't been updated for the new status-recalculation call inside `addWatchSession`/`deleteWatchSession`/`markEpisodeWatched`

## [1.0.0] — Initial release

The full build, delivered as 17 incremental milestones per the original development plan. Every milestone shipped a working plugin.

### Core library
- Add movies/TV shows via a debounced TMDB search modal (poster, year, overview preview)
- Library dashboard with grid/list/table views, search, filtering (all/movies/shows/favorites/comfort/watching), sorting (title/rating/watch count/year/runtime), and pagination
- Full typed data model: `MediaItem`, `WatchSession`, `Episode`/`EpisodeProgress`, `ComfortProfile` — stored as independent, linked collections rather than nested objects, so metadata refreshes never disturb watch history

### Reviews & rewatches
- Unlimited watch sessions per title — rewatches always create a new session and **never overwrite** a prior review
- Rating-evolution SVG chart and full chronological timeline per title, with edit/delete for individual sessions

### TV tracking
- Season/episode hierarchy imported from TMDB, watched-state tracking, batch "mark season watched," per-episode favorites

### Imports & sync
- TV Time / generic CSV / JSON importer: format sniffing, header aliasing, TMDB matching with ambiguity resolution, dry-run preview before anything is written, and idempotent re-imports (safe to run the same file twice)
- Trakt integration: device-code OAuth, bi-directional sync (pull history + ratings, push local-only watches), automatic token refresh, and a generated `Trakt Rating History.md` note with wikilinks

### Vault integration
- Auto-generated markdown notes per title (frontmatter + cast wikilinks + genre tags + watch history), safely regenerated without touching anything the user writes in the note — verified to survive edits before, inside, and after the managed section

### Analytics & discovery
- Full analytics dashboard (Chart.js): genre breakdown, monthly/yearly trends, top actors, calendar heatmap of daily activity
- Comfort Media Engine: mood metadata (comfort/energy/attention/heaviness/complexity/rewatchability, boolean tags, seasonal associations, trigger warnings) with a live-filtering Comfort Finder (presets + advanced sliders) and weighted ranking
- Recommendation engine: TMDB similar/recommendations scored against a rating-weighted taste profile (`genre*0.35 + actor*0.2 + director*0.15 + comfort*0.3`), plus library-only "comfort rewatch," "high energy," and "low attention" picks

### Performance
- O(1) indexed repository lookups (id and foreign-key indexes, versioned invalidation) instead of linear scans
- Memoized analytics computation keyed on a cheap combined data-version signature
- Virtualized rendering for the library's list view, so DOM node count stays constant regardless of library size

### Testing
- Vitest suite covering the invariants that matter most: never-overwrite-reviews, import/Trakt-sync idempotency, and note-regeneration content preservation, plus broad coverage of analytics, comfort filtering/ranking, the recommendation engine, library filter/sort/pagination, media-add dedup, Trakt token refresh, indexed repository CRUD at scale, and virtual-scroll range math (50 tests across 13 files)

---

## Known limitations

- No destructive "replace" import mode by design — it would conflict with the never-overwrite-reviews invariant. Import is always additive/merge.
- "Hidden gems" recommendations are a heuristic (next-tier TMDB affinity matches) rather than a true popularity-based signal, since TMDB's search/similar endpoints don't expose a popularity figure to filter on.
- Grid view (poster cards) is not virtualized — only the list view is. Grid is bounded by pagination instead; true grid virtualization with responsive column counts was judged not worth the added complexity at this stage.
