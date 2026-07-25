import { normalizePath, Notice, Plugin, WorkspaceLeaf } from "obsidian";
import { MediaVaultSettings } from "./settings/settings";
import { MediaVaultSettingTab } from "./settings/settings-tab";
import { PLUGIN_NAME, RIBBON_ICON, VIEW_TYPE_LIBRARY, VIEW_TYPE_ANALYTICS, VIEW_TYPE_LISTS, VIEW_TYPE_WATCH_NEXT, VIEW_TYPE_EXPLORE } from "./constants";
import { StorageService } from "./services/storage";
import { StatisticsService } from "./services/statistics-service";
import { TMDBService } from "./api/tmdb";
import { AddMediaModal } from "./ui/modals/add-media-modal";
import { LibraryView } from "./ui/views/library-view";
import { AnalyticsView } from "./ui/views/analytics-view";
import { ListsView } from "./ui/views/lists-view";
import { WatchNextView } from "./ui/views/watch-next-view";
import { ExploreView } from "./ui/views/explore-view";
import { SelectMediaModal } from "./ui/modals/select-media-modal";
import { WatchSessionModal } from "./ui/modals/watch-session-modal";
import { MediaDetailModal } from "./ui/modals/media-detail-modal";
import { ImportModal } from "./ui/modals/import-modal";
import { TraktService } from "./api/trakt";
import { ensureValidTraktToken } from "./services/trakt-token";
import { pullFromTrakt, pushToTrakt } from "./services/trakt-sync";
import { generateTraktHistoryNote } from "./services/trakt-note-generator";
import { generateMediaNote } from "./services/note-generator/media-note-generator";
import { AnalyticsSummaryModal } from "./ui/modals/analytics-summary-modal";
import { ComfortFinderModal } from "./ui/modals/comfort-finder-modal";
import { seedBuiltInPresets } from "./services/comfort/seed-presets";
import { RecommendationsModal } from "./ui/modals/recommendations-modal";
import { NotificationHistoryModal } from "./ui/modals/notification-history-modal";
import { runNotificationCheck, shouldRunDailyCheck } from "./services/notification-service";
import type { MediaItem } from "./models/media";
import type { Episode } from "./models/episode";
import { MediaType } from "./types/enums";
import JSZip from "jszip";
import { promises as fs } from "fs";
import path from "path";


export default class MediaVaultPlugin extends Plugin {
	storage!: StorageService;
	tmdb!: TMDBService;
	trakt!: TraktService;
	statistics!: StatisticsService;
	private syncIntervalHandle: number | null = null;
	private notificationCheckIntervalHandle: number | null = null;
	private readonly TEST_DATA_VERSION = "test-v3";


	async installTestData() {
		const url =
			"https://github.com/ruveydayilmaz/mediavault-test/releases/latest/download/storage.zip";

		const response = await fetch(url);

		if (!response.ok) {
			throw new Error("Failed downloading test data");
		}

		const zipBuffer = await response.arrayBuffer();
		const zip = await JSZip.loadAsync(zipBuffer);

		const pluginDir = this.manifest.dir;

		if (!pluginDir) {
			throw new Error("Plugin directory unavailable");
		}

		for (const [filename, file] of Object.entries(zip.files)) {
			if (file.dir) continue;

			const content = await file.async("string");

			const destination = path.join(pluginDir, filename);

			await fs.mkdir(path.dirname(destination), {
				recursive: true,
			});

			await fs.writeFile(
				destination,
				content,
				"utf8"
			);
		}

		await fs.writeFile(
			path.join(pluginDir, "storage/version.txt"),
			this.TEST_DATA_VERSION,
			"utf8"
		);
	}

	async loadTestData() {
		const path =
			`${this.manifest.dir}/storage/test-data.json`;

		const raw =
			await this.app.vault.adapter.read(path);

		return JSON.parse(raw);
	}

