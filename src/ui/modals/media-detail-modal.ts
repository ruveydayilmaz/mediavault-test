import { App, Modal, Notice, Menu, setIcon } from "obsidian";
import { renderMobileBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import type { TraktService, TraktComment, TraktCommentTarget } from "../../api/trakt";
import { describeTraktError } from "../../api/trakt";
import { ensureValidTraktToken } from "../../services/trakt-token";
import type MediaVaultPlugin from "../../main";
import { MediaItem } from "../../models/media";
import { MediaType, MediaStatus } from "../../types/enums";
import { RatingEvolutionPoint, WatchSession } from "../../models/review";
import { Episode, EpisodeProgress, EpisodeWatch } from "../../models/episode";
import { sortSessionsChronological, getRatingEvolution } from "../../services/review-logic";
import { deleteWatchSession } from "../../services/watch-session-service";
import { deleteMedia, describeDeletionScope } from "../../services/media-delete-service";
import { markEpisodeWatched, markSeasonWatched, findUnwatchedPrecedingEpisodes } from "../../services/episode-status-sync";
import {
	addEpisodeWatch,
	updateEpisodeWatch,
	deleteEpisodeWatch,
	sortEpisodeWatchesChronological,
} from "../../services/episode-watch-service";
import { filterAndSortCommentsByLanguage } from "../../services/comment-localization";
import { importEpisodesForShow, needsEpisodeSync } from "../../services/episode-import";
import { renderRatingEvolutionChart } from "../components/rating-chart";
import { statusLabel, formatRating, progressFillClasses } from "../components/media-render";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { WatchSessionModal } from "./watch-session-modal";
import { generateMediaNote } from "../../services/note-generator/media-note-generator";
import { ComfortProfileModal } from "./comfort-profile-modal";
import { AddToListModal } from "./add-to-list-modal";
import { ImagePickerModal } from "./image-picker-modal";
import { MoviePartialWatchModal } from "./movie-progress-modal";
import { completeMovieFromProgress, resumeMovie } from "../../services/movie-progress-service";
import { ActorDetailsModal } from "./actor-details-modal";
import { addMediaFromTMDB } from "../../services/media-import";
import { resumeSeries } from "../../services/drop-series-service";
import { DropSeriesModal } from "./drop-series-modal";
import { addDestructiveMenuItem } from "../components/destructive-menu-item";

type DetailTab = "history" | "episodes" | "comments" | "cast" | "episode-detail";

function formatEpisodeRuntime(minutes: number | null): string {
	if (!minutes) return "—";
	return `${minutes}m`;
}

/**
 * The media detail page: header (poster, actions) plus a tab bar for TV
 * shows switching between "Watch History" and "Episodes" (Milestone 4 —
 * this replaces the standalone EpisodeTrackerModal entirely; episode
 * tracking now lives here instead of behind a separate modal). Movies have
 * no Episodes tab and just show the Watch History content directly.
 *
 * Only the active tab's content is ever built — switching tabs re-renders
 * from scratch rather than toggling visibility, so there's never any
 * off-screen, still-mounted content from the inactive tab.
 */
export class MediaDetailModal extends Modal {
	private storage: StorageService;
	private tmdb: TMDBService;
	private trakt?: TraktService;
	private media: MediaItem;
	private onChanged?: () => void;
	/**
	 * Optional — when provided, a successful delete triggers a full
	 * cross-view refresh (statistics, Watch Next, favorites, filters,
	 * dashboard) via the plugin's refresh helpers, in addition to
	 * `onChanged`. Callers that don't care about deletion (e.g. the
	 * read-only preview from Recommendations/Comfort Finder) can omit it —
	 * the Delete action simply won't be offered there.
	 */
	private plugin?: MediaVaultPlugin;

	/**
	 * Preview mode (Milestone 2: Filmography Preview Instead of
	 * Auto-Import) — `this.media` is a synthetic, unpersisted `MediaItem`
	 * built straight from TMDB data, so the modal can be opened for browsing
	 * (overview, cast, comments) without ever writing anything to storage.
	 * Favoriting, logging watches, episode import, and the delete menu are
	 * all gated off in this mode; the header instead shows an "Add to
	 * Library" action. Pressing it swaps `this.media` for the real,
	 * persisted item and flips `isPreview` off in place — the same modal
	 * instance just starts behaving normally, per spec ("Import should
	 * preserve the current Details modal").
	 */
	private isPreview: boolean;
	/** TMDB's own public rating, shown only in preview mode since there's no local averageRating yet. */
	private previewTmdbRating: number | null = null;
	/** Set right before a re-render triggered by posting a comment, so the new comment gets a brief highlight once rendered (Milestone 1: Trakt Public Comments). */
	private pendingHighlightCommentId: number | null = null;

	private activeTab: DetailTab = "episodes"; // default for TV shows; movies have no Episodes tab so this is never used
	/** Which season numbers are expanded in the Episodes tab's accordion — kept across re-renders within the same modal session. */
	private expandedSeasons = new Set<number>();
	/** Whether the long-description "Show more" toggle is expanded — kept across re-renders within the same modal session. */
	private descriptionExpanded = false;
	/** The episode currently shown by the "episode-detail" tab (Milestone 4: Comments Integration). */
	private selectedEpisode: Episode | null = null;
	/** Tab to return to when the user backs out of Episode Details — always "episodes" in practice, but kept explicit rather than assumed. */
	private tabBeforeEpisodeDetail: DetailTab = "episodes";

	constructor(
		app: App,
		storage: StorageService,
		tmdb: TMDBService,
		media: MediaItem,
		onChanged?: () => void,
		plugin?: MediaVaultPlugin,
		initialTab: DetailTab = "episodes",
		trakt?: TraktService,
		initialEpisode?: Episode,
		isPreview = false,
		previewTmdbRating: number | null = null
	) {
		super(app);
		this.storage = storage;
		this.tmdb = tmdb;
		this.trakt = trakt;
		this.media = media;
		this.onChanged = onChanged;
		this.plugin = plugin;
		this.isPreview = isPreview;
		this.previewTmdbRating = previewTmdbRating;
		if (media.type === MediaType.TVShow && initialEpisode) {
			this.selectedEpisode = initialEpisode;
			this.activeTab = "episode-detail";
		} else if (media.type === MediaType.TVShow) {
			this.activeTab = isPreview ? "cast" : initialTab;
		} else {
			this.activeTab =
				initialTab === "episodes" || initialTab === "episode-detail" ? (isPreview ? "cast" : "history") : initialTab;
		}
	}

	onOpen(): void {
		this.modalEl.addClass("mediavault-detail-modal");
		void this.initialize();
	}

	private async initialize(): Promise<void> {
		if (this.media.type === MediaType.TVShow && !this.isPreview) {
			await this.maybeAutoSyncEpisodes();
		}
		await this.render();
	}

	/**
	 * Milestone 9 (Automatic TMDB Episode Synchronization): runs on every
	 * open of a TV show's details, before the first render, so newly-added
	 * shows get their episodes imported without the user ever pressing
	 * "Import episodes from TMDB" manually, and actively-watched shows stay
	 * fresh without needing "Refresh from TMDB" either. Silent by design —
	 * a background sync check shouldn't interrupt opening the modal with
	 * an error notice if TMDB is briefly unreachable; the manual refresh
	 * options (Episodes tab button, three-dot menu) remain for that case.
	 */
	private async maybeAutoSyncEpisodes(): Promise<void> {
		const episodes = await this.storage.episodes.findByMediaId(this.media.id);
		const intervalHours = this.storage.settings.get().episodeSyncIntervalHours;

		if (!needsEpisodeSync(this.media, episodes.length > 0, intervalHours)) return;

		try {
			await importEpisodesForShow(this.storage, this.tmdb, this.media);
			const refreshed = await this.storage.media.findById(this.media.id);
			if (refreshed) this.media = refreshed;
			this.onChanged?.();
		} catch {
			// Swallowed intentionally — see docblock above.
		}
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-detail-modal");
		renderMobileBackButton(this, contentEl);

		// Re-fetch the media item in case aggregates changed since opening.
		const fresh = await this.storage.media.findById(this.media.id);
		if (fresh) this.media = fresh;

		if (this.activeTab === "episode-detail" && this.selectedEpisode) {
			await this.renderEpisodeDetailTab(contentEl, this.selectedEpisode);
			return;
		}

		await this.renderHeader(contentEl);

		this.renderTabBar(contentEl);

		if (this.activeTab === "episodes" && this.media.type === MediaType.TVShow) {
			await this.renderEpisodesTab(contentEl);
		} else if (this.activeTab === "comments") {
			await this.renderCommentsTab(contentEl);
		} else if (this.activeTab === "cast") {
			await this.renderCastTab(contentEl);
		} else {
			await this.renderWatchHistoryTab(contentEl);
		}
	}

	private async renderHeader(contentEl: HTMLElement): Promise<void> {
		await this.renderHero(contentEl);

		const body = contentEl.createDiv({ cls: "mediavault-detail-body" });

		const detail = body.createDiv({ cls: "mediavault-detail-status", text: statusLabel(this.media.status) });

		if (this.isPreview) {
			if (this.previewTmdbRating !== null) {
				detail.createDiv({
					cls: "mediavault-detail-rating",
					text: `★ ${formatRating(this.previewTmdbRating)} on TMDB`,
				});
			}
		} else if (this.media.averageRating !== null) {
			detail.createDiv({
				cls: "mediavault-detail-rating",
				text: `★ ${formatRating(this.media.averageRating)} average across ${this.media.watchCount} watch${this.media.watchCount === 1 ? "" : "es"}`,
			});
		}
		if (this.media.synopsis) {
			this.renderDescription(body, this.media.synopsis);
		}
	}

	private async renderHero(contentEl: HTMLElement): Promise<void> {
		const hero = contentEl.createDiv({ cls: "mediavault-detail-hero" });

		const bannerUrl = tmdbImageUrl(this.media.backdropPath ?? this.media.posterPath, "original");
		if (bannerUrl) {
			hero.createEl("img", { cls: "mediavault-detail-banner-img", attr: { src: bannerUrl, alt: "" } });
		}
		hero.createDiv({ cls: "mediavault-detail-banner-overlay" });

		// Rendered as a sibling of the hero (not a child) so it isn't inside the
		// hero's `transform` — a transform on an ancestor creates a new
		// containing block for position:fixed descendants, which would make
		// this button track the hero's (sticky, moving) box instead of the
		// viewport. This is the same positioning strategy as the back button.
		const menuBtn = contentEl.createEl("button", { cls: "clickable-icon mediavault-detail-menu-btn" });
		setIcon(menuBtn, "more-vertical");
		menuBtn.setAttr("aria-label", "More options");
		if (this.isPreview) {
			menuBtn.style.display = "none";
		} else {
			menuBtn.addEventListener("click", (evt) => this.openHeroMenu(evt));
		}

		const heroContent = hero.createDiv({ cls: "mediavault-detail-hero-content" });
		const left = heroContent.createDiv({ cls: "mediavault-detail-hero-main" });
		const titleRow = left.createDiv({ cls: "mediavault-detail-title-row" });

		titleRow.createEl("h2", { text: this.media.title });
		if (!this.isPreview) {
			const favBtn = titleRow.createEl("button", {
				cls: `clickable-icon mediavault-fav-btn ${this.media.isFavorite ? "is-favorite" : ""}`,
				text: this.media.isFavorite ? "★" : "☆",
			});
			favBtn.setAttr("aria-label", "Toggle favorite");
			favBtn.addEventListener("click", async (evt) => {
				evt.stopPropagation();
				const updated = await this.storage.media.update(this.media.id, { isFavorite: !this.media.isFavorite });
				if (updated) this.media = updated;
				this.onChanged?.();
				await this.render();
			});
		}
		left.createDiv({
			cls: "mediavault-detail-meta",
			text: [this.media.year, this.media.genres.join(", ")].filter(Boolean).join(" · "),
		});

		if (this.isPreview) {
			await this.renderAddToLibraryAction(heroContent);
		} else if (MediaType.Movie === this.media.type) {
			const logBtn = heroContent.createEl("button", {
				cls: "mediavault-detail-log-btn mod-cta",
				attr: {
					"aria-label": "Log watch",
				},
			});
			setIcon(logBtn, "plus-circle");

			logBtn.addEventListener("click", () => {
				new WatchSessionModal(this.app, this.storage, {
					mediaId: this.media.id,
					mediaTitle: this.media.title,
					onSaved: () => void this.refreshAndNotify(),
				}).open();
			});
		}

		if (this.isPreview) return;

		if (this.media.type === MediaType.TVShow) {
			const episodes = await this.storage.episodes.findByMediaId(this.media.id);
			const progress = await this.storage.episodeProgress.getShowProgress(this.media.id, episodes);
			this.renderProgressBar(hero, progress.percentWatched, true);
		} else {
			await this.renderMoviePartialProgress(hero);
		}
	}

	private async renderAddToLibraryAction(heroContent: HTMLElement): Promise<void> {
		const mediaType = this.media.type;
		const existing = await this.storage.media.findByTmdbId(this.media.tmdbId, mediaType);

		if (existing) {
			const inLibraryBtn = heroContent.createEl("button", {
				cls: "mediavault-add-to-library-btn mediavault-in-library-btn",
				text: "✓ In Library",
			});
			inLibraryBtn.disabled = true;
			return;
		}

		const addBtn = heroContent.createEl("button", { cls: "mediavault-add-to-library-btn mod-cta", text: "＋ Add to Library" });
		addBtn.addEventListener("click", async (evt) => {
			evt.stopPropagation();
			addBtn.disabled = true;
			addBtn.setText("Adding...");
			try {
				const mediaKind = this.media.type === MediaType.Movie ? "movie" : "tv";
				const result = await addMediaFromTMDB(this.storage, this.tmdb, this.media.tmdbId, mediaKind);
				new Notice(
					result.alreadyExisted
						? `MediaVault: "${result.mediaItem.title}" is already in your library.`
						: `MediaVault: added "${result.mediaItem.title}" to your library.`
				);
				this.media = result.mediaItem;
				this.isPreview = false;
				this.onChanged?.();
				await this.render();
			} catch (err) {
				new Notice(`MediaVault: couldn't add "${this.media.title}" — ${(err as Error).message}`);
				addBtn.disabled = false;
				addBtn.setText("＋ Add to Library");
			}
		});
	}

	private async renderMoviePartialProgress(hero: HTMLElement): Promise<void> {
		const progress = await this.storage.movieProgress.findByMediaId(this.media.id);
		if (!progress) return;

		const wrap = hero.createDiv({ cls: "mediavault-movie-progress-wrap" });
		const percent = progress.totalRuntime > 0 ? (progress.currentMinute / progress.totalRuntime) * 100 : 0;
		this.renderProgressBar(wrap, percent, true);

		const label =
			progress.totalRuntime > 0
				? `Resume from ${progress.currentMinute} min (${progress.currentMinute} / ${progress.totalRuntime} min · ${Math.round(percent)}%)`
				: `Resume from ${progress.currentMinute} min`;
		wrap.createDiv({ cls: "mediavault-detail-meta mediavault-movie-progress-label", text: label });

		const actions = wrap.createDiv({ cls: "mediavault-movie-progress-actions" });

		const updateBtn = actions.createEl("button", { text: "Update progress" });
		updateBtn.addEventListener("click", () => void this.openMoviePartialWatchModal());

		const finishBtn = actions.createEl("button", { cls: "mod-cta", text: "Mark as finished" });
		finishBtn.addEventListener("click", async () => {
			await completeMovieFromProgress(this.storage, this.media.id);
			new Notice(`MediaVault: marked "${this.media.title}" as finished.`);
			this.onChanged?.();
			await this.refreshAndNotify();
		});
	}

	private async openMoviePartialWatchModal(): Promise<void> {
		const existing = await this.storage.movieProgress.findByMediaId(this.media.id);
		new MoviePartialWatchModal(this.app, this.storage, {
			media: this.media,
			existingMinute: existing?.currentMinute ?? null,
			onSaved: () => void this.refreshAndNotify(),
		}).open();
	}

	private openHeroMenu(evt: MouseEvent, confirmingDelete = false): void {
		const menu = new Menu();

		menu.addItem((item) =>
			item
				.setTitle("Edit poster")
				.setIcon("image")
				.onClick(() => this.openImagePicker("poster"))
		);

		menu.addItem((item) =>
			item
				.setTitle("Edit banner")
				.setIcon("image")
				.onClick(() => this.openImagePicker("backdrop"))
		);

		menu.addSeparator();

		menu.addItem((item) =>
			item
				.setTitle(this.media.notePath ? "Open note" : "Generate note")
				.setIcon("file-text")
				.onClick(async () => {
					const path = await generateMediaNote(this.app, this.storage, this.media);
					const file = this.app.vault.getAbstractFileByPath(path);
					if (file) {
						await this.app.workspace.getLeaf(false).openFile(file as any);
					}
					this.onChanged?.();
				})
		);

		menu.addItem((item) =>
			item
				.setTitle("Comfort profile")
				.setIcon("heart")
				.onClick(() => {
					new ComfortProfileModal(
						this.app,
						this.storage,
						this.media,
						() => this.onChanged?.()
					).open();
				})
		);

		menu.addItem((item) =>
			item
				.setTitle("Add to list")
				.setIcon("list-plus")
				.onClick(() => {
					new AddToListModal(
						this.app,
						this.storage,
						this.media,
						() => this.onChanged?.()
					).open();
				})
		);

		if (this.plugin) {
			menu.addSeparator();

			addDestructiveMenuItem(menu, evt, {
				label: "Delete",
				confirming: confirmingDelete,
				rebuild: (_m, confirming) => this.openHeroMenu(evt, confirming),
				onConfirm: () => void this.confirmAndDelete(true),
			});
		}

		if (this.media.type === MediaType.Movie) {
			menu.addSeparator();

			menu.addItem((item) =>
				item
					.setTitle("Mark as partially watched")
					.setIcon("timer")
					.onClick(() => void this.openMoviePartialWatchModal())
			);

			if (this.media.status === MediaStatus.Dropped) {
				menu.addItem((item) =>
					item
						.setTitle("Resume Watching")
						.setIcon("play")
						.onClick(async () => {
							await resumeMovie(this.storage, this.media.id);
							this.onChanged?.();
							await this.refreshAndNotify();
						})
				);
			}
		}

		if (this.media.type === MediaType.TVShow) {
			menu.addSeparator();

			menu.addItem((item) =>
				item
					.setTitle("Refresh episodes from TMDB")
					.setIcon("refresh-cw")
					.onClick(() => void this.runEpisodeImport())
			);

			if (this.media.status === MediaStatus.Dropped) {
				menu.addItem((item) =>
					item
						.setTitle("Resume Watching")
						.setIcon("play")
						.onClick(async () => {
							await resumeSeries(this.storage, this.media.id);
							this.onChanged?.();
							await this.refreshAndNotify();
						})
				);
			} else {
				menu.addItem((item) =>
					item
						.setTitle("Mark as Dropped")
						.setIcon("x-circle")
						.onClick(() => {
							new DropSeriesModal(this.app, this.storage, {
								mediaId: this.media.id,
								mediaTitle: this.media.title,
								onDropped: () => {
									this.onChanged?.();
									void this.refreshAndNotify();
								},
							}).open();
						})
				);
			}
		}

		menu.showAtMouseEvent(evt);
	}

	private openImagePicker(imageKind: "poster" | "backdrop"): void {
		const mediaKind = this.media.type === MediaType.Movie ? "movie" : "tv";
		new ImagePickerModal(
			this.app,
			this.tmdb,
			this.media.tmdbId,
			mediaKind,
			imageKind,
			imageKind === "poster" ? this.media.posterPath : this.media.backdropPath,
			async (filePath) => {
				const patch = imageKind === "poster" ? { posterPath: filePath } : { backdropPath: filePath };
				const updated = await this.storage.media.update(this.media.id, patch);
				if (updated) this.media = updated;
				this.onChanged?.();
				await this.render();
			}
		).open();
	}

	/**
	 * Long synopses render truncated with a "Show more" toggle; short ones
	 * render in full with no toggle at all. `descriptionExpanded` persists
	 * across re-renders in this modal session so an unrelated action (e.g.
	 * favoriting) doesn't silently re-collapse an expanded description.
	 */
	private renderDescription(container: HTMLElement, synopsis: string): void {
		const SHORT_LENGTH = 220;

		const wrapper = container.createDiv({ cls: "mediavault-detail-description" });

		const textEl = wrapper.createEl("p", {
			cls: "mediavault-detail-synopsis",
		});

		const needsToggle = synopsis.length > SHORT_LENGTH;
		const text =
			needsToggle && !this.descriptionExpanded
				? synopsis.slice(0, SHORT_LENGTH).trimEnd() + "..."
				: synopsis;

		textEl.appendText(text);

		if (!needsToggle) return;

		const toggle = textEl.createSpan({
			cls: "mediavault-detail-description-toggle",
			text: this.descriptionExpanded ? " Show less" : " Show more",
		});

		toggle.addEventListener("click", (evt) => {
			evt.stopPropagation();
			this.descriptionExpanded = !this.descriptionExpanded;
			this.render();
		});
	}

	private renderTabBar(contentEl: HTMLElement): void {
		const bar = contentEl.createDiv({ cls: "mediavault-detail-tabs" });
		const tabs: { id: DetailTab; label: string }[] =
			this.media.type === MediaType.TVShow
				? [
					...(this.isPreview ? [] : [{ id: "history" as DetailTab, label: "Watch History" }]),
					{ id: "episodes", label: "Episodes" },
					{ id: "cast", label: "Cast" },
					{ id: "comments", label: "Comments" },
				]
				: [
					...(this.isPreview ? [] : [{ id: "history" as DetailTab, label: "Watch History" }]),
					{ id: "cast", label: "Cast" },
					{ id: "comments", label: "Comments" },
				];

		tabs.forEach((tab) => {
			const btn = bar.createEl("button", {
				cls: `mediavault-detail-tab ${this.activeTab === tab.id ? "is-active" : ""}`,
				text: tab.label,
			});
			btn.addEventListener("click", () => {
				if (this.activeTab === tab.id) return;
				this.activeTab = tab.id;
				void this.render();
			});
		});
	}

	// ---- Watch History tab ----

	private async renderWatchHistoryTab(contentEl: HTMLElement): Promise<void> {
		if (this.media.status === MediaStatus.Dropped && this.media.droppedReason) {
			const droppedSection = contentEl.createDiv({ cls: "mediavault-detail-section mediavault-dropped-banner" });
			droppedSection.createEl("h3", { text: "Dropped" });
			droppedSection.createDiv({ cls: "mediavault-detail-meta", text: "Reason:" });
			droppedSection.createEl("p", { cls: "mediavault-dropped-reason", text: `"${this.media.droppedReason}"` });
		}

		const sessions = await this.storage.watchSessions.findWhere((s) => s.mediaId === this.media.id);

		const evolution = getRatingEvolution(sessions);
		const rated = evolution.filter((p) => p.rating !== null) as (RatingEvolutionPoint & { rating: number })[];

		if (rated.length > 1) { // TODO: fix later. this still shows the chart if there is only one rating
			const chartSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
			chartSection.createEl("h3", { text: "Rating evolution" });
			const chartContainer = chartSection.createDiv({ cls: "mediavault-chart-container" });
			renderRatingEvolutionChart(chartContainer, evolution);
		}

		const timelineSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
		timelineSection.createEl("h3", { text: `Watch history (${sessions.length})` });

		if (sessions.length === 0) {
			timelineSection.createDiv({
				cls: "mediavault-timeline-empty",
				text: "No watches logged yet. Click \"Log a watch\" to add your first review.",
			});
		} else {
			const timeline = timelineSection.createDiv({ cls: "mediavault-timeline" });
			const chronological = sortSessionsChronological(sessions).reverse(); // newest first for reading
			chronological.forEach((session) => {
				this.renderTimelineEntry(timeline, session);
			});
		}
	}

	private renderTimelineEntry(container: HTMLElement, session: WatchSession): void {
		const entry = container.createDiv({ cls: "mediavault-timeline-entry" });
		const entryInfo = entry.createDiv({ cls: "mediavault-timeline-entry-info" });

		const entryHeader = entryInfo.createDiv({ cls: "mediavault-timeline-entry-header" });
		const watchLabel =
			session.rewatchNumber === 0 ? "First watch" : `Rewatch #${session.rewatchNumber}`;
		entryHeader.createSpan({ cls: "mediavault-timeline-watch-label", text: watchLabel });
		entryHeader.createSpan({ cls: "mediavault-timeline-date", text: session.watchDate });
		if (session.rating !== null) {
			entryHeader.createSpan({ cls: "mediavault-timeline-rating", text: `★ ${session.rating.toFixed(1)}` });
		}

		if (session.mood || session.context || session.watchSource) {
			entryInfo.createDiv({
				cls: "mediavault-timeline-context",
				text: [session.mood, session.context, session.watchSource].filter(Boolean).join(" · "),
			});
		}

		if (session.review) {
			entryInfo.createEl("p", { cls: "mediavault-timeline-review", text: session.review });
		}

		const actions = entry.createDiv({ cls: "mediavault-timeline-actions" });

		const menuBtn = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(menuBtn, "more-vertical");
		menuBtn.setAttr("aria-label", "Watch entry options");

		const openEntryMenu = (evt: MouseEvent, confirmingDelete = false) => {
			evt.stopPropagation();

			const menu = new Menu();

			menu.addItem((item) =>
				item
					.setTitle("Edit")
					.setIcon("pencil")
					.onClick(() => {
						new WatchSessionModal(this.app, this.storage, {
							mediaId: this.media.id,
							mediaTitle: this.media.title,
							existingSession: session,
							onSaved: () => void this.refreshAndNotify(),
						}).open();
					})
			);

			menu.addSeparator();

			addDestructiveMenuItem(menu, evt, {
				label: "Delete",
				confirming: confirmingDelete,
				rebuild: (_m, confirming) => openEntryMenu(evt, confirming),
				onConfirm: () => {
					void (async () => {
						await deleteWatchSession(this.storage, session.id);
						new Notice("MediaVault: watch entry deleted.");
						await this.refreshAndNotify();
					})();
				},
			});

			menu.showAtMouseEvent(evt);
		};

		menuBtn.addEventListener("click", (evt) => openEntryMenu(evt));
	}

	// ---- Comments tab (Milestone 4: Comments Integration — movies only; TV comments live per-episode) ----

	private async renderCommentsTab(contentEl: HTMLElement): Promise<void> {
		const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
		const heading = section.createDiv({ cls: "mediavault-comments-heading" });
		heading.createEl("h3", { text: "Comments" });

		if (!this.trakt) {
			section.createDiv({ cls: "mediavault-modal-hint", text: "Trakt isn't available for this item." });
			return;
		}

		const target: TraktCommentTarget =
			this.media.type === MediaType.Movie ? { kind: "movie", tmdbId: this.media.tmdbId } : { kind: "show", tmdbId: this.media.tmdbId };

		const fetchComments = () =>
			this.media.type === MediaType.Movie
				? this.trakt!.getMovieComments(this.media.tmdbId)
				: this.trakt!.getShowComments(this.media.tmdbId);

		const composeToggle = heading.createDiv({ cls: "mediavault-comment-compose-toggle" });
		setIcon(composeToggle, "square-pen");
		composeToggle.setAttribute("aria-label", "Write a comment");

		const listWrap = section.createDiv();

		const composer = await this.renderCommentComposer(section, target, () => this.refreshCommentList(listWrap, target, fetchComments));
		composer?.addClass("is-collapsed");
		composeToggle.addEventListener("click", () => {
			composer?.toggleClass("is-collapsed", !composer.hasClass("is-collapsed"));
			if (composer && !composer.hasClass("is-collapsed")) {
				composer.querySelector<HTMLTextAreaElement>(".mediavault-comment-compose-input")?.focus();
			}
		});

		if (composer) section.insertBefore(composer, listWrap);

		await this.refreshCommentList(listWrap, target, fetchComments);
	}

	private async refreshCommentList(
		listWrap: HTMLElement,
		target: TraktCommentTarget,
		fetchComments: () => Promise<TraktComment[]>
	): Promise<void> {
		listWrap.empty();
		const loading = listWrap.createDiv({ cls: "mediavault-modal-hint", text: "Loading comments from Trakt..." });

		let comments: TraktComment[];
		try {
			comments = await fetchComments();
		} catch (err) {
			loading.setText(`Couldn't load comments from Trakt — ${describeTraktError(err)}`);
			return;
		}

		loading.remove();
		const highlightId = this.pendingHighlightCommentId;
		this.pendingHighlightCommentId = null;
		await this.renderCommentList(listWrap, comments, target, highlightId);
	}

	/**
	 * Cast tab (Milestone 4: Cast & Filmography System) — principal cast
	 * for this movie/show, shared by Movie and TV Series Details. Reuses
	 * the existing `getCredits` call (already cached alongside
	 * getMovie/getTV's own append_to_response) rather than a new fetch.
	 */
	private async renderCastTab(contentEl: HTMLElement): Promise<void> {
		const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
		section.createEl("h3", { text: "Cast" });

		const mediaKind = this.media.type === MediaType.Movie ? "movie" : "tv";
		const loading = section.createDiv({ cls: "mediavault-modal-hint", text: "Loading cast..." });
		let cast;
		try {
			cast = await this.tmdb.getCredits(this.media.tmdbId, mediaKind);
		} catch (err) {
			loading.setText(`Couldn't load cast — ${(err as Error).message}`);
			return;
		}
		loading.remove();

		if (cast.length === 0) {
			section.createDiv({ cls: "mediavault-modal-hint", text: "No cast information available." });
			return;
		}

		const grid = section.createDiv({ cls: "mediavault-cast-grid" });
		[...cast]
			.sort((a, b) => a.order - b.order)
			.forEach((member) => {
				const card = grid.createDiv({ cls: "mediavault-cast-card" });
				const photoUrl = tmdbImageUrl(member.profilePath, "w200");
				if (photoUrl) {
					card.createEl("img", { cls: "mediavault-cast-photo", attr: { src: photoUrl, alt: member.name, loading: "lazy" } });
				} else {
					card.createDiv({ cls: "mediavault-cast-photo mediavault-cast-photo-empty", text: "🎭" });
				}
				const info = card.createDiv({ cls: "mediavault-cast-info" });
				info.createDiv({ cls: "mediavault-cast-name", text: member.name });
				info.createDiv({ cls: "mediavault-detail-meta", text: member.character });

				card.addEventListener("click", () => {
					new ActorDetailsModal(this.app, this.storage, this.tmdb, member.tmdbPersonId).open();
				});
			});
	}

	private async renderCommentList(
		container: HTMLElement,
		rawComments: TraktComment[],
		target: TraktCommentTarget,
		highlightId: number | null = null
	): Promise<void> {
		const settings = this.storage.settings.get();
		const comments = filterAndSortCommentsByLanguage(
			rawComments,
			settings.commentsPrimaryLanguage,
			settings.commentsAdditionalLanguages
		);

		if (comments.length === 0) {
			container.createDiv({
				cls: "mediavault-modal-hint",
				text:
					rawComments.length > 0
						? "No comments in your configured languages yet — see Settings to add more."
						: "No comments yet on Trakt.",
			});
			return;
		}

		const currentUser = this.trakt ? await this.trakt.getCurrentUser().catch(() => null) : null;

		const list = container.createDiv({ cls: "mediavault-comments-list" });
		comments.forEach((comment) => {
			const item = list.createDiv({ cls: "mediavault-comment-item" });
			if (comment.id === highlightId) {
				item.addClass("is-newly-posted");
				setTimeout(() => item.removeClass("is-newly-posted"), 2500);
			}

			const avatarEl = item.createDiv({ cls: "mediavault-comment-avatar" });
			if (comment.avatarUrl) {
				avatarEl.createEl("img", { attr: { src: comment.avatarUrl, alt: comment.userName } });
			} else {
				avatarEl.setText(comment.userName.slice(0, 1).toUpperCase());
			}

			const main = item.createDiv({ cls: "mediavault-comment-main" });

			const header = main.createDiv({ cls: "mediavault-comment-header" });
			header.createSpan({ cls: "mediavault-comment-author", text: comment.userName, attr: { title: comment.userName } });
			if (comment.userRating !== null) {
				header.createSpan({ cls: "mediavault-comment-rating", text: `★ ${comment.userRating}/10` });
			}
			if (comment.spoiler) {
				header.createSpan({ cls: "mediavault-comment-spoiler-tag", text: "Spoiler" });
			}
			header.createSpan({ cls: "mediavault-comment-date", text: comment.createdAt.slice(0, 10) });

			const body = main.createEl("p", { cls: "mediavault-comment-body", text: comment.comment });
			if (comment.spoiler) {
				body.addClass("is-spoiler-hidden");
				body.addEventListener("click", () => body.removeClass("is-spoiler-hidden"), { once: true });
			}

			const footer = main.createDiv({ cls: "mediavault-comment-footer" });
			footer.createSpan({
				cls: "mediavault-comment-likes",
				text: `👍 ${comment.likes} like${comment.likes === 1 ? "" : "s"}`,
			});

			if (currentUser && currentUser.username === comment.userName && this.trakt) {
				const actions = footer.createDiv({ cls: "mediavault-comment-actions" });

				const editBtn = actions.createEl("button", { cls: "clickable-icon", text: "Edit" });
				editBtn.addEventListener("click", () => {
					this.renderCommentEditForm(main, body, comment, target);
				});

				const deleteBtn = actions.createEl("button", { cls: "clickable-icon", text: "Delete" });
				deleteBtn.addEventListener("click", async () => {
					if (!confirm("Delete this comment from Trakt? This can't be undone.")) return;
					try {
						await this.trakt!.deleteComment(comment.id);
						this.trakt!.invalidateCommentsCache(target);
						new Notice("MediaVault: comment deleted.");
						item.remove();
					} catch (err) {
						new Notice(`MediaVault: couldn't delete comment — ${describeTraktError(err)}`);
					}
				});
			}
		});
	}

	private renderCommentEditForm(item: HTMLElement, body: HTMLElement, comment: TraktComment, target: TraktCommentTarget): void {
		const existingActions = item.querySelector(".mediavault-comment-actions");
		existingActions?.remove();

		const textarea = item.createEl("textarea", { cls: "mediavault-comment-edit-input" });
		textarea.value = comment.comment;
		body.replaceWith(textarea);

		const editActions = item.createDiv({ cls: "mediavault-comment-actions" });
		const saveBtn = editActions.createEl("button", { cls: "mod-cta", text: "Save" });
		const cancelBtn = editActions.createEl("button", { text: "Cancel" });

		cancelBtn.addEventListener("click", () => void this.render());
		saveBtn.addEventListener("click", async () => {
			const value = textarea.value.trim();
			if (value === "") {
				new Notice("MediaVault: comment can't be empty.");
				return;
			}
			try {
				await this.trakt!.updateComment(comment.id, value, comment.spoiler);
				this.trakt!.invalidateCommentsCache(target);
				new Notice("MediaVault: comment updated.");
				await this.render();
			} catch (err) {
				new Notice(`MediaVault: couldn't update comment — ${describeTraktError(err)}`);
			}
		});
	}

	private async renderCommentComposer(
		container: HTMLElement,
		target: TraktCommentTarget,
		onPosted: () => Promise<void>
	): Promise<HTMLElement | null> {
		const composer = container.createDiv({ cls: "mediavault-comment-composer" });
		const token = await ensureValidTraktToken(this.storage);

		if (!token) {
			composer.createDiv({
				cls: "mediavault-modal-hint",
				text: "Connect your Trakt account to post comments.",
			});
			return composer;
		}

		const TRAKT_COMMENT_LIMIT = 2000;
		composer.createEl("h4", { text: "Write a Public Comment" });
		const textarea = composer.createEl("textarea", {
			cls: "mediavault-comment-compose-input",
			attr: { placeholder: "Share your thoughts...", enterkeyhint: "done" },
		});
		const counter = composer.createDiv({ cls: "mediavault-comment-char-counter", text: `0 / ${TRAKT_COMMENT_LIMIT}` });
		textarea.addEventListener("input", () => {
			counter.setText(`${textarea.value.length} / ${TRAKT_COMMENT_LIMIT}`);
			counter.toggleClass("is-over-limit", textarea.value.length > TRAKT_COMMENT_LIMIT);
		});

		// Obsidian's mobile webview doesn't expose a way to attach a native
		// "Done" accessory above the keyboard, so this in-composer button is
		// the fallback: it dismisses the keyboard (via blur) without
		// cancelling or posting the in-progress comment.
		const doneBtn = composer.createEl("button", {
			cls: "clickable-icon mediavault-comment-compose-done",
			attr: { "aria-label": "Dismiss keyboard" },
		});
		setIcon(doneBtn, "chevron-down");
		doneBtn.addEventListener("click", () => textarea.blur());

		const warningEl = composer.createDiv({ cls: "mediavault-comment-refresh-warning" });

		const buttonRow = composer.createDiv({ cls: "mediavault-comment-compose-buttons" });

		const cancelBtn = buttonRow.createEl("button", { cls: "mediavault-comment-compose-cancel", text: "Cancel" });
		cancelBtn.addEventListener("click", () => {
			textarea.value = "";
			counter.setText(`0 / ${TRAKT_COMMENT_LIMIT}`);
			textarea.blur();
			composer.addClass("is-collapsed");
		});

		const postBtn = buttonRow.createEl("button", { cls: "mod-cta", text: "Post Comment" });
		postBtn.addEventListener("click", async () => {
			const text = textarea.value.trim();
			if (text === "") {
				new Notice("MediaVault: write something before posting.");
				return;
			}
			if (text.length > TRAKT_COMMENT_LIMIT) {
				new Notice(`MediaVault: comment is too long (Trakt's limit is ${TRAKT_COMMENT_LIMIT} characters).`);
				return;
			}

			warningEl.empty();
			postBtn.disabled = true;
			postBtn.setText("Posting...");

			let posted;
			try {
				posted = await this.trakt!.postComment(target, text);
			} catch (err) {
				new Notice(`MediaVault: couldn't post comment — ${describeTraktError(err)}`);
				postBtn.disabled = false;
				postBtn.setText("Post Comment");
				return;
			}

			new Notice("MediaVault: comment posted.");
			textarea.value = "";
			counter.setText(`0 / ${TRAKT_COMMENT_LIMIT}`);
			composer.addClass("is-collapsed");
			this.pendingHighlightCommentId = posted.id;
			postBtn.setText("Refreshing...");

			await this.refreshCommentsAfterPost(warningEl, postBtn, onPosted);
		});

		return composer;
	}

	/** Runs the post-submit list refresh, re-enabling the button either way and offering a Retry on failure. */
	private async refreshCommentsAfterPost(warningEl: HTMLElement, postBtn: HTMLButtonElement, onPosted: () => Promise<void>): Promise<void> {
		try {
			await onPosted();
			warningEl.empty();
		} catch (err) {
			warningEl.empty();
			warningEl.createDiv({
				cls: "mediavault-modal-hint mediavault-comment-refresh-warning-text",
				text: "Your comment was published successfully, but the comments list could not be refreshed.",
			});
			const retryBtn = warningEl.createEl("button", { text: "Retry" });
			retryBtn.addEventListener("click", () => void this.refreshCommentsAfterPost(warningEl, postBtn, onPosted));
		} finally {
			postBtn.disabled = false;
			postBtn.setText("Post Comment");
		}
	}

	private async renderEpisodesTab(contentEl: HTMLElement): Promise<void> {
		const episodes = await this.storage.episodes.findByMediaId(this.media.id);

		if (episodes.length === 0) {
			if (this.isPreview) {
				contentEl.createDiv({
					cls: "mediavault-episode-empty",
					text: "Add this show to your library to browse and track its episodes.",
				});
				return;
			}
			contentEl.createDiv({
				cls: "mediavault-episode-empty",
				text: "No episode data yet. Import episode metadata from TMDB to start tracking.",
			});
			const importBtn = contentEl.createEl("button", { text: "Import episodes from TMDB", cls: "mod-cta" });
			importBtn.addEventListener("click", () => void this.runEpisodeImport());
			return;
		}

		const seasonNumbers = [...new Set(episodes.map((e) => e.seasonNumber))].sort((a, b) => a - b);
		const progressRecords = await this.storage.episodeProgress.findByMediaId(this.media.id);
		const progressByEpisodeId = new Map(progressRecords.map((p) => [p.episodeId, p]));

		const activeSeason = seasonNumbers.find((seasonNumber) => {
			const seasonEpisodes = episodes.filter((e) => e.seasonNumber === seasonNumber);
			const watched = seasonEpisodes.filter((e) => progressByEpisodeId.get(e.id)?.watched).length;

			return watched > 0 && watched < seasonEpisodes.length;
		});

		const seasonsContainer = contentEl.createDiv({ cls: "mediavault-seasons" });

		// Only initialize the default expanded season once per modal session.
		if (this.expandedSeasons.size === 0 && activeSeason !== undefined) {
			this.expandedSeasons.add(activeSeason);
		}

		for (const seasonNumber of seasonNumbers) {
			const seasonEpisodes = episodes
				.filter((e) => e.seasonNumber === seasonNumber)
				.sort((a, b) => a.episodeNumber - b.episodeNumber);
			this.renderSeason(seasonsContainer, seasonNumber, seasonEpisodes, progressByEpisodeId);
		}
	}

	private renderProgressBar(container: HTMLElement, percent: number, isFullProgress: boolean = false): void {
		const style = isFullProgress ? "mediavault-progress-bar-full" : "mediavault-progress-bar";
		const bar = container.createDiv({ cls: style });
		const fill = bar.createDiv({ cls: progressFillClasses("mediavault-progress-fill", this.media.status) });
		fill.style.width = `${Math.min(100, Math.max(0, percent))}%`;
	}

	private renderSeason(
		container: HTMLElement,
		seasonNumber: number,
		episodes: Episode[],
		progressByEpisodeId: Map<string, EpisodeProgress>
	): void {
		const watchedCount = episodes.filter((e) => progressByEpisodeId.get(e.id)?.watched).length;
		const total = episodes.length;
		const percent = total > 0 ? (watchedCount / total) * 100 : 0;

		const seasonEl = container.createDiv({ cls: "mediavault-season" });

		const header = seasonEl.createDiv({ cls: "mediavault-season-header" });
		const isExpanded = this.expandedSeasons.has(seasonNumber);
		const toggle = header.createSpan({ cls: "mediavault-season-toggle", text: isExpanded ? "▾" : "▸" });
		header.createSpan({ cls: "mediavault-season-title", text: `Season ${seasonNumber}` });
		header.createSpan({ cls: "mediavault-season-count", text: `${watchedCount}/${total}` });

		this.renderProgressBar(header, percent);

		const episodesEl = seasonEl.createDiv({ cls: "mediavault-season-episodes" });
		episodesEl.style.display = isExpanded ? "block" : "none";

		header.addEventListener("click", (evt) => {
			// Don't toggle when clicking the batch-action buttons inside the header.
			if ((evt.target as HTMLElement).closest("button")) return;
			if (this.expandedSeasons.has(seasonNumber)) {
				this.expandedSeasons.delete(seasonNumber);
				toggle.setText("▸");
				episodesEl.style.display = "none";
			} else {
				this.expandedSeasons.add(seasonNumber);
				toggle.setText("▾");
				episodesEl.style.display = "block";
			}
		});

		const actions = header.createDiv({ cls: "mediavault-season-actions" });
		const seasonWatched = total > 0 && watchedCount === total;

		const toggleWatchBtn = actions.createEl("button", { cls: "clickable-icon" });
		setIcon(toggleWatchBtn, seasonWatched ? "rotate-ccw" : "check-check");
		toggleWatchBtn.setAttr(
			"aria-label",
			seasonWatched ? "Season options" : "Mark season watched"
		);

		toggleWatchBtn.addEventListener("click", async (evt) => {
			evt.stopPropagation();

			if (!seasonWatched) {
				await markSeasonWatched(this.storage, episodes, true);

				new Notice(`MediaVault: marked season ${seasonNumber} watched.`);

				await this.render();
				this.onChanged?.();
				return;
			}

			const menu = new Menu();

			menu.addItem((item) =>
				item
					.setTitle("Log season rewatch")
					.setIcon("history")
					.onClick(() => {
						// TODO: Implement season rewatch.
					})
			);

			menu.addSeparator();

			menu.addItem((item) =>
				item
					.setTitle("Mark season unwatched")
					.setIcon("rotate-ccw")
					.onClick(async () => {
						await markSeasonWatched(this.storage, episodes, false);

						new Notice(`MediaVault: marked season ${seasonNumber} unwatched.`);

						await this.render();
						this.onChanged?.();
					})
			);

			menu.showAtMouseEvent(evt);
		});

		episodes.forEach((ep) => this.renderEpisodeRow(episodesEl, ep, progressByEpisodeId.get(ep.id) ?? null));
	}

	private renderEpisodeRow(container: HTMLElement, episode: Episode, progress: EpisodeProgress | null): void {
		const row = container.createDiv({ cls: "mediavault-episode-row is-clickable" });
		row.addEventListener("click", (evt) => {
			if ((evt.target as HTMLElement).closest("input, button")) return;
			this.openEpisodeDetail(episode);
		});

		const checkbox = row.createEl("input", { type: "checkbox" });
		checkbox.checked = progress?.watched ?? false;
		checkbox.addEventListener("change", async () => {
			if (checkbox.checked) {
				await this.markEpisodeWatchedWithSmartCompletion(episode);
			} else {
				await markEpisodeWatched(this.storage, episode, false);
			}
			this.onChanged?.();
			await this.render();
		});

		const thumb = row.createDiv({ cls: "mediavault-episode-thumb" });
		const thumbUrl = tmdbImageUrl(episode.thumbnailPath, "w200");
		if (thumbUrl) {
			thumb.createEl("img", { attr: { src: thumbUrl, alt: episode.title, loading: "lazy" } });
		}

		const info = row.createDiv({ cls: "mediavault-episode-info" });
		info.createDiv({
			cls: "mediavault-episode-title",
			text: `${episode.episodeNumber}. ${episode.title}`,
		});
		info.createDiv({
			cls: "mediavault-episode-meta",
			text: [episode.airDate, formatEpisodeRuntime(episode.runtime)].filter(Boolean).join(" · "),
		});

	}

	private async markEpisodeWatchedWithSmartCompletion(episode: Episode): Promise<void> {
		const [allEpisodes, progress] = await Promise.all([
			this.storage.episodes.findByMediaId(this.media.id),
			this.storage.episodeProgress.findByMediaId(this.media.id),
		]);
		const preceding = findUnwatchedPrecedingEpisodes(allEpisodes, episode, progress);

		if (preceding.length === 0) {
			await markEpisodeWatched(this.storage, episode, true);
			return;
		}

		const confirmed = confirm(
			"You haven't marked previous episodes as watched.\n\nWould you like to mark all previous episodes as watched?"
		);
		if (confirmed) {
			await markSeasonWatched(this.storage, [...preceding, episode], true);
			new Notice(`MediaVault: marked ${preceding.length} previous episode(s) watched too.`);
		} else {
			await markEpisodeWatched(this.storage, episode, true);
		}
	}

	private openEpisodeDetail(episode: Episode): void {
		this.tabBeforeEpisodeDetail = this.activeTab === "episode-detail" ? this.tabBeforeEpisodeDetail : this.activeTab;
		this.selectedEpisode = episode;
		this.activeTab = "episode-detail";
		void this.render();
	}

	private async renderEpisodeDetailTab(contentEl: HTMLElement, episode: Episode): Promise<void> {
		this.renderEpisodeHero(contentEl, episode);
		await this.renderEpisodeNavRow(contentEl, episode);

		const progress = await this.storage.episodeProgress.findByEpisodeId(episode.id);
		const watches = sortEpisodeWatchesChronological(await this.storage.episodeWatches.findByEpisodeId(episode.id));

		if (!progress?.watched) {
			await this.renderUnwatchedEpisodeBody(contentEl, episode);
		} else {
			await this.renderWatchedEpisodeBody(contentEl, episode, watches);
		}
	}

	private async renderEpisodeNavRow(contentEl: HTMLElement, episode: Episode): Promise<void> {
		const allEpisodes = [...(await this.storage.episodes.findByMediaId(this.media.id))].sort((a, b) =>
			a.seasonNumber !== b.seasonNumber ? a.seasonNumber - b.seasonNumber : a.episodeNumber - b.episodeNumber
		);
		const index = allEpisodes.findIndex((e) => e.id === episode.id);
		const prevEpisode = index > 0 ? allEpisodes[index - 1] : null;
		const nextEpisode = index >= 0 && index < allEpisodes.length - 1 ? allEpisodes[index + 1] : null;

		const nav = contentEl.createDiv({ cls: "mediavault-episode-nav-row" });

		const prevBtn = nav.createEl("button", { cls: "clickable-icon mediavault-episode-nav-btn mediavault-episode-nav-prev" });
		setIcon(prevBtn, "chevron-left");
		prevBtn.createSpan({ text: prevEpisode ? `S${prevEpisode.seasonNumber}E${prevEpisode.episodeNumber} — Previous` : "Previous" });
		prevBtn.disabled = !prevEpisode;
		prevBtn.setAttr("aria-label", "Previous episode");
		if (prevEpisode) {
			const target = prevEpisode;
			prevBtn.addEventListener("click", () => {
				this.selectedEpisode = target;
				void this.render();
			});
		}

		const nextBtn = nav.createEl("button", { cls: "clickable-icon mediavault-episode-nav-btn mediavault-episode-nav-next" });
		nextBtn.createSpan({ text: nextEpisode ? `S${nextEpisode.seasonNumber}E${nextEpisode.episodeNumber} — Next` : "Next" });
		setIcon(nextBtn, "chevron-right");
		nextBtn.disabled = !nextEpisode;
		nextBtn.setAttr("aria-label", "Next episode");
		if (nextEpisode) {
			const target = nextEpisode;
			nextBtn.addEventListener("click", () => {
				this.selectedEpisode = target;
				void this.render();
			});
		}
	}

	/** Hero banner: episode still, falling back to the series backdrop, then poster. */
	private renderEpisodeHero(contentEl: HTMLElement, episode: Episode): void {
		const hero = contentEl.createDiv({ cls: "mediavault-detail-hero mediavault-episode-hero" });

		const bannerPath = episode.thumbnailPath ?? this.media.backdropPath ?? this.media.posterPath;
		const bannerUrl = tmdbImageUrl(bannerPath, "original");
		if (bannerUrl) {
			hero.createEl("img", { cls: "mediavault-detail-banner-img", attr: { src: bannerUrl, alt: "" } });
		}
		hero.createDiv({ cls: "mediavault-detail-banner-overlay" });

		const heroContent = hero.createDiv({ cls: "mediavault-detail-hero-content" });
		const titleRow = heroContent.createDiv({ cls: "mediavault-detail-title-row" });
		titleRow.createEl("h2", { cls: "mediavault-episode-hero-title", text: episode.title });

		const favBtn = titleRow.createEl("button", { cls: "clickable-icon mediavault-fav-btn" });
		favBtn.setAttr("aria-label", "Toggle favorite episode");
		void this.storage.episodeProgress.findByEpisodeId(episode.id).then((progress) => {
			favBtn.toggleClass("is-favorite", !!progress?.isFavorite);
			favBtn.setText(progress?.isFavorite ? "★" : "☆");
		});
		favBtn.addEventListener("click", async (evt) => {
			evt.stopPropagation();
			const current = await this.storage.episodeProgress.findByEpisodeId(episode.id);
			if (current) {
				await this.storage.episodeProgress.update(current.id, { isFavorite: !current.isFavorite });
			} else {
				// Favoriting an unwatched episode still needs a progress record to hang the flag on.
				const created = await markEpisodeWatched(this.storage, episode, false);
				await this.storage.episodeProgress.update(created.id, { isFavorite: true });
			}
			this.onChanged?.();
			await this.render();
		});

		heroContent.createDiv({
			cls: "mediavault-detail-meta",
			text: `Season ${episode.seasonNumber} • Episode ${episode.episodeNumber}`,
		});
		heroContent.createDiv({
			cls: "mediavault-detail-meta",
			text: [formatEpisodeRuntime(episode.runtime), episode.airDate].filter(Boolean).join(" • "),
		});
	}

	/** Unwatched: an information page — overview, air date, runtime, guest cast/crew, "Mark as Watched". */
	private async renderUnwatchedEpisodeBody(contentEl: HTMLElement, episode: Episode): Promise<void> {
		const infoSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
		if (episode.synopsis) {
			infoSection.createEl("p", { cls: "mediavault-detail-synopsis", text: episode.synopsis });
		} else {
			infoSection.createDiv({ cls: "mediavault-modal-hint", text: "No overview available for this episode yet." });
		}

		const markBtn = infoSection.createEl("button", { cls: "mod-cta mediavault-mark-watched-btn", text: "Mark as Watched" });
		markBtn.addEventListener("click", async () => {
			await addEpisodeWatch(this.storage, episode);
			new Notice(`MediaVault: marked "${episode.title}" as watched.`);
			this.plugin?.refreshLibraryViews();
			this.plugin?.refreshListViews();
			await this.render();
		});

		await this.renderEpisodeCastCrew(contentEl, episode);
	}

	/**
	 * Watched: an unlimited rewatch timeline (Milestone 2: Episode Rewatch
	 * System) — one card per `EpisodeWatch`, each with its own editable
	 * star rating / emotion / notes and a delete action — a rating-evolution
	 * chart once there's more than one rated watch, an "Add another episode
	 * watch" action, then Trakt comments.
	 */
	private async renderWatchedEpisodeBody(contentEl: HTMLElement, episode: Episode, watches: EpisodeWatch[]): Promise<void> {
		const reviewSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
		reviewSection.createEl("h3", { text: "Episode watch history" });

		if (watches.length > 1) {
			const chartWrap = reviewSection.createDiv({ cls: "mediavault-episode-rating-evolution" });
			chartWrap.createDiv({ cls: "mediavault-detail-meta", text: "Rating evolution" });
			renderRatingEvolutionChart(
				chartWrap.createDiv(),
				watches.map((w, i) => ({
					watchSessionId: w.id,
					rewatchNumber: i,
					watchDate: w.watchedAt,
					rating: w.rating,
				}))
			);
		}

		watches.forEach((watch, i) => this.renderEpisodeWatchCard(reviewSection, episode, watch, i + 1));

		const addBtn = reviewSection.createEl("button", {
			cls: "mediavault-add-watch-btn",
			text: `+1 Rewatch  ·  Watched ×${watches.length}`,
		});
		addBtn.addEventListener("click", async () => {
			await addEpisodeWatch(this.storage, episode);
			this.plugin?.refreshLibraryViews();
			this.plugin?.refreshListViews();
			await this.render();
		});

		// Trakt comments — only ever shown once the episode has been watched.
		const commentsSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
		const commentsHeading = commentsSection.createDiv({ cls: "mediavault-comments-heading" });
		commentsHeading.createEl("h3", { text: "Comments" });
		if (!this.trakt) {
			commentsSection.createDiv({ cls: "mediavault-modal-hint", text: "Trakt isn't available for this item." });
			return;
		}

		if (episode.tmdbEpisodeId !== null) {
			const composeToggle = commentsHeading.createDiv({ cls: "mediavault-comment-compose-toggle" });
			setIcon(composeToggle, "square-pen");
			composeToggle.setAttribute("aria-label", "Write a comment");

			const target: TraktCommentTarget = {
				kind: "episode",
				showTmdbId: this.media.tmdbId,
				season: episode.seasonNumber,
				episode: episode.episodeNumber,
				episodeTmdbId: episode.tmdbEpisodeId,
			};
			const fetchComments = () => this.trakt!.getEpisodeComments(this.media.tmdbId, episode.seasonNumber, episode.episodeNumber);
			const listWrap = commentsSection.createDiv();
			const composer = await this.renderCommentComposer(commentsSection, target, () => this.refreshCommentList(listWrap, target, fetchComments));
			composer?.addClass("is-collapsed");
			composeToggle.addEventListener("click", () => {
				composer?.toggleClass("is-collapsed", !composer.hasClass("is-collapsed"));
				if (composer && !composer.hasClass("is-collapsed")) {
					composer.querySelector<HTMLTextAreaElement>(".mediavault-comment-compose-input")?.focus();
				}
			});
			// Public Comment Composer (Milestone 2): reorder so the composer
			// sits immediately beneath the heading rather than at the bottom
			// of the list (same fix as the movie/show Comments tab above).
			if (composer) commentsSection.insertBefore(composer, listWrap);
			await this.refreshCommentList(listWrap, target, fetchComments);
		} else {
			// No per-episode TMDB id on record (older import) — can still read/edit/delete via the season+episode number cache key, just can't post against this exact episode (no id to send Trakt).
			const fallbackTarget: TraktCommentTarget = {
				kind: "episode",
				showTmdbId: this.media.tmdbId,
				season: episode.seasonNumber,
				episode: episode.episodeNumber,
				episodeTmdbId: 0,
			};
			const listWrap = commentsSection.createDiv();
			await this.refreshCommentList(listWrap, fallbackTarget, () =>
				this.trakt!.getEpisodeComments(this.media.tmdbId, episode.seasonNumber, episode.episodeNumber)
			);
		}
	}

	/** One rewatch card — watch date, editable stars, editable emotion, editable notes, delete. */
	private renderEpisodeWatchCard(container: HTMLElement, episode: Episode, watch: EpisodeWatch, watchNumber: number): void {
		const card = container.createDiv({ cls: "mediavault-episode-review-card" });

		const headerRow = card.createDiv({ cls: "mediavault-episode-watch-card-header" });
		headerRow.createEl("strong", { text: `Watch #${watchNumber}` });
		headerRow.createSpan({ cls: "mediavault-detail-meta", text: watch.watchedAt });

		const deleteBtn = headerRow.createEl("button", { cls: "clickable-icon mediavault-delete-watch-btn" });
		setIcon(deleteBtn, "trash-2");
		deleteBtn.setAttr("aria-label", "Delete this watch");
		deleteBtn.addEventListener("click", async () => {
			await deleteEpisodeWatch(this.storage, watch.id);
			await this.render();
		});

		this.renderEpisodeStarRating(card, watch);
		this.renderEpisodeEmotionPicker(card, watch);

		const notesInput = card.createEl("textarea", {
			cls: "mediavault-episode-notes-input",
			attr: { placeholder: "Add notes or a review for this watch..." },
		});
		notesInput.value = watch.review ?? "";
		notesInput.addEventListener("blur", async () => {
			const value = notesInput.value.trim();
			if (value === (watch.review ?? "")) return;
			await updateEpisodeWatch(this.storage, watch.id, { review: value === "" ? null : value });
		});
	}

	/** Five interactive stars — add or edit this specific watch's rating (1-5). */
	private renderEpisodeStarRating(container: HTMLElement, watch: EpisodeWatch): void {
		const wrap = container.createDiv({ cls: "mediavault-episode-star-rating" });
		const current = watch.rating ?? 0;

		for (let i = 1; i <= 5; i++) {
			const star = wrap.createEl("button", { cls: "clickable-icon mediavault-star-btn" });
			setIcon(star, i <= current ? "star" : "star-off");
			star.toggleClass("is-filled", i <= current);
			star.setAttr("aria-label", `Rate ${i} star${i === 1 ? "" : "s"}`);
			star.addEventListener("click", async () => {
				await updateEpisodeWatch(this.storage, watch.id, { rating: i });
				await this.render();
			});
		}
	}

	private static readonly EMOTIONS = ["😀", "😄", "😐", "😢", "😭", "😱", "❤️", "🤯"];

	/** One selectable emoji reaction for this watch, editable, with the selected state shown. */
	private renderEpisodeEmotionPicker(container: HTMLElement, watch: EpisodeWatch): void {
		const wrap = container.createDiv({ cls: "mediavault-episode-emotion-picker" });
		wrap.createDiv({ cls: "mediavault-detail-meta", text: "How was it?" });
		const row = wrap.createDiv({ cls: "mediavault-emotion-row" });

		MediaDetailModal.EMOTIONS.forEach((emoji) => {
			const btn = row.createEl("button", { cls: "mediavault-emotion-btn", text: emoji });
			btn.toggleClass("is-selected", watch.emotion === emoji);
			btn.addEventListener("click", async () => {
				const next = watch.emotion === emoji ? null : emoji; // click again to clear
				await updateEpisodeWatch(this.storage, watch.id, { emotion: next });
				await this.render();
			});
		});
	}

	/** Crew (director/writer) only — Guest Cast moved to the Cast tab (Milestone 4: Cast & Filmography System), so Episode Details stays focused on the episode itself. */
	private async renderEpisodeCastCrew(contentEl: HTMLElement, episode: Episode): Promise<void> {
		const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
		const loading = section.createDiv({ cls: "mediavault-modal-hint", text: "Loading crew..." });
		try {
			const { crew } = await this.tmdb.getEpisodeCredits(
				this.media.tmdbId,
				episode.seasonNumber,
				episode.episodeNumber
			);
			loading.remove();

			if (crew.length > 0) {
				section.createEl("h3", { text: "Crew" });
				const crewList = section.createDiv({ cls: "mediavault-episode-crew-list" });
				crew.forEach((c) => {
					crewList.createDiv({ cls: "mediavault-detail-meta", text: `${c.name} — ${c.job}` });
				});
			} else {
				section.remove();
			}
		} catch {
			// Cast/crew is supplementary — fail silently rather than blocking the info page.
			loading.remove();
		}
	}

	private async runEpisodeImport(): Promise<void> {
		new Notice(`MediaVault: importing episodes for "${this.media.title}"...`);
		try {
			const result = await importEpisodesForShow(this.storage, this.tmdb, this.media);
			new Notice(
				`MediaVault: imported ${result.episodesAdded} new episode(s) across ${result.seasonsProcessed} season(s).`
			);
			await this.render();
		} catch (err) {
			new Notice(`MediaVault: episode import failed — ${(err as Error).message}`);
		}
	}

	// ---- Shared ----

	private async refreshAndNotify(): Promise<void> {
		await this.render();
		this.onChanged?.();
	}

	/**
	 * Confirmation dialog names exactly what will be permanently removed
	 * (watch history, reviews, ratings, episode progress, notes, list
	 * references, favorite status) before calling deleteMedia — per the
	 * Universal Delete spec, this is a one-way action with no undo.
	 */
	private async confirmAndDelete(alreadyConfirmed = false): Promise<void> {
		if (!alreadyConfirmed) {
			const scope = describeDeletionScope(this.media);
			const confirmed = confirm(
				`Delete "${this.media.title}"?\n\nThis will permanently delete:\n${scope
					.map((line) => `• ${line}`)
					.join("\n")}\n\nThis action cannot be undone.`
			);
			if (!confirmed) return;
		}

		const summary = await deleteMedia(this.app, this.storage, this.media.id);
		if (!summary) {
			new Notice("MediaVault: this item no longer exists.");
			this.close();
			return;
		}

		new Notice(`MediaVault: "${summary.mediaTitle}" deleted.`);
		this.close();

		// Deliberately call only the plugin-level refresh here, not
		// `onChanged` too. The `onChanged` callbacks passed in by callers
		// (e.g. LibraryView.openDetail, MediaVaultPlugin.openMediaDetail)
		// already call plugin.refreshLibraryViews()/refreshListViews()
		// themselves, so calling both fires two overlapping async refreshes
		// on the same views — the root cause of the duplicated statistics
		// cards (see Milestone 1: Statistics Refresh & Delete Bug).
		if (this.plugin) {
			this.plugin.refreshLibraryViews();
			this.plugin.refreshListViews();
		} else {
			this.onChanged?.();
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
