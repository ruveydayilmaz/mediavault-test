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
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { getSystemFavoriteLists } from "../../services/list-service";
import { isAndroidDevice } from "../../utils/platform";
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

const MOBILE_BREAKPOINT_PX = 520;
const TABLET_BREAKPOINT_PX = 900;

function screenTierForWidth(width: number): ScreenTier {
	if (width < MOBILE_BREAKPOINT_PX) return "mobile";
	if (width < TABLET_BREAKPOINT_PX) return "tablet";
	return "desktop";
}

const MOBILE_GRID_BREAKPOINT_PX = 380;

function mobileGridColumnCount(): number {
	return window.innerWidth <= MOBILE_GRID_BREAKPOINT_PX ? 3 : 4;
}

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
	private viewRoot!: HTMLElement;
	private collapseMinHeightHandler: (() => void) | null = null;
	private toolbarEl!: HTMLElement;
	private toolbarSearchEl!: HTMLElement;
	private toolbarActionsEl!: HTMLElement;
	private statsEl!: HTMLElement;
	private statsBar = new StatsBar();
	private parentEl!: HTMLElement;
	private favoritesEl!: HTMLElement;
	private tabsEl!: HTMLElement;
	private filtersEl!: HTMLElement;
	private filterToggleBtn!: HTMLButtonElement;
	private searchDebounce: ReturnType<typeof setTimeout> | null = null;

	private favoritesTab: "movies" | "shows" = "movies";
	private customListsRefreshToken = 0;
	private customListsEl!: HTMLElement;

	private screenTier: ScreenTier = "desktop";
	private resizeObserver?: ResizeObserver;
	private viewToggleEl!: HTMLElement;

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
		this.viewRoot = root;

		this.statsEl = root.createDiv({ cls: "mediavault-stats-container" });
		this.parentEl = root.createDiv({ cls: "mediavault-parent-container" });
		this.favoritesEl = this.parentEl.createDiv({ cls: "mediavault-favorites-container" });
		this.customListsEl = this.parentEl.createDiv({
			cls: "mediavault-custom-lists-container",
		});
		this.tabsEl = root.createDiv({ cls: "mediavault-tabs-container" });

		this.screenTier = screenTierForWidth(root.clientWidth);
		this.viewMode = this.defaultViewModeForTier(this.screenTier);

		this.renderToolbar(root);
		this.filtersEl = root.createDiv({ cls: "mediavault-filters-container" });
		this.contentEl2 = root.createDiv({ cls: "mediavault-library-content" });

		this.favoritesVisibleCount = Platform.isMobile ? mobileGridColumnCount() : desktopFavoritesCount(root.clientWidth);
		this.renderViewToggle();

		this.resizeObserver = new ResizeObserver((entries) => {
			const width = entries[0]?.contentRect.width ?? root.clientWidth;

			this.updateToolbarWrapState();

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
		this.clearPendingMinHeightCollapse();
	}

	private defaultViewModeForTier(tier: ScreenTier): ViewMode {
		if (tier === "mobile") return "grid";
		return this.plugin.storage.settings.get().defaultView;
	}

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

		this.statsBar.update(
			this.statsEl,
			stats,
			this.screenTier === "mobile"
		);
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
				this.query.filter = this.favoritesTab === "movies" ? "movies" : "shows";
				this.filterCriteria.favoritesOnly = true;
				this.query.page = 1;
				void (async () => {
					await this.refresh();
					this.contentEl2.scrollIntoView({ behavior: "smooth", block: "start" });
				})();
			},
			(item) => this.openDetail(item),
			{ visibleCount: this.favoritesVisibleCount, fillPlaceholders: Platform.isMobile },
			async (tab) => {
				const allForLists = await this.plugin.storage.media.getAll();
				const [movieList, tvList] = getSystemFavoriteLists(allForLists, this.plugin.storage.settings.get());
				new ListDetailModal(this.app, this.plugin, tab === "movies" ? movieList : tvList).open();
			}
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
			},
			() => {
				void this.plugin.activateListsView();
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
		const barEl: HTMLElement =
			this.tabsEl.querySelector<HTMLElement>(".mediavault-progress-tabs") ??
			this.tabsEl.createDiv({ cls: "mediavault-progress-tabs" });

		const existingButtons = Array.from(barEl.querySelectorAll<HTMLButtonElement>(".mediavault-progress-tab"));

		PROGRESS_TABS.forEach((tab, i) => {
			const count = tab.value === "all" ? all.length : applyProgressTab(all, tab.value).length;
			const isActive = this.query.progressTab === tab.value;

			let btn = existingButtons[i];
			if (!btn) {
				btn = barEl.createEl("button", { cls: "mediavault-progress-tab" });
				btn.addEventListener("click", () => {
					if (this.query.progressTab === tab.value) return;
					this.query.progressTab = tab.value;
					this.query.page = 1;
					void this.refresh();
				});
			}
			btn.setText(`${tab.label} (${count})`);
			btn.toggleClass("is-active", isActive);
		});

		// Defensive cleanup if PROGRESS_TABS ever shrinks at runtime.
		for (let i = PROGRESS_TABS.length; i < existingButtons.length; i++) {
			existingButtons[i].remove();
		}
	}

	private renderFilterPanel(all: MediaItem[]): void {
		const active = hasActiveFilters(this.filterCriteria);
		this.filterToggleBtn.toggleClass("is-active", active);

		this.filtersEl.empty();
		if (!this.filterPanelOpen) return;

		const options = collectFilterOptions(all);
		const panel = this.filtersEl.createDiv({ cls: "mediavault-filter-panel" });

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
		this.renderGenreSelector(panel, options.genres, all, applyAndRefresh);
		this.renderMultiCheckGroup(panel, "Tags", options.tags, this.filterCriteria.tags, applyAndRefresh);

		// Actor / Director / Studio — searchable multi-select via datalist-backed text input
		this.renderTagInput(panel, "Actor", options.actors, this.filterCriteria.actors, applyAndRefresh);
		this.renderTagInput(panel, "Director", options.directors, this.filterCriteria.directors, applyAndRefresh);
		this.renderTagInput(panel, "Studio", options.studios, this.filterCriteria.studios, applyAndRefresh);

		// Release Year range
		const yearRow = panel.createDiv({ cls: "mediavault-filter-row" });
		yearRow.createSpan({ cls: "mediavault-filter-label", text: "Release Year" });
		const yearGroup = yearRow.createDiv({ cls: "mediavault-filter-controls-group" });
		const yearMin = yearGroup.createEl("input", {
			cls: "mediavault-filter-number-input",
			type: "number",
			attr: { placeholder: "Min" },
		});
		yearMin.value = this.filterCriteria.yearMin?.toString() ?? "";
		yearMin.addEventListener("change", () => {
			this.filterCriteria.yearMin = yearMin.value ? parseInt(yearMin.value, 10) : undefined;
			applyAndRefresh();
		});
		yearGroup.createSpan({ cls: "mediavault-filter-range-sep", text: "–" });
		const yearMax = yearGroup.createEl("input", {
			cls: "mediavault-filter-number-input",
			type: "number",
			attr: { placeholder: "Max" },
		});
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
		const runtimeGroup = runtimeRow.createDiv({ cls: "mediavault-filter-controls-group" });
		const runtimeMin = runtimeGroup.createEl("input", {
			cls: "mediavault-filter-number-input mediavault-filter-runtime-input",
			type: "number",
			attr: { min: "0", step: "5", placeholder: "Min" },
		});
		runtimeMin.value = this.filterCriteria.runtimeMin?.toString() ?? "";
		runtimeGroup.createSpan({ cls: "mediavault-filter-runtime-unit", text: "min" });
		runtimeMin.addEventListener("change", () => {
			const parsed = parseInt(runtimeMin.value, 10);
			const v = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
			this.filterCriteria.runtimeMin = v;
			runtimeMin.value = v?.toString() ?? "";
			applyAndRefresh();
		});
		runtimeGroup.createSpan({ cls: "mediavault-filter-range-sep", text: "–" });
		const runtimeMax = runtimeGroup.createEl("input", {
			cls: "mediavault-filter-number-input mediavault-filter-runtime-input",
			type: "number",
			attr: { min: "0", step: "5", placeholder: "Max" },
		});
		runtimeMax.value = this.filterCriteria.runtimeMax?.toString() ?? "";
		runtimeGroup.createSpan({ cls: "mediavault-filter-runtime-unit", text: "min" });
		runtimeMax.addEventListener("change", () => {
			const parsed = parseInt(runtimeMax.value, 10);
			const v = Number.isFinite(parsed) && parsed > 0 ? parsed : undefined;
			this.filterCriteria.runtimeMax = v;
			runtimeMax.value = v?.toString() ?? "";
			applyAndRefresh();
		});

		// Rating
		this.renderMinSlider(panel, "Rating", 0, 10, 0.5, this.filterCriteria.ratingMin, (v) => {
			this.filterCriteria.ratingMin = v;
			applyAndRefresh();
		});

		// Favorite
		const favRow = panel.createDiv({ cls: "mediavault-filter-row" });
		favRow.createSpan({ cls: "mediavault-filter-label", text: "Favorite" });
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

	/**
	 * Visual genre filter (replaces the old checkbox list): a 3-row
	 * horizontal-scrolling grid of cards, each with a background image
	 * (cached permanently in settings, resolved once from the first
	 * locally-owned title in that genre) and a dark overlay with the
	 * genre name. Clicking toggles selection — reuses the exact same
	 * `filterCriteria.genres` array and `onChange` refresh callback as
	 * every other filter, so the actual filtering logic is unchanged.
	 */
	private renderGenreSelector(panel: HTMLElement, genres: string[], all: MediaItem[], onChange: () => void): void {
		if (genres.length === 0) return;
		const row = panel.createDiv({ cls: "mediavault-filter-row" });
		row.createSpan({ cls: "mediavault-filter-label", text: "Genre" });

		const grid = row.createDiv({ cls: "mediavault-genre-grid" });
		const settings = this.plugin.storage.settings.get();
		const cache = settings.genreImageCache;
		const toResolve: string[] = [];

		genres.forEach((genre) => {
			const card = grid.createDiv({ cls: "mediavault-genre-card" });
			card.toggleClass("is-selected", this.filterCriteria.genres.includes(genre));

			const cachedUrl = cache[genre];
			if (cachedUrl) {
				card.style.backgroundImage = `url(${cachedUrl})`;
			} else {
				toResolve.push(genre);
			}
			card.createDiv({ cls: "mediavault-genre-card-overlay" });
			card.createDiv({ cls: "mediavault-genre-card-name", text: genre });

			card.addEventListener("click", () => {
				const idx = this.filterCriteria.genres.indexOf(genre);
				if (idx >= 0) this.filterCriteria.genres.splice(idx, 1);
				else this.filterCriteria.genres.push(genre);
				card.toggleClass("is-selected", this.filterCriteria.genres.includes(genre));
				onChange();
			});
		});

		if (toResolve.length > 0) {
			void this.resolveGenreImages(toResolve, all, grid);
		}
	}

	/** Resolves and permanently caches a background image for each genre that doesn't have one yet — never re-resolved once cached, even if the source title is later removed. */
	private async resolveGenreImages(genresNeeded: string[], all: MediaItem[], grid: HTMLElement): Promise<void> {
		const updates: Record<string, string> = {};
		for (const genre of genresNeeded) {
			const source = all.find((m) => m.genres.includes(genre) && (m.backdropPath || m.posterPath));
			if (!source) continue;
			const url = tmdbImageUrl(source.backdropPath ?? source.posterPath, "w500");
			if (url) updates[genre] = url;
		}
		if (Object.keys(updates).length === 0) return;

		const current = this.plugin.storage.settings.get().genreImageCache;
		await this.plugin.storage.settings.update({ genreImageCache: { ...current, ...updates } });

		const cards = Array.from(grid.querySelectorAll<HTMLElement>(".mediavault-genre-card"));
		cards.forEach((card) => {
			const name = card.querySelector(".mediavault-genre-card-name")?.textContent;
			if (name && updates[name]) card.style.backgroundImage = `url(${updates[name]})`;
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

		const commitValue = (value: string) => {
			const trimmed = value.trim();
			if (trimmed && options.includes(trimmed) && !selected.includes(trimmed)) {
				selected.push(trimmed);
				onChange();
				return true;
			}
			return false;
		};

		if (isAndroidDevice()) {
			// Android's native <input list=datalist> suggestion popup competes
			// with the on-screen keyboard for screen space — on this platform
			// opening the list can cover or dismiss the keyboard entirely,
			// making it impossible to type. A JS-rendered suggestion box is
			// just an ordinary positioned element, so it never fights the
			// keyboard the way the OS-level datalist chrome does.
			const wrap = row.createDiv({ cls: "mediavault-autocomplete-wrap" });
			const input = wrap.createEl("input", {
				type: "text",
				attr: { placeholder: `Add ${label.toLowerCase()}...` },
			});
			const suggestionsEl = wrap.createDiv({ cls: "mediavault-autocomplete-list is-hidden" });

			const renderSuggestions = () => {
				const query = input.value.trim().toLowerCase();
				suggestionsEl.empty();
				if (!query) {
					suggestionsEl.addClass("is-hidden");
					return;
				}
				const matches = options.filter((opt) => opt.toLowerCase().includes(query) && !selected.includes(opt)).slice(0, 8);
				if (matches.length === 0) {
					suggestionsEl.addClass("is-hidden");
					return;
				}
				matches.forEach((opt) => {
					const item = suggestionsEl.createDiv({ cls: "mediavault-autocomplete-item", text: opt });
					// mousedown (not click) fires before the input's blur, so the
					// suggestion is still in the DOM when the value commits.
					item.addEventListener("mousedown", (evt) => {
						evt.preventDefault();
						commitValue(opt);
						input.value = "";
						suggestionsEl.addClass("is-hidden");
					});
				});
				suggestionsEl.removeClass("is-hidden");
			};

			input.addEventListener("input", renderSuggestions);
			input.addEventListener("focus", renderSuggestions);
			input.addEventListener("blur", () => window.setTimeout(() => suggestionsEl.addClass("is-hidden"), 150));
			input.addEventListener("change", () => {
				if (commitValue(input.value)) input.value = "";
			});
		} else {
			const datalistId = `mediavault-filter-datalist-${label.toLowerCase()}`;
			const input = row.createEl("input", { type: "text", attr: { placeholder: `Add ${label.toLowerCase()}...`, list: datalistId } });
			const datalist = row.createEl("datalist", { attr: { id: datalistId } });
			options.forEach((opt) => datalist.createEl("option", { value: opt }));

			input.addEventListener("change", () => {
				if (commitValue(input.value)) input.value = "";
			});
		}
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
		const slider = row.createEl("input", {
			cls: "mediavault-filter-slider",
			type: "range",
			attr: { min: String(min), max: String(max), step: String(step) },
		});
		slider.value = String(value ?? min);
		const valueLabel = row.createSpan({ cls: "mediavault-filter-slider-value", text: String(value ?? min) });
		slider.addEventListener("input", () => valueLabel.setText(slider.value));
		slider.addEventListener("change", () => {
			const v = parseFloat(slider.value);
			onChange(v > min ? v : undefined);
		});
	}

	// ---- Toolbar ----

	private renderToolbar(root: HTMLElement): void {
		const toolbar = root.createDiv({ cls: "mediavault-library-toolbar" });
		this.toolbarEl = toolbar;

		// Search
		const searchInput = toolbar.createEl("input", {
			type: "text",
			placeholder: "Search your library...",
			cls: "mediavault-library-search",
		});
		this.toolbarSearchEl = searchInput;
		searchInput.addEventListener("input", () => {
			if (this.searchDebounce) clearTimeout(this.searchDebounce);
			this.searchDebounce = setTimeout(() => {
				this.query.searchText = searchInput.value;
				this.query.page = 1;
				void this.refresh();
			}, 250);
		});

		// Sort + Filter (+ page size, view toggle) are grouped into a single
		// flex item so they wrap onto their own row together on tablet/desktop.
		// On mobile, Sort moves into the filter panel instead (see
		// renderFilterPanel) so the toolbar itself only has to fit Search |
		// Type | Filter, which is what actually needed to stay on one row.
		const actions = toolbar.createDiv({ cls: "mediavault-library-toolbar-actions" });
		this.toolbarActionsEl = actions;

		if (this.screenTier !== "mobile") {
			this.renderSortControls(actions);
		}

		const filterGroup = actions.createDiv({ cls: "mediavault-library-toolbar-filter-group" });
		const filterSelect = filterGroup.createEl("select", { cls: "mediavault-library-filter" });
		FILTER_OPTIONS.forEach((opt) => {
			filterSelect.createEl("option", { value: opt.value, text: opt.label });
		});
		filterSelect.value = this.query.filter;
		filterSelect.addEventListener("change", () => {
			this.query.filter = filterSelect.value as LibraryFilter;
			this.query.page = 1;
			void this.refresh();
		});

		this.filterToggleBtn = filterGroup.createEl("button", { cls: "clickable-icon mediavault-filters-toggle" });
		setIcon(this.filterToggleBtn, "sliders-horizontal");
		this.filterToggleBtn.setAttr("aria-label", "Filters");
		this.filterToggleBtn.addEventListener("click", () => {
			this.filterPanelOpen = !this.filterPanelOpen;
			void this.refresh();
		});

		if (this.screenTier !== "mobile") {
			this.renderPageSizeControl(actions);
		}

		this.viewToggleEl = actions.createDiv({ cls: "mediavault-library-view-toggle" });
		this.renderViewToggle();

		requestAnimationFrame(() => this.updateToolbarWrapState());
	}

	/**
	 * Detects whether the toolbar actually wrapped to a second row — by
	 * comparing rendered positions rather than checking width against a
	 * fixed breakpoint, since wrapping depends on real content (search
	 * placeholder length, locale, font) not just viewport size. Toggles a
	 * class the CSS uses to reserve extra bottom spacing only when needed,
	 * so pagination doesn't end up under Obsidian's floating nav bar.
	 */
	private updateToolbarWrapState(): void {
		if (!this.toolbarSearchEl || !this.toolbarActionsEl || !this.viewRoot) return;
		const searchTop = this.toolbarSearchEl.getBoundingClientRect().top;
		const actionsTop = this.toolbarActionsEl.getBoundingClientRect().top;
		const wrapped = Math.round(actionsTop) > Math.round(searchTop) + 1;
		this.viewRoot.toggleClass("mediavault-toolbar-wrapped", wrapped);
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
		// Milestone 5 (Library Tab Layout Stability): switching to a tab with
		// fewer items shrinks the grid, which yanks the viewport upward if the
		// user was scrolled down. Reserve the previous content height as a
		// min-height across the re-render so the page doesn't jump, then drop
		// it the moment the user scrolls so empty space doesn't linger forever.
		const prevHeight = this.contentEl2.getBoundingClientRect().height;
		this.clearPendingMinHeightCollapse();

		this.contentEl2.empty();

		if (total === 0) {
			this.contentEl2.createDiv({
				cls: "mediavault-library-empty",
				text: "No media matches your current filters.",
			});
			this.applyMinHeightReservation(prevHeight);
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
		this.applyMinHeightReservation(prevHeight);
	}

	private applyMinHeightReservation(prevHeight: number): void {
		if (prevHeight <= 0) return;
		this.contentEl2.style.minHeight = `${prevHeight}px`;

		const collapse = () => this.clearPendingMinHeightCollapse();
		this.collapseMinHeightHandler = collapse;
		this.viewRoot?.addEventListener("scroll", collapse, { passive: true });
	}

	private clearPendingMinHeightCollapse(): void {
		this.contentEl2.style.minHeight = "";
		if (this.collapseMinHeightHandler) {
			this.viewRoot?.removeEventListener("scroll", this.collapseMinHeightHandler);
			this.collapseMinHeightHandler = null;
		}
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
			void (async () => {
				await this.refresh();
				this.contentEl2.scrollIntoView({ behavior: "smooth", block: "start" });
			})();
		});

		pagination.createSpan({ cls: "mediavault-pagination-info", text: `Page ${page} of ${totalPages} (${total} items)` });

		const nextBtn = pagination.createEl("button", { cls: "clickable-icon mediavault-pagination-btn" });
		setIcon(nextBtn, "chevron-right");
		nextBtn.setAttr("aria-label", "Next page");
		nextBtn.disabled = page >= totalPages;
		nextBtn.addEventListener("click", () => {
			this.query.page = page + 1;
			void (async () => {
				await this.refresh();
				this.contentEl2.scrollIntoView({ behavior: "smooth", block: "start" });
			})();
		});
	}
}