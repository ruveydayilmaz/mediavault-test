import { ItemView, WorkspaceLeaf, setIcon, Platform } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_LIBRARY } from "../../constants";
import { MediaItem } from "../../models/media";
import {
	LibraryFilter,
	LibrarySortField,
	LibraryQuery,
	DEFAULT_LIBRARY_QUERY,
	runLibraryQuery,
	PROGRESS_TABS,
	applyProgressTab,
} from "../../services/library-query";
import { renderPoster, statusLabel, formatRuntime, formatRating, getMediaPercentWatched, renderProgressOverlay, progressFillClasses } from "../components/media-render";
import { MediaDetailModal } from "../modals/media-detail-modal";
import { renderVirtualList } from "../components/virtual-list";
import { StatsBar } from "../components/stats-bar";
import { renderFavoritesSection } from "../components/favorites-carousel";
import { renderCustomListsCarousel } from "../components/custom-lists-carousel";
import { ListDetailModal } from "../modals/list-detail-modal";
import {
	FilterCriteria,
	DEFAULT_FILTER_CRITERIA,
	RuntimeMode,
	buildFilterContext,
	applyUniversalFilter,
	collectFilterOptions,
	hasActiveFilters,
} from "../../services/filter-service";

type ViewMode = "grid" | "list" | "table";
type ScreenTier = "mobile" | "tablet" | "desktop";

/** Container-width breakpoints — measured on this view's own pane, not the device, so a narrow desktop sidebar behaves like mobile and a wide phone split-view doesn't. */
const MOBILE_BREAKPOINT_PX = 520;
const TABLET_BREAKPOINT_PX = 900;

function screenTierForWidth(width: number): ScreenTier {
	if (width < MOBILE_BREAKPOINT_PX) return "mobile";
	if (width < TABLET_BREAKPOINT_PX) return "tablet";
	return "desktop";
}

/**
 * Mirrors the Library grid's mobile column count. The grid's own
 * breakpoint (`.is-phone .mediavault-grid`, see styles.css) is a
 * `@media (max-width: 380px)` query, which — like all media queries —
 * evaluates against the window's viewport width. So that's what this
 * checks too, rather than re-deriving it from an element's clientWidth:
 * a container narrowed by its own padding (e.g. safe-area insets) would
 * disagree with the window-width threshold the CSS is actually using,
 * which is exactly what caused Favorites to fall out of sync with the
 * grid previously.
 *
 * (A tempting alternative is reading the grid's rendered
 * `grid-template-columns` directly off the DOM — but that requires the
 * grid to have already gone through a real layout pass, which isn't
 * reliably true the moment the view opens, before the workspace leaf has
 * settled to its final size. That produced a worse bug: a bogus
 * single-column reading. Checking the same window width the CSS itself
 * uses sidesteps layout timing entirely.)
 */
const MOBILE_GRID_BREAKPOINT_PX = 380;

function mobileGridColumnCount(): number {
	return window.innerWidth <= MOBILE_GRID_BREAKPOINT_PX ? 3 : 4;
}

/**
 * Desktop/web Favorites poster count — a continuous function of the
 * carousel's own available width (not the device), so it grows and
 * shrinks smoothly as the pane is resized instead of jumping at fixed
 * breakpoints. Clamped to the spec's given range (narrow → 3, wide → 6).
 */
function desktopFavoritesCount(width: number): number {
	const IDEAL_CARD_WIDTH_PX = 150;
	return Math.min(6, Math.max(3, Math.round(width / IDEAL_CARD_WIDTH_PX)));
}

const FILTER_OPTIONS: { value: LibraryFilter; label: string }[] = [
	{ value: "all", label: "All" },
	{ value: "movies", label: "Movies" },
	{ value: "shows", label: "Shows" },
	{ value: "favorites", label: "Favorites" },
	{ value: "comfort", label: "Comfort" },
];

const SORT_OPTIONS: { value: LibrarySortField; label: string }[] = [
	{ value: "recent", label: "Recent" },
	{ value: "title", label: "Title" },
	{ value: "rating", label: "Rating" },
	{ value: "watchCount", label: "Watch Count" },
	{ value: "year", label: "Year" },
	{ value: "runtime", label: "Runtime" },
];

