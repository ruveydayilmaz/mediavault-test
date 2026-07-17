import { ItemView, WorkspaceLeaf } from "obsidian";
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
import { renderPoster, statusLabel, formatRuntime, formatRating } from "../components/media-render";
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
import { MediaType } from "types/enums";
import { StorageService } from "services/storage";

type ViewMode = "grid" | "list" | "table";

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
	private customListsEl!: HTMLElement;

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

		await this.refresh();
	}

	async onClose(): Promise<void> {
		// Nothing to tear down yet — repositories are owned by the plugin, not the view.
	}

	/** Call after any mutation (add/remove media, log a watch, import, Trakt sync, etc.) elsewhere in the plugin to keep this view in sync. */
	async refresh(): Promise<void> {
		const all = await this.plugin.storage.media.getAll();
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
				// TODO
				// Open your library filtered to favorites.
			},
			(item) => this.openDetail(item)
		);
	}

	private async refreshCustomLists(all: MediaItem[]): Promise<void> {
		this.customListsEl.empty();

		const lists = await this.plugin.storage.customLists.getAll();

		await renderCustomListsCarousel(
			this.customListsEl,
			all,
			lists,
			(list) => {
				new ListDetailModal(
					this.app,
					this.plugin,
					list,
					() => void this.refresh()
				).open();
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
		this.filterToggleBtn.setText(active ? "Filters ●" : "Filters");
		this.filterToggleBtn.toggleClass("is-active", active);

		this.filtersEl.empty();
		if (!this.filterPanelOpen) return;

		const options = collectFilterOptions(all);
		const panel = this.filtersEl.createDiv({ cls: "mediavault-filter-panel" });

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

		// Advanced filters toggle (Milestone 4 — Universal Filtering)
		this.filterToggleBtn = toolbar.createEl("button", { cls: "mediavault-filters-toggle" });
		this.filterToggleBtn.addEventListener("click", () => {
			this.filterPanelOpen = !this.filterPanelOpen;
			void this.refresh();
		});

		// Sort dropdown + direction toggle
		const sortSelect = toolbar.createEl("select", { cls: "mediavault-library-sort" });
		SORT_OPTIONS.forEach((opt) => {
			sortSelect.createEl("option", { value: opt.value, text: `Sort: ${opt.label}` });
		});
		sortSelect.value = this.query.sortField;
		sortSelect.addEventListener("change", () => {
			this.query.sortField = sortSelect.value as LibrarySortField;
			void this.plugin.storage.settings.update({ defaultSort: this.query.sortField });
			void this.refresh();
		});

		const dirBtn = toolbar.createEl("button", {
			cls: "mediavault-library-sort-dir",
			text: this.query.sortDirection === "asc" ? "↑" : "↓",
		});
		dirBtn.addEventListener("click", () => {
			this.query.sortDirection = this.query.sortDirection === "asc" ? "desc" : "asc";
			dirBtn.setText(this.query.sortDirection === "asc" ? "↑" : "↓");
			void this.plugin.storage.settings.update({ defaultSortDirection: this.query.sortDirection });
			void this.refresh();
		});

		// Page size — larger sizes rely on virtualized rendering (list view) to stay fast.
		const pageSizeSelect = toolbar.createEl("select", { cls: "mediavault-library-page-size" });
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

		// View mode toggle
		const viewToggle = toolbar.createDiv({ cls: "mediavault-library-view-toggle" });
		(["grid", "list", "table"] as ViewMode[]).forEach((mode) => {
			const btn = viewToggle.createEl("button", {
				text: mode[0].toUpperCase() + mode.slice(1),
				cls: mode === this.viewMode ? "is-active" : "",
			});
			btn.addEventListener("click", () => {
				this.viewMode = mode;
				viewToggle.querySelectorAll("button").forEach((b) => b.removeClass("is-active"));
				btn.addClass("is-active");
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
		items.forEach(async (item) => {
			const card = grid.createDiv({ cls: "mediavault-card" });
			card.addEventListener("click", () => this.openDetail(item));
			const poster = card.createDiv({ cls: "mediavault-card-poster" });
			renderPoster(poster, item, "w200");

			const percentWatched =
				item.type === MediaType.TVShow
					? await this.getShowPercentWatched(this.plugin.storage, item.id)
					: null;

			if (percentWatched !== null) {
				const progress = poster.createDiv({
					cls: "mediavault-card-progress",
				});

				progress.createDiv({
					cls: "mediavault-favorite-progress-fill",
					attr: {
						style: `width:${Math.round(percentWatched)}%`,
					},
				});
			}
		});
	}

	private async getShowPercentWatched(
		storage: StorageService,
		mediaId: MediaItem["id"]
	): Promise<number | null> {
		const episodes = await storage.episodes.findByMediaId(mediaId);

		if (!episodes.length) return null;

		const progress = await storage.episodeProgress.getShowProgress(
			mediaId,
			episodes
		);

		return progress.percentWatched;
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
		["Title", "Year", "Type", "Status", "Rating", "Watch Count", "Runtime"].forEach((h) => {
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

		const prevBtn = pagination.createEl("button", { text: "← Prev" });
		prevBtn.disabled = page <= 1;
		prevBtn.addEventListener("click", () => {
			this.query.page = page - 1;
			void this.refresh();
		});

		pagination.createSpan({ text: ` Page ${page} of ${totalPages} (${total} items) ` });

		const nextBtn = pagination.createEl("button", { text: "Next →" });
		nextBtn.disabled = page >= totalPages;
		nextBtn.addEventListener("click", () => {
			this.query.page = page + 1;
			void this.refresh();
		});
	}
}