	async onload() {
		console.log(`Loading ${PLUGIN_NAME}`);

		const versionPath = path.join(
			this.manifest.dir!,
			"storage/version.txt"
		);

		let needsInstall = true;

		try {
			const installedVersion = await fs.readFile(
				versionPath,
				"utf8"
			);

			needsInstall =
				installedVersion.trim() !== this.TEST_DATA_VERSION;

		} catch {
			needsInstall = true;
		}

		if (needsInstall) {
			await this.installTestData();
		}

		this.storage = new StorageService(this);
		await this.storage.initialize();

		this.statistics = new StatisticsService(this.storage);
		await seedBuiltInPresets(this.storage);

		this.tmdb = new TMDBService({
			getApiKey: () => this.storage.settings.get().tmdbApiKey,
			getCacheDurationMinutes: () => this.storage.settings.get().cacheDurationMinutes,
			getShowAdultContent: () => this.storage.settings.get().showAdultContent,
		});

		this.trakt = new TraktService({
			getClientId: () => this.storage.settings.get().traktClientId,
			getClientSecret: () => this.storage.settings.get().traktClientSecret,
			getAccessToken: () => this.storage.settings.get().traktAccessToken,
		});

		this.setupTraktAutoSync();
		this.setupNotificationSchedule();

		this.registerView(VIEW_TYPE_LIBRARY, (leaf) => new LibraryView(leaf, this));
		this.registerView(VIEW_TYPE_ANALYTICS, (leaf) => new AnalyticsView(leaf, this));
		this.registerView(VIEW_TYPE_LISTS, (leaf) => new ListsView(leaf, this));
		this.registerView(VIEW_TYPE_WATCH_NEXT, (leaf) => new WatchNextView(leaf, this));
		this.registerView(VIEW_TYPE_EXPLORE, (leaf) => new ExploreView(leaf, this));

		// Ribbon icon — opens the library dashboard
		this.addRibbonIcon(RIBBON_ICON, PLUGIN_NAME, () => {
			void this.activateLibraryView();
		});

		// Command palette entries
		this.addCommand({
			id: "mediavault-add-media",
			name: "Add movie or TV show",
			callback: () => {
				this.openAddMediaModal();
			},
		});

		this.addCommand({
			id: "mediavault-open-library",
			name: "Open library",
			callback: () => {
				void this.activateLibraryView();
			},
		});

		this.addCommand({
			id: "mediavault-open-lists",
			name: "Open lists",
			callback: () => {
				void this.activateListsView();
			},
		});

		this.addCommand({
			id: "mediavault-open-watch-next",
			name: "Open Watch Next sidebar",
			callback: () => {
				void this.activateWatchNextView();
			},
		});

		this.addCommand({
			id: "mediavault-open-explore",
			name: "Open Explore",
			callback: () => {
				void this.activateExploreView();
			},
		});

		this.addCommand({
			id: "mediavault-show-notifications",
			name: "Show notifications",
			callback: () => {
				new NotificationHistoryModal(this.app, this).open();
			},
		});

		this.addCommand({
			id: "mediavault-check-notifications-now",
			name: "Check for new episodes, seasons, and releases now",
			callback: () => {
				void this.runNotificationCheckNow();
			},
		});

		this.addCommand({
			id: "mediavault-log-watch",
			name: "Log a watch (review)",
			callback: () => {
				void this.openSelectMediaThen((media) => this.openLogWatch(media));
			},
		});

		this.addCommand({
			id: "mediavault-view-review-timeline",
			name: "View review timeline",
			callback: () => {
				void this.openSelectMediaThen((media) => this.openMediaDetail(media));
			},
		});

		this.addCommand({
			id: "mediavault-track-episodes",
			name: "Track episodes",
			callback: () => {
				void this.openSelectMediaThen(
					(media) => this.openEpisodeTracker(media),
					(m) => m.type === MediaType.TVShow
				);
			},
		});

		this.addCommand({
			id: "mediavault-import-watch-history",
			name: "Import watch history (TV Time / JSON / CSV)",
			callback: () => {
				if (!this.storage.settings.get().tmdbApiKey) {
					new Notice("MediaVault: add a TMDB API key in settings before importing.");
					return;
				}
				new ImportModal(this.app, this.storage, this.tmdb, () => {
					this.refreshLibraryViews();
					this.refreshListViews();
				}).open();
			},
		});

		this.addCommand({
			id: "mediavault-recommendations",
			name: "Discover recommendations",
			callback: () => {
				if (!this.storage.settings.get().tmdbApiKey) {
					new Notice("MediaVault: add a TMDB API key in settings first.");
					return;
				}
				new RecommendationsModal(this.app, this.storage, this.tmdb).open();
			},
		});

		this.addCommand({
			id: "mediavault-comfort-finder",
			name: "Find comfort media",
			callback: () => {
				new ComfortFinderModal(this.app, this.storage, this.tmdb).open();
			},
		});

		this.addCommand({
			id: "mediavault-view-stats",
			name: "Open analytics dashboard",
			callback: () => {
				void this.activateAnalyticsView();
			},
		});

		this.addCommand({
			id: "mediavault-view-stats-quick",
			name: "Quick stats summary",
			callback: () => {
				new AnalyticsSummaryModal(this.app, this.storage).open();
			},
		});

		this.addCommand({
			id: "mediavault-regenerate-all-notes",
			name: "Regenerate all media notes",
			callback: () => {
				void this.regenerateAllNotes();
			},
		});

		this.addCommand({
			id: "mediavault-trakt-sync-now",
			name: "Sync with Trakt now",
			callback: () => {
				void this.runTraktSync();
			},
		});

		this.addCommand({
			id: "mediavault-trakt-regenerate-note",
			name: "Regenerate Trakt Rating History note",
			callback: async () => {
				await generateTraktHistoryNote(this.app, this.storage, this.storage.settings.get().traktHistoryNotePath);
				new Notice("MediaVault: Trakt Rating History note regenerated.");
			},
		});

		// Command palette entry to sanity-check the TMDB connection
		this.addCommand({
			id: "mediavault-test-tmdb-connection",
			name: "Test TMDB connection",
			callback: async () => {
				if (!this.storage.settings.get().tmdbApiKey) {
					new Notice("MediaVault: add a TMDB API key in settings first.");
					return;
				}
				try {
					const result = await this.tmdb.searchMovies("Interstellar");
					new Notice(`MediaVault: TMDB OK — found ${result.total} results for "Interstellar".`);
				} catch (err) {
					new Notice(`MediaVault: TMDB request failed — ${(err as Error).message}`);
				}
			},
		});

		// Settings tab
		this.addSettingTab(new MediaVaultSettingTab(this.app, this));
	}

	private openAddMediaModal(): void {
		if (!this.storage.settings.get().tmdbApiKey) {
			new Notice("MediaVault: add a TMDB API key in settings before searching.");
			return;
		}
		new AddMediaModal(this.app, this.tmdb, this.storage, (media) => {
			this.refreshLibraryViews();
			if (this.storage.settings.get().autoCreateNotes && media) {
				void generateMediaNote(this.app, this.storage, media);
			}
		}).open();
	}

	async generateNoteFor(media: MediaItem): Promise<void> {
		try {
			const path = await generateMediaNote(this.app, this.storage, media);
			new Notice(`MediaVault: note updated — ${path}`);
		} catch (err) {
			new Notice(`MediaVault: failed to generate note — ${(err as Error).message}`);
		}
	}

	async regenerateAllNotes(): Promise<void> {
		const all = await this.storage.media.getAll();
		new Notice(`MediaVault: regenerating ${all.length} note(s)...`);
		let count = 0;
		for (const media of all) {
			try {
				await generateMediaNote(this.app, this.storage, media);
				count++;
			} catch (err) {
				console.warn(`MediaVault: failed to generate note for "${media.title}"`, err);
			}
		}
		new Notice(`MediaVault: regenerated ${count}/${all.length} note(s).`);
	}

	private async openSelectMediaThen(
		callback: (media: MediaItem) => void,
		filter?: (media: MediaItem) => boolean
	): Promise<void> {
		const all = await this.storage.media.getAll();
		const candidates = filter ? all.filter(filter) : all;
		if (candidates.length === 0) {
			new Notice(
				filter
					? "MediaVault: no matching TV shows in your library yet."
					: "MediaVault: your library is empty — add something first."
			);
			return;
		}
		new SelectMediaModal(this.app, candidates, callback).open();
	}

	openLogWatch(media: MediaItem): void {
		new WatchSessionModal(this.app, this.storage, {
			mediaId: media.id,
			mediaTitle: media.title,
			onSaved: () => {
				this.refreshLibraryViews();
				this.refreshListViews();
			},
		}).open();
	}

	openMediaDetail(media: MediaItem, episode?: Episode): void {
		new MediaDetailModal(
			this.app,
			this.storage,
			this.tmdb,
			media,
			() => {
				this.refreshLibraryViews();
				this.refreshListViews();
			},
			this,
			"episodes",
			this.trakt,
			episode
		).open();
	}

	openEpisodeTracker(media: MediaItem): void {
		new MediaDetailModal(
			this.app,
			this.storage,
			this.tmdb,
			media,
			() => {
				this.refreshLibraryViews();
				this.refreshListViews();
			},
			this,
			"episodes",
			this.trakt
		).open();
	}

	/**
	 * `skipWatchNext` lets Watch Next (roadmap Milestone 6: Watch Next
	 * Animations) drive its own DOM update with a slide/fade transition
	 * after marking an episode watched, instead of this call's normal
	 * full-rebuild `view.refresh()` wiping out the in-progress animation.
	 */
	refreshLibraryViews(options?: { skipWatchNext?: boolean }): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_LIBRARY).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof LibraryView) {
				void view.refresh();
			}
		});
		this.app.workspace.getLeavesOfType(VIEW_TYPE_ANALYTICS).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof AnalyticsView) {
				void view.refresh();
			}
		});
		if (!options?.skipWatchNext) {
			this.app.workspace.getLeavesOfType(VIEW_TYPE_WATCH_NEXT).forEach((leaf) => {
				const view = leaf.view;
				if (view instanceof WatchNextView) {
					void view.refresh();
				}
			});
		}
	}

	refreshListViews(): void {
		this.app.workspace.getLeavesOfType(VIEW_TYPE_LISTS).forEach((leaf) => {
			const view = leaf.view;
			if (view instanceof ListsView) {
				void view.refresh();
			}
		});
	}

	async activateAnalyticsView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_ANALYTICS);

		if (existing.length > 0) {
			leaf = existing[0];
			const view = leaf.view;
			if (view instanceof AnalyticsView) void view.refresh();
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_ANALYTICS, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async activateLibraryView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LIBRARY);

		if (existing.length > 0) {
			leaf = existing[0];
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_LIBRARY, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async activateListsView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_LISTS);

		if (existing.length > 0) {
			leaf = existing[0];
			const view = leaf.view;
			if (view instanceof ListsView) void view.refresh();
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_LISTS, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async activateWatchNextView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_WATCH_NEXT);

		if (existing.length > 0) {
			leaf = existing[0];
			const view = leaf.view;
			if (view instanceof WatchNextView) void view.refresh();
		} else {
			// Lives in the right sidebar, unlike the tab-based Library/Lists/Analytics views —
			// it's meant to sit alongside whatever else is open, TV-Time-style.
			leaf = workspace.getRightLeaf(false);
			if (leaf) await leaf.setViewState({ type: VIEW_TYPE_WATCH_NEXT, active: true });
		}

		if (leaf) workspace.revealLeaf(leaf);
	}

	async activateExploreView(): Promise<void> {
		const { workspace } = this.app;

		let leaf: WorkspaceLeaf | null = null;
		const existing = workspace.getLeavesOfType(VIEW_TYPE_EXPLORE);

		if (existing.length > 0) {
			leaf = existing[0];
			const view = leaf.view;
			if (view instanceof ExploreView) void view.refresh();
		} else {
			leaf = workspace.getLeaf("tab");
			await leaf.setViewState({ type: VIEW_TYPE_EXPLORE, active: true });
		}

		workspace.revealLeaf(leaf);
	}

	async runTraktSync(): Promise<void> {
		const settings = this.storage.settings.get();
		if (!settings.traktClientId || !settings.traktAccessToken) {
			new Notice("MediaVault: connect your Trakt account in settings first.");
			return;
		}

		new Notice("MediaVault: syncing with Trakt...");
		try {
			const token = await ensureValidTraktToken(this.storage);
			if (!token) {
				new Notice("MediaVault: Trakt connection is no longer valid — reconnect in settings.");
				return;
			}

			const pullResult = await pullFromTrakt(this.storage, this.tmdb, this.trakt);
			const pushResult = await pushToTrakt(this.storage, this.trakt);

			await generateTraktHistoryNote(this.app, this.storage, this.storage.settings.get().traktHistoryNotePath);

			this.refreshLibraryViews();

			const errorCount = pullResult.errors.length + pushResult.errors.length;
			new Notice(
				`MediaVault: Trakt sync complete — pulled ${pullResult.moviesAdded} movie(s) + ${pullResult.episodesMarked} episode(s), pushed ${pushResult.pushed}` +
				(errorCount > 0 ? ` · ${errorCount} error(s), see console` : ".")
			);
			if (errorCount > 0) {
				console.warn("MediaVault Trakt sync errors:", [...pullResult.errors, ...pushResult.errors]);
			}
		} catch (err) {
			new Notice(`MediaVault: Trakt sync failed — ${(err as Error).message}`);
		}
	}

	private setupTraktAutoSync(): void {
		const settings = this.storage.settings.get();
		if (!settings.traktAccessToken) return;

		if (settings.traktAutoSync === "on_startup") {
			// Defer slightly so it doesn't compete with initial layout/render.
			setTimeout(() => void this.runTraktSync(), 3000);
		} else if (settings.traktAutoSync === "interval") {
			const ms = Math.max(5, settings.traktSyncIntervalMinutes) * 60 * 1000;
			this.syncIntervalHandle = window.setInterval(() => void this.runTraktSync(), ms);
			this.registerInterval(this.syncIntervalHandle);
		}
	}

	/**
	 * Checks once an hour whether today's daily notification check is due
	 * yet (per the configured notification time) and hasn't already run —
	 * cheap enough to poll hourly, and means the check fires close to the
	 * configured time even though Obsidian gives plugins no true cron.
	 */
	private setupNotificationSchedule(): void {
		const tryRun = () => {
			if (shouldRunDailyCheck(this.storage.settings.get())) {
				void this.runNotificationCheckNow();
			}
		};

		// Give initial layout a moment, then run the first check (covers "Obsidian wasn't open at the scheduled time").
		setTimeout(tryRun, 5000);

		this.notificationCheckIntervalHandle = window.setInterval(tryRun, 60 * 60 * 1000);
		this.registerInterval(this.notificationCheckIntervalHandle);
	}

	async runNotificationCheckNow(): Promise<void> {
		if (!this.storage.settings.get().tmdbApiKey) return;

		const settings = this.storage.settings.get();
		let fired: Awaited<ReturnType<typeof runNotificationCheck>> = [];
		try {
			fired = await runNotificationCheck(this.storage, this.tmdb, settings);
		} catch (err) {
			console.error("MediaVault: notification check failed", err);
		}

		await this.storage.settings.update({ notificationLastCheckedDate: new Date().toISOString().slice(0, 10) });

		if (!settings.notificationSilent) {
			fired.forEach((n) => new Notice(`MediaVault: ${n.message}`));
		}
		if (fired.length > 0) {
			this.refreshLibraryViews();
		}
	}

	async onunload() {
		console.log(`Unloading ${PLUGIN_NAME}`);
		// Ensure any debounced writes land before Obsidian tears the plugin down.
		await this.storage.flush();
	}

	/** Updates settings and persists them. Kept for backwards-compatible call sites. */
	async saveSettings(patch?: Partial<MediaVaultSettings>): Promise<void> {
		if (patch) {
			await this.storage.settings.update(patch);
			if ("tmdbApiKey" in patch) {
				// API key changed — old cached responses are no longer relevant.
				this.tmdb.clearCache();
			}
		} else {
			await this.storage.flush();
		}
	}
}