export class LibraryView extends ItemView {
	private plugin: MediaVaultPlugin;
	private query: LibraryQuery = { ...DEFAULT_LIBRARY_QUERY };
	private viewMode: ViewMode = "grid";
	private filterCriteria: FilterCriteria = { ...DEFAULT_FILTER_CRITERIA };
	private filterPanelOpen = false;

	private contentEl2!: HTMLElement;
	private statsEl!: HTMLElement;
	private statsBar = new StatsBar();
	private parentEl!: HTMLElement;
	private favoritesEl!: HTMLElement;
	private tabsEl!: HTMLElement;
	private filtersEl!: HTMLElement;
	private filterToggleBtn!: HTMLButtonElement;
	private searchDebounce: ReturnType<typeof setTimeout> | null = null;

	private favoritesTab: "movies" | "shows" = "movies";
	/** Guards refreshCustomLists() against overlapping calls (same race class fixed in ListsView.refresh() — see notifyChanged() in list-detail-modal.ts). */
	private customListsRefreshToken = 0;
	private customListsEl!: HTMLElement;

	private screenTier: ScreenTier = "desktop";
	private resizeObserver?: ResizeObserver;
	private viewToggleEl!: HTMLElement;

	/** Responsive Favorites carousel count (Milestone 2) — mobile mirrors the Library grid's column count, desktop is a continuous function of available width. Recomputed on every resize, not just tier changes. */
	private favoritesVisibleCount = 4;
	private lastAllMedia: MediaItem[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
		super(leaf);
		this.plugin = plugin;
		this.viewMode = plugin.storage.settings.get().defaultView;
		const settings = plugin.storage.settings.get();
		this.query = { ...DEFAULT_LIBRARY_QUERY, sortField: settings.defaultSort, sortDirection: settings.defaultSortDirection };
	}

	getViewType(): string {
		return VIEW_TYPE_LIBRARY;
	}

	getDisplayText(): string {
		return "MediaVault Library";
	}

	getIcon(): string {
		return "clapperboard";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("mediavault-library-root");

		this.statsEl = root.createDiv({ cls: "mediavault-stats-container" });
		this.parentEl = root.createDiv({ cls: "mediavault-parent-container" });
		this.favoritesEl = this.parentEl.createDiv({ cls: "mediavault-favorites-container" });
		this.customListsEl = this.parentEl.createDiv({
			cls: "mediavault-custom-lists-container",
		});
		this.tabsEl = root.createDiv({ cls: "mediavault-tabs-container" });
		this.renderToolbar(root);
		this.filtersEl = root.createDiv({ cls: "mediavault-filters-container" });
		this.contentEl2 = root.createDiv({ cls: "mediavault-library-content" });

		// Responsive view modes (Milestone 2): breakpoints are measured on
		// this view's own pane width via ResizeObserver, not device
		// detection — so a narrow desktop sidebar or a split-screen tablet
		// behaves correctly regardless of what device it's running on.
		this.screenTier = screenTierForWidth(root.clientWidth);
		this.viewMode = this.defaultViewModeForTier(this.screenTier);
		this.favoritesVisibleCount = Platform.isMobile ? mobileGridColumnCount() : desktopFavoritesCount(root.clientWidth);
		this.renderViewToggle();

		this.resizeObserver = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? root.clientWidth;

			const nextFavoritesCount = Platform.isMobile
				? mobileGridColumnCount()
				: desktopFavoritesCount(this.favoritesEl.clientWidth || width);
			const favoritesCountChanged = nextFavoritesCount !== this.favoritesVisibleCount;
			if (favoritesCountChanged) {
				this.favoritesVisibleCount = nextFavoritesCount;
			}

			const nextTier = screenTierForWidth(width);
			if (nextTier === this.screenTier) {
				// No view-mode change, but the Favorites carousel may still
				// need to re-render at the new poster count.
				if (favoritesCountChanged) void this.refreshFavorites(this.lastAllMedia);
				return;
			}

			this.screenTier = nextTier;
			this.viewMode = this.defaultViewModeForTier(nextTier);
			this.renderViewToggle();
			void this.refresh();
		});
		this.resizeObserver.observe(root);

		await this.refresh();
	}

	async onClose(): Promise<void> {
		this.resizeObserver?.disconnect();
	}

	/** Mobile always remembers/uses Grid only; tablet and desktop share one remembered preference. */
	private defaultViewModeForTier(tier: ScreenTier): ViewMode {
		if (tier === "mobile") return "grid";
		return this.plugin.storage.settings.get().defaultView;
	}

	/** Call after any mutation (add/remove media, log a watch, import, Trakt sync, etc.) elsewhere in the plugin to keep this view in sync. */
	async refresh(): Promise<void> {
		const all = await this.plugin.storage.media.getAll();
		this.lastAllMedia = all;
		const filterCtx = await buildFilterContext(this.plugin.storage);
		const universallyFiltered = applyUniversalFilter(all, this.filterCriteria, filterCtx);

		this.renderTabs(universallyFiltered);
		this.renderFilterPanel(all);

		const result = runLibraryQuery(universallyFiltered, this.query);
		this.renderContent(result.items, result.total, result.page, Math.ceil(result.total / result.pageSize) || 1);

		await Promise.all([
			this.refreshStats(),
			this.refreshFavorites(all),
			this.refreshCustomLists(all),
		]);
	}

	private async refreshStats(): Promise<void> {
		const stats = await this.plugin.statistics.getAll();
		this.statsBar.update(this.statsEl, stats);
	}

	private async refreshFavorites(all: MediaItem[]): Promise<void> {
		this.favoritesEl.empty();

		if (Platform.isMobile) {
			this.favoritesVisibleCount = mobileGridColumnCount();
		}

		await renderFavoritesSection(
			this.favoritesEl,
			this.plugin.storage,
			all,
			this.favoritesTab,
			(tab) => {
				this.favoritesTab = tab;
				this.refreshFavorites(all);
			},
			() => {
				// "View All" (Milestone 5: Favorites "View All" Navigation)
				// reuses the existing Library layout/pipeline rather than a
				// separate page: constrain to this favorites tab's media
				// type (query.filter, already-solved primitive) plus
				// favoritesOnly (already-solved primitive from the
				// universal filter engine) — sorting, page size, and view
				// mode are left untouched, so they carry over exactly as
				// the user left them.
				this.query.filter = this.favoritesTab === "movies" ? "movies" : "shows";
				this.filterCriteria.favoritesOnly = true;
				this.query.page = 1;
				void (async () => {
					await this.refresh();
					this.contentEl2.scrollIntoView({ behavior: "smooth", block: "start" });
				})();
			},
			(item) => this.openDetail(item),
			{ visibleCount: this.favoritesVisibleCount, fillPlaceholders: Platform.isMobile }
		);
	}

	private async refreshCustomLists(all: MediaItem[]): Promise<void> {
		const token = ++this.customListsRefreshToken;

		const lists = await this.plugin.storage.customLists.getAll();

		if (token !== this.customListsRefreshToken) return;

		this.customListsEl.empty();

		await renderCustomListsCarousel(
			this.customListsEl,
			all,
			lists,
			(list) => {
				new ListDetailModal(this.app, this.plugin, list).open();
			}
		);
	}

	// ---- Progress Tabs (Milestone 3) ----

	/**
	 * Tabs filter purely on `MediaItem.status`, which StatusService already
	 * derives and keeps current — this just counts/filters that field, it
	 * never recomputes status itself.
	 */
	private renderTabs(all: MediaItem[]): void {
		this.tabsEl.empty();
		const bar = this.tabsEl.createDiv({ cls: "mediavault-progress-tabs" });

		PROGRESS_TABS.forEach((tab) => {
			const count = tab.value === "all" ? all.length : applyProgressTab(all, tab.value).length;
			const btn = bar.createEl("button", {
				cls: "mediavault-progress-tab" + (this.query.progressTab === tab.value ? " is-active" : ""),
				text: `${tab.label} (${count})`,
			});
			btn.addEventListener("click", () => {
				if (this.query.progressTab === tab.value) return;
				this.query.progressTab = tab.value;
				this.query.page = 1;
				void this.refresh();
			});
		});
	}

	// ---- Universal Filtering (Milestone 4) ----

	/**
	 * Collapsible panel for the non-Progress criteria in FilterCriteria.
	 * Option lists (genres/actors/directors/studios/tags) are derived from
	 * the full, unfiltered library so removing a constraint doesn't also
	 * hide the option that would restore it.
	 */
	private renderFilterPanel(all: MediaItem[]): void {
		const active = hasActiveFilters(this.filterCriteria);
		this.filterToggleBtn.toggleClass("is-active", active);

		this.filtersEl.empty();
		if (!this.filterPanelOpen) return;

		const options = collectFilterOptions(all);
		const panel = this.filtersEl.createDiv({ cls: "mediavault-filter-panel" });

		// Mobile Library Controls (Milestone 4): sort and pagination move
		// into this expandable panel instead of the toolbar, to keep the
		// toolbar compact on small screens. Desktop/tablet keep them in the
		// toolbar (rendered by renderToolbar) and skip them here.
		if (this.screenTier === "mobile") {
			const mobileControlsRow = panel.createDiv({ cls: "mediavault-filter-row mediavault-filter-mobile-controls" });
			this.renderSortControls(mobileControlsRow);
			this.renderPageSizeControl(mobileControlsRow);
		}

		const applyAndRefresh = () => {
			this.query.page = 1;
			void this.refresh();
		};

		// Genre / Tags — multi-select checkboxes
		this.renderMultiCheckGroup(panel, "Genre", options.genres, this.filterCriteria.genres, applyAndRefresh);
		this.renderMultiCheckGroup(panel, "Tags", options.tags, this.filterCriteria.tags, applyAndRefresh);

		// Actor / Director / Studio — searchable multi-select via datalist-backed text input
		this.renderTagInput(panel, "Actor", options.actors, this.filterCriteria.actors, applyAndRefresh);
		this.renderTagInput(panel, "Director", options.directors, this.filterCriteria.directors, applyAndRefresh);
		this.renderTagInput(panel, "Studio", options.studios, this.filterCriteria.studios, applyAndRefresh);

		// Release Year range
		const yearRow = panel.createDiv({ cls: "mediavault-filter-row" });
		yearRow.createSpan({ cls: "mediavault-filter-label", text: "Release Year" });
		const yearMin = yearRow.createEl("input", { type: "number", attr: { placeholder: "Min" } });
		yearMin.value = this.filterCriteria.yearMin?.toString() ?? "";
		yearMin.addEventListener("change", () => {
			this.filterCriteria.yearMin = yearMin.value ? parseInt(yearMin.value, 10) : undefined;
			applyAndRefresh();
		});
		const yearMax = yearRow.createEl("input", { type: "number", attr: { placeholder: "Max" } });
		yearMax.value = this.filterCriteria.yearMax?.toString() ?? "";
		yearMax.addEventListener("change", () => {
			this.filterCriteria.yearMax = yearMax.value ? parseInt(yearMax.value, 10) : undefined;
			applyAndRefresh();
		});

		// Runtime — mode selector (Movie / Episode / Total, per roadmap) + min/max range
		const runtimeRow = panel.createDiv({ cls: "mediavault-filter-row" });
		runtimeRow.createSpan({ cls: "mediavault-filter-label", text: "Runtime" });
		const runtimeModeSelect = runtimeRow.createEl("select");
		([
			{ value: "movie", label: "Movie Runtime" },
			{ value: "episode", label: "Episode Runtime" },
			{ value: "total", label: "Total Series Runtime" },
		] as { value: RuntimeMode; label: string }[]).forEach((opt) => {
			runtimeModeSelect.createEl("option", { value: opt.value, text: opt.label });
		});
		runtimeModeSelect.value = this.filterCriteria.runtimeMode;
		runtimeModeSelect.addEventListener("change", () => {
			this.filterCriteria.runtimeMode = runtimeModeSelect.value as RuntimeMode;
			applyAndRefresh();
		});
		const runtimeMin = runtimeRow.createEl("input", {
			type: "range",
			attr: { min: "0", max: "3000", step: "5" },
		});
		runtimeMin.value = String(this.filterCriteria.runtimeMin ?? 0);
		const runtimeMinLabel = runtimeRow.createSpan({ text: `${this.filterCriteria.runtimeMin ?? 0} min` });
		runtimeMin.addEventListener("input", () => {
			runtimeMinLabel.setText(`${runtimeMin.value} min`);
		});
		runtimeMin.addEventListener("change", () => {
			const v = parseInt(runtimeMin.value, 10);
			this.filterCriteria.runtimeMin = v > 0 ? v : undefined;
			applyAndRefresh();
		});
		const runtimeMax = runtimeRow.createEl("input", {
			type: "range",
			attr: { min: "0", max: "3000", step: "5" },
		});
		runtimeMax.value = String(this.filterCriteria.runtimeMax ?? 3000);
		const runtimeMaxLabel = runtimeRow.createSpan({ text: `${this.filterCriteria.runtimeMax ?? 3000} min` });
		runtimeMax.addEventListener("input", () => {
			runtimeMaxLabel.setText(`${runtimeMax.value} min`);
		});
		runtimeMax.addEventListener("change", () => {
			const v = parseInt(runtimeMax.value, 10);
			this.filterCriteria.runtimeMax = v < 3000 ? v : undefined;
			applyAndRefresh();
		});

		// Rating
		this.renderMinSlider(panel, "Rating", 0, 10, 0.5, this.filterCriteria.ratingMin, (v) => {
			this.filterCriteria.ratingMin = v;
			applyAndRefresh();
		});

		// Favorite
		const favRow = panel.createDiv({ cls: "mediavault-filter-row" });
		const favCheckbox = favRow.createEl("input", { type: "checkbox" });
		favCheckbox.checked = this.filterCriteria.favoritesOnly;
		favRow.createSpan({ text: "Favorite only" });
		favCheckbox.addEventListener("change", () => {
			this.filterCriteria.favoritesOnly = favCheckbox.checked;
			applyAndRefresh();
		});

		// Comfort Score
		this.renderMinSlider(panel, "Comfort Score", 0, 10, 1, this.filterCriteria.comfortScoreMin, (v) => {
			this.filterCriteria.comfortScoreMin = v;
			applyAndRefresh();
		});

		// Watch Count
		this.renderMinSlider(panel, "Watch Count", 0, 20, 1, this.filterCriteria.watchCountMin, (v) => {
			this.filterCriteria.watchCountMin = v;
			applyAndRefresh();
		});

		// Reset
		const resetBtn = panel.createEl("button", { cls: "mediavault-filter-reset", text: "Reset Filters" });
		resetBtn.addEventListener("click", () => {
			this.filterCriteria = { ...DEFAULT_FILTER_CRITERIA };
			applyAndRefresh();
		});
	}

	private renderMultiCheckGroup(
		panel: HTMLElement,
		label: string,
		options: string[],
		selected: string[],
		onChange: () => void
	): void {
		if (options.length === 0) return;
		const row = panel.createDiv({ cls: "mediavault-filter-row mediavault-filter-checkgroup" });
		row.createSpan({ cls: "mediavault-filter-label", text: label });
		const list = row.createDiv({ cls: "mediavault-filter-checklist" });
		options.forEach((opt) => {
			const optLabel = list.createEl("label", { cls: "mediavault-filter-checkitem" });
			const checkbox = optLabel.createEl("input", { type: "checkbox" });
			checkbox.checked = selected.includes(opt);
			optLabel.createSpan({ text: opt });
			checkbox.addEventListener("change", () => {
				if (checkbox.checked) {
					if (!selected.includes(opt)) selected.push(opt);
				} else {
					const idx = selected.indexOf(opt);
					if (idx >= 0) selected.splice(idx, 1);
				}
				onChange();
			});
		});
	}

	private renderTagInput(panel: HTMLElement, label: string, options: string[], selected: string[], onChange: () => void): void {
		if (options.length === 0) return;
		const row = panel.createDiv({ cls: "mediavault-filter-row" });
		row.createSpan({ cls: "mediavault-filter-label", text: label });

		if (selected.length > 0) {
			const chips = row.createDiv({ cls: "mediavault-filter-chips" });
			selected.forEach((name) => {
				const chip = chips.createDiv({ cls: "mediavault-filter-chip", text: name });
				const remove = chip.createSpan({ cls: "mediavault-filter-chip-remove", text: " ×" });
				remove.addEventListener("click", () => {
					const idx = selected.indexOf(name);
					if (idx >= 0) selected.splice(idx, 1);
					onChange();
				});
			});
		}

		const datalistId = `mediavault-filter-datalist-${label.toLowerCase()}`;
		const input = row.createEl("input", { type: "text", attr: { placeholder: `Add ${label.toLowerCase()}...`, list: datalistId } });
		const datalist = row.createEl("datalist", { attr: { id: datalistId } });
		options.forEach((opt) => datalist.createEl("option", { value: opt }));

		input.addEventListener("change", () => {
			const value = input.value.trim();
			if (value && options.includes(value) && !selected.includes(value)) {
				selected.push(value);
				input.value = "";
				onChange();
			}
		});
	}

	private renderMinSlider(
		panel: HTMLElement,
		label: string,
		min: number,
		max: number,
		step: number,
		value: number | undefined,
		onChange: (v: number | undefined) => void
	): void {
		const row = panel.createDiv({ cls: "mediavault-filter-row" });
		row.createSpan({ cls: "mediavault-filter-label", text: `${label} (min)` });
		const slider = row.createEl("input", { type: "range", attr: { min: String(min), max: String(max), step: String(step) } });
		slider.value = String(value ?? min);
		const valueLabel = row.createSpan({ text: String(value ?? min) });
		slider.addEventListener("input", () => valueLabel.setText(slider.value));
		slider.addEventListener("change", () => {
			const v = parseFloat(slider.value);
			onChange(v > min ? v : undefined);
		});
	}

	// ---- Toolbar ----

	private renderToolbar(root: HTMLElement): void {
		const toolbar = root.createDiv({ cls: "mediavault-library-toolbar" });

		// Search
		const searchInput = toolbar.createEl("input", {
			type: "text",
			placeholder: "Search your library...",
			cls: "mediavault-library-search",
		});
		searchInput.addEventListener("input", () => {
			if (this.searchDebounce) clearTimeout(this.searchDebounce);
			this.searchDebounce = setTimeout(() => {
				this.query.searchText = searchInput.value;
				this.query.page = 1;
				void this.refresh();
			}, 250);
		});

		// Filter dropdown
		const filterSelect = toolbar.createEl("select", { cls: "mediavault-library-filter" });
		FILTER_OPTIONS.forEach((opt) => {
			filterSelect.createEl("option", { value: opt.value, text: opt.label });
		});
		filterSelect.value = this.query.filter;
		filterSelect.addEventListener("change", () => {
			this.query.filter = filterSelect.value as LibraryFilter;
			this.query.page = 1;
			void this.refresh();
		});

		// Advanced filters toggle (Milestone 4 — Universal Filtering; iconified
		// per Mobile UI Polish Milestone 2 — the active-state "Filters ●" text
		// badge becomes a CSS dot on the icon instead).
		this.filterToggleBtn = toolbar.createEl("button", { cls: "clickable-icon mediavault-filters-toggle" });
		setIcon(this.filterToggleBtn, "sliders-horizontal");
		this.filterToggleBtn.setAttr("aria-label", "Filters");
		this.filterToggleBtn.addEventListener("click", () => {
			this.filterPanelOpen = !this.filterPanelOpen;
			void this.refresh();
		});

		// Sort dropdown + direction toggle, and page size (Mobile Library
		// Controls, Milestone 4): on mobile these move into the expandable
		// Filter panel instead of the toolbar, to keep the toolbar compact.
		if (this.screenTier !== "mobile") {
			this.renderSortControls(toolbar);
			this.renderPageSizeControl(toolbar);
		}

		// View mode toggle (Milestone 3: Library UI Polish; Milestone 2 of
		// this roadmap gates which modes are offered by screen tier). The
		// Grid toggle is removed entirely on mobile (Milestone 4) — the
		// library already always uses the responsive grid there, so a
		// single-option toggle button was pure clutter.
		this.viewToggleEl = toolbar.createDiv({ cls: "mediavault-library-view-toggle" });
		this.renderViewToggle();
	}

	private renderSortControls(container: HTMLElement): void {
		const sortGroup = container.createDiv({ cls: "mediavault-library-sort-group" });
		const sortIcon = sortGroup.createDiv({ cls: "mediavault-library-sort-icon" });
		setIcon(sortIcon, "arrow-up-down");
		sortIcon.setAttr("aria-label", "Sort");
		const sortSelect = sortGroup.createEl("select", { cls: "mediavault-library-sort" });
		SORT_OPTIONS.forEach((opt) => {
			sortSelect.createEl("option", { value: opt.value, text: `Sort: ${opt.label}` });
		});
		sortSelect.value = this.query.sortField;
		sortSelect.addEventListener("change", () => {
			this.query.sortField = sortSelect.value as LibrarySortField;
			void this.plugin.storage.settings.update({ defaultSort: this.query.sortField });
			void this.refresh();
		});

		const dirBtn = sortGroup.createEl("button", { cls: "clickable-icon mediavault-library-sort-dir" });
		setIcon(dirBtn, this.query.sortDirection === "asc" ? "arrow-up" : "arrow-down");
		dirBtn.setAttr("aria-label", this.query.sortDirection === "asc" ? "Ascending" : "Descending");
		dirBtn.addEventListener("click", () => {
			this.query.sortDirection = this.query.sortDirection === "asc" ? "desc" : "asc";
			setIcon(dirBtn, this.query.sortDirection === "asc" ? "arrow-up" : "arrow-down");
			dirBtn.setAttr("aria-label", this.query.sortDirection === "asc" ? "Ascending" : "Descending");
			void this.plugin.storage.settings.update({ defaultSortDirection: this.query.sortDirection });
			void this.refresh();
		});
	}

	private renderPageSizeControl(container: HTMLElement): void {
		// Page size — larger sizes rely on virtualized rendering (list view) to stay fast.
		const pageSizeSelect = container.createEl("select", { cls: "mediavault-library-page-size" });
		[
			{ value: "24", label: "24 / page" },
			{ value: "100", label: "100 / page" },
			{ value: "1000", label: "1000 / page" },
			{ value: "999999", label: "Show all" },
		].forEach((opt) => pageSizeSelect.createEl("option", { value: opt.value, text: opt.label }));
		pageSizeSelect.value = String(this.query.pageSize);
		pageSizeSelect.addEventListener("change", () => {
			this.query.pageSize = parseInt(pageSizeSelect.value, 10);
			this.query.page = 1;
			void this.refresh();
		});
	}

	private renderViewToggle(): void {
		this.viewToggleEl.empty();
		if (this.screenTier === "mobile") return;
		const viewModeIcons: Record<ViewMode, string> = { grid: "layout-grid", list: "rows-3", table: "table" };
		const availableModes: ViewMode[] = ["grid", "list", "table"];

		availableModes.forEach((mode) => {
			const btn = this.viewToggleEl.createEl("button", {
				cls: "clickable-icon mediavault-view-toggle-btn" + (mode === this.viewMode ? " is-active" : ""),
			});
			setIcon(btn, viewModeIcons[mode]);
			btn.setAttr("aria-label", mode[0].toUpperCase() + mode.slice(1));
			btn.addEventListener("click", () => {
				this.viewMode = mode;
				this.viewToggleEl.querySelectorAll("button").forEach((b) => b.removeClass("is-active"));
				btn.addClass("is-active");
				void this.plugin.storage.settings.update({ defaultView: mode });
				void this.refresh();
			});
		});
	}

	// ---- Content rendering ----

	private renderContent(items: MediaItem[], total: number, page: number, totalPages: number): void {
		this.contentEl2.empty();

		if (total === 0) {
			this.contentEl2.createDiv({
				cls: "mediavault-library-empty",
				text: "No media matches your current filters.",
			});
			return;
		}

		if (this.viewMode === "grid") {
			this.renderGrid(items);
		} else if (this.viewMode === "list") {
			this.renderList(items);
		} else {
			this.renderTable(items);
		}

		this.renderPagination(page, totalPages, total);
	}

	private renderGrid(items: MediaItem[]): void {
		const grid = this.contentEl2.createDiv({ cls: "mediavault-grid" });
		items.forEach((item) => {
			const card = grid.createDiv({ cls: "mediavault-card" });
			card.addEventListener("click", () => this.openDetail(item));
			const poster = card.createDiv({ cls: "mediavault-card-poster" });
			renderPoster(poster, item, "w200");

			void getMediaPercentWatched(this.plugin.storage, item).then((percent) => {
				if (percent === null) return;
				renderProgressOverlay(poster, percent, item.status);
			});
		});
	}

	private listCleanup: (() => void) | null = null;

	private renderList(items: MediaItem[]): void {
		if (this.listCleanup) this.listCleanup();

		const list = this.contentEl2.createDiv({ cls: "mediavault-list" });

		this.listCleanup = renderVirtualList({
			container: list,
			items,
			rowHeight: 76, // matches .mediavault-list-row's fixed height in CSS
			threshold: 100, // below this, just render normally — virtualization overhead isn't worth it
			renderRow: (item) => this.buildListRow(item),
		});
	}

	private buildListRow(item: MediaItem): HTMLElement {
		const row = document.createElement("div");
		row.addClass("mediavault-list-row");
		row.addEventListener("click", () => this.openDetail(item));
		const poster = row.createDiv({ cls: "mediavault-list-poster" });
		renderPoster(poster, item, "w200");

		void getMediaPercentWatched(this.plugin.storage, item).then((percent) => {
			if (percent === null) return;
			renderProgressOverlay(poster, percent, item.status, "mediavault-list-poster-progress");
		});

		const info = row.createDiv({ cls: "mediavault-list-info" });
		info.createDiv({ cls: "mediavault-list-title", text: item.title });
		info.createDiv({
			cls: "mediavault-list-meta",
			text: [item.year, item.genres.join(", "), formatRuntime(item.runtime)].filter(Boolean).join(" · "),
		});

		row.createDiv({ cls: "mediavault-list-status", text: statusLabel(item.status) });
		row.createDiv({
			cls: "mediavault-list-rating",
			text: item.averageRating !== null ? `★ ${formatRating(item.averageRating)}` : "—",
		});

		return row;
	}

	private renderTable(items: MediaItem[]): void {
		const table = this.contentEl2.createEl("table", { cls: "mediavault-table" });
		const thead = table.createEl("thead");
		const headRow = thead.createEl("tr");
		["Title", "Year", "Type", "Status", "Progress", "Rating", "Watch Count", "Runtime"].forEach((h) => {
			headRow.createEl("th", { text: h });
		});

		const tbody = table.createEl("tbody");
		items.forEach((item) => {
			const row = tbody.createEl("tr");
			row.addEventListener("click", () => this.openDetail(item));
			row.createEl("td", { text: item.title });
			row.createEl("td", { text: item.year ? String(item.year) : "—" });
			row.createEl("td", { text: item.type });
			row.createEl("td", { text: statusLabel(item.status) });

			const progressCell = row.createEl("td");
			void getMediaPercentWatched(this.plugin.storage, item).then((percent) => {
				if (percent === null) {
					progressCell.setText("—");
					return;
				}
				const track = progressCell.createDiv({ cls: "mediavault-table-progress" });
				track.createDiv({
					cls: progressFillClasses("mediavault-card-progress-fill", item.status),
					attr: { style: `width:${Math.round(percent)}%` },
				});
			});

			row.createEl("td", { text: formatRating(item.averageRating) });
			row.createEl("td", { text: String(item.watchCount) });
			row.createEl("td", { text: formatRuntime(item.runtime) });
		});
	}

	private openDetail(item: MediaItem): void {
		new MediaDetailModal(
			this.app,
			this.plugin.storage,
			this.plugin.tmdb,
			item,
			() => {
				// Milestone 8 (Watch Next Synchronization): calling only
				// `this.refresh()` here refreshed this LibraryView leaf but
				// never Watch Next or Analytics, since those are only
				// refreshed by `plugin.refreshLibraryViews()` — so marking
				// an episode watched from the detail modal silently left
				// the Watch Next sidebar stale. `refreshLibraryViews()`
				// already iterates every LibraryView leaf (this one
				// included), so it's a straight replacement, not an
				// addition.
				this.plugin.refreshLibraryViews();
				this.plugin.refreshListViews();
			},
			this.plugin,
			"episodes",
			this.plugin.trakt
		).open();
	}

	private renderPagination(page: number, totalPages: number, total: number): void {
		if (totalPages <= 1) return;

		const pagination = this.contentEl2.createDiv({ cls: "mediavault-pagination" });

		const prevBtn = pagination.createEl("button", { cls: "clickable-icon mediavault-pagination-btn" });
		setIcon(prevBtn, "chevron-left");
		prevBtn.setAttr("aria-label", "Previous page");
		prevBtn.disabled = page <= 1;
		prevBtn.addEventListener("click", () => {
			this.query.page = page - 1;
			void this.refresh();
		});

		pagination.createSpan({ cls: "mediavault-pagination-info", text: `Page ${page} of ${totalPages} (${total} items)` });

		const nextBtn = pagination.createEl("button", { cls: "clickable-icon mediavault-pagination-btn" });
		setIcon(nextBtn, "chevron-right");
		nextBtn.setAttr("aria-label", "Next page");
		nextBtn.disabled = page >= totalPages;
		nextBtn.addEventListener("click", () => {
			this.query.page = page + 1;
			void this.refresh();
		});
	}
}