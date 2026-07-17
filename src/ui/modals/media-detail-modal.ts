import { App, Modal, Notice, Menu, setIcon } from "obsidian";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import type { TraktService, TraktComment } from "../../api/trakt";
import type MediaVaultPlugin from "../../main";
import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import { RatingEvolutionPoint, WatchSession } from "../../models/review";
import { Episode, EpisodeProgress } from "../../models/episode";
import { sortSessionsChronological, getRatingEvolution } from "../../services/review-logic";
import { deleteWatchSession } from "../../services/watch-session-service";
import { deleteMedia, describeDeletionScope } from "../../services/media-delete-service";
import { markEpisodeWatched, markSeasonWatched, findUnwatchedPrecedingEpisodes } from "../../services/episode-status-sync";
import { importEpisodesForShow, needsEpisodeSync } from "../../services/episode-import";
import { renderRatingEvolutionChart } from "../components/rating-chart";
import { statusLabel, formatRating } from "../components/media-render";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { WatchSessionModal } from "./watch-session-modal";
import { generateMediaNote } from "../../services/note-generator/media-note-generator";
import { ComfortProfileModal } from "./comfort-profile-modal";
import { AddToListModal } from "./add-to-list-modal";
import { ImagePickerModal } from "./image-picker-modal";

type DetailTab = "history" | "episodes" | "comments" | "episode-detail";

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
		initialEpisode?: Episode
	) {
		super(app);
		this.storage = storage;
		this.tmdb = tmdb;
		this.trakt = trakt;
		this.media = media;
		this.onChanged = onChanged;
		this.plugin = plugin;
		if (media.type === MediaType.TVShow && initialEpisode) {
			this.selectedEpisode = initialEpisode;
			this.activeTab = "episode-detail";
		} else if (media.type === MediaType.TVShow) {
			this.activeTab = initialTab;
		} else {
			this.activeTab = initialTab === "episodes" || initialTab === "episode-detail" ? "history" : initialTab;
		}
	}

	onOpen(): void {
		this.modalEl.addClass("mediavault-detail-modal");
		void this.initialize();
	}

	private async initialize(): Promise<void> {
		if (this.media.type === MediaType.TVShow) {
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
		} else {
			await this.renderWatchHistoryTab(contentEl);
		}
	}

	private async renderHeader(contentEl: HTMLElement): Promise<void> {
		await this.renderHero(contentEl);

		const body = contentEl.createDiv({ cls: "mediavault-detail-body" });

		const detail = body.createDiv({ cls: "mediavault-detail-status", text: statusLabel(this.media.status) });

		if (this.media.averageRating !== null) {
			detail.createDiv({
				cls: "mediavault-detail-rating",
				text: `★ ${formatRating(this.media.averageRating)} average across ${this.media.watchCount} watch${this.media.watchCount === 1 ? "" : "es"}`,
			});
		}
		if (this.media.synopsis) {
			this.renderDescription(body, this.media.synopsis);
		}
	}

	/**
	 * Full-width hero banner (Milestone 3: Media Details Modal Redesign) —
	 * replaces the old poster-on-the-left layout. Falls back to the poster
	 * image (then a plain gradient) when there's no backdrop yet, so shows
	 * added before `backdropPath` existed still render something.
	 */
	private async renderHero(contentEl: HTMLElement): Promise<void> {
		const hero = contentEl.createDiv({ cls: "mediavault-detail-hero" });

		const bannerUrl = tmdbImageUrl(this.media.backdropPath ?? this.media.posterPath, "original");
		if (bannerUrl) {
			hero.createEl("img", { cls: "mediavault-detail-banner-img", attr: { src: bannerUrl, alt: "" } });
		}
		hero.createDiv({ cls: "mediavault-detail-banner-overlay" });

		const menuBtn = hero.createEl("button", { cls: "clickable-icon mediavault-detail-menu-btn" });
		setIcon(menuBtn, "more-vertical");
		menuBtn.setAttr("aria-label", "More options");
		menuBtn.addEventListener("click", (evt) => this.openHeroMenu(evt));

		const heroContent = hero.createDiv({ cls: "mediavault-detail-hero-content" });
		const left = heroContent.createDiv({ cls: "mediavault-detail-hero-main" });
		const titleRow = left.createDiv({ cls: "mediavault-detail-title-row" });

		titleRow.createEl("h2", { text: this.media.title });
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
		left.createDiv({
			cls: "mediavault-detail-meta",
			text: [this.media.year, this.media.genres.join(", ")].filter(Boolean).join(" · "),
		});

		if (MediaType.Movie === this.media.type) {
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

		const episodes = await this.storage.episodes.findByMediaId(this.media.id); // only fetch once per render, not per episode row (currently fetched two times)
		const progress = await this.storage.episodeProgress.getShowProgress(this.media.id, episodes);

		this.renderProgressBar(hero, progress.percentWatched, true);
	}

	private openHeroMenu(evt: MouseEvent): void {
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

			menu.addItem((item) =>
				item
					.setTitle("Delete")
					.setIcon("trash")
					.onClick(() => void this.confirmAndDelete())
			);
		}

		if (this.media.type === MediaType.TVShow) {
			menu.addSeparator();

			menu.addItem((item) =>
				item
					.setTitle("Refresh episodes from TMDB")
					.setIcon("refresh-cw")
					.onClick(() => void this.runEpisodeImport())
			);
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

	// ---- Tab bar (Milestone 4) ----

	private renderTabBar(contentEl: HTMLElement): void {
		const bar = contentEl.createDiv({ cls: "mediavault-detail-tabs" });
		const tabs: { id: DetailTab; label: string }[] =
			this.media.type === MediaType.TVShow
				? [
					{ id: "history", label: "Watch History" },
					{ id: "episodes", label: "Episodes" },
				]
				: [
					{ id: "history", label: "Watch History" },
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

		menuBtn.addEventListener("click", (evt) => {
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

			menu.addItem((item) =>
				item
					.setTitle("Delete")
					.setIcon("trash")
					.onClick(async () => {
						const confirmed = confirm(
							`Delete this ${session.rewatchNumber === 0 ? "first watch" : "rewatch"
							} entry? This cannot be undone.`
						);

						if (!confirmed) return;

						await deleteWatchSession(this.storage, session.id);
						new Notice("MediaVault: watch entry deleted.");
						await this.refreshAndNotify();
					})
			);

			menu.showAtMouseEvent(evt);
		});
	}

	// ---- Comments tab (Milestone 4: Comments Integration — movies only; TV comments live per-episode) ----

	private async renderCommentsTab(contentEl: HTMLElement): Promise<void> {
		const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
		section.createEl("h3", { text: "Comments" });

		if (!this.trakt) {
			section.createDiv({ cls: "mediavault-modal-hint", text: "Trakt isn't available for this item." });
			return;
		}

		const loading = section.createDiv({ cls: "mediavault-modal-hint", text: "Loading comments from Trakt..." });

		let comments: TraktComment[];
		try {
			comments = await this.trakt.getMovieComments(this.media.tmdbId);
		} catch (err) {
			loading.setText(`Couldn't load comments from Trakt — ${(err as Error).message}`);
			return;
		}

		loading.remove();
		this.renderCommentList(section, comments);
	}

	/** Shared by the movie Comments tab and the Episode Details view. */
	private renderCommentList(container: HTMLElement, comments: TraktComment[]): void {
		if (comments.length === 0) {
			container.createDiv({ cls: "mediavault-modal-hint", text: "No comments yet on Trakt." });
			return;
		}

		const list = container.createDiv({ cls: "mediavault-comments-list" });
		comments.forEach((comment) => {
			const item = list.createDiv({ cls: "mediavault-comment-item" });
			const header = item.createDiv({ cls: "mediavault-comment-header" });
			header.createSpan({ cls: "mediavault-comment-author", text: comment.userName });
			header.createSpan({ cls: "mediavault-comment-date", text: comment.createdAt.slice(0, 10) });
			if (comment.spoiler) {
				header.createSpan({ cls: "mediavault-comment-spoiler-tag", text: "Spoiler" });
			}
			const body = item.createEl("p", { cls: "mediavault-comment-body", text: comment.comment });
			if (comment.spoiler) {
				body.addClass("is-spoiler-hidden");
				body.addEventListener("click", () => body.removeClass("is-spoiler-hidden"), { once: true });
			}
		});
	}

	private async renderEpisodesTab(contentEl: HTMLElement): Promise<void> {
		const episodes = await this.storage.episodes.findByMediaId(this.media.id);

		if (episodes.length === 0) {
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
		const fill = bar.createDiv({ cls: "mediavault-progress-fill" });
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

		const favBtn = row.createEl("button", {
			cls: `clickable-icon mediavault-fav-btn ${progress?.isFavorite ? "is-favorite" : ""}`,
			text: progress?.isFavorite ? "★" : "☆",
		});
		favBtn.setAttr("aria-label", "Toggle favorite episode");
		favBtn.addEventListener("click", async () => {
			const current = await this.storage.episodeProgress.findByEpisodeId(episode.id);
			if (current) {
				await this.storage.episodeProgress.update(current.id, { isFavorite: !current.isFavorite });
			} else {
				// Favoriting an unwatched episode still needs a progress record to hang the flag on.
				const created = await markEpisodeWatched(this.storage, episode, false);
				await this.storage.episodeProgress.update(created.id, { isFavorite: true });
			}
			await this.render();
			this.onChanged?.();
		});
	}

	/**
	 * Marks a single episode watched, but first checks for unwatched
	 * earlier episodes/seasons (Milestone 3: Smart Episode Completion). If
	 * any exist, prompts once before backfilling them alongside the target
	 * episode — never asks when everything before it is already watched.
	 */
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

	/**
	 * Switches the modal into "Episode Details" mode (Milestone 4). Reachable
	 * from the Episodes tab (this method) as well as directly on open, when
	 * Watch Next or the Upcoming list construct the modal with an
	 * `initialEpisode` already set.
	 */
	private openEpisodeDetail(episode: Episode): void {
		this.tabBeforeEpisodeDetail = this.activeTab === "episode-detail" ? this.tabBeforeEpisodeDetail : this.activeTab;
		this.selectedEpisode = episode;
		this.activeTab = "episode-detail";
		void this.render();
	}

	/**
	 * Episode Details (Milestone 1: Episode Details Experience) — a hero
	 * banner header, then one of two bodies depending on watched state:
	 * an information page (overview, cast/crew, "Mark as Watched") for
	 * unwatched episodes, or a review page (review card, star rating,
	 * emotion picker, Trakt comments) once it's been watched. Comments are
	 * deliberately withheld until the episode is watched, to avoid spoilers.
	 */
	private async renderEpisodeDetailTab(contentEl: HTMLElement, episode: Episode): Promise<void> {
		this.renderEpisodeHero(contentEl, episode);

		const backBtn = contentEl.createEl("button", { cls: "clickable-icon mediavault-back-btn", text: "← Back to Episodes" });
		backBtn.addEventListener("click", () => {
			this.activeTab = this.tabBeforeEpisodeDetail === "episode-detail" ? "episodes" : this.tabBeforeEpisodeDetail;
			this.selectedEpisode = null;
			void this.render();
		});

		const progress = await this.storage.episodeProgress.findByEpisodeId(episode.id);
		const isWatched = progress?.watched ?? false;

		if (!isWatched) {
			await this.renderUnwatchedEpisodeBody(contentEl, episode);
		} else {
			await this.renderWatchedEpisodeBody(contentEl, episode, progress);
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
		heroContent.createEl("h2", { cls: "mediavault-episode-hero-title", text: episode.title });
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
			await markEpisodeWatched(this.storage, episode, true);
			new Notice(`MediaVault: marked "${episode.title}" as watched.`);
			this.plugin?.refreshLibraryViews();
			this.plugin?.refreshListViews();
			await this.render();
		});

		await this.renderEpisodeCastCrew(contentEl, episode);
	}

	/** Watched: review card, interactive star rating, emotion picker, then Trakt comments. */
	private async renderWatchedEpisodeBody(
		contentEl: HTMLElement,
		episode: Episode,
		progress: EpisodeProgress | null
	): Promise<void> {
		const reviewSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
		reviewSection.createEl("h3", { text: "Your review" });

		const reviewCard = reviewSection.createDiv({ cls: "mediavault-episode-review-card" });
		if (progress?.watchedDate) {
			reviewCard.createDiv({ cls: "mediavault-detail-meta", text: `Watched ${progress.watchedDate}` });
		}
		const notesInput = reviewCard.createEl("textarea", {
			cls: "mediavault-episode-notes-input",
			attr: { placeholder: "Add notes or a review for this watch..." },
		});
		notesInput.value = progress?.review ?? "";
		notesInput.addEventListener("blur", async () => {
			const existing = await this.storage.episodeProgress.findByEpisodeId(episode.id);
			if (!existing) return;
			const value = notesInput.value.trim();
			if (value === (existing.review ?? "")) return;
			await this.storage.episodeProgress.update(existing.id, { review: value === "" ? null : value });
		});

		this.renderEpisodeStarRating(reviewSection, episode, progress);
		this.renderEpisodeEmotionPicker(reviewSection, episode, progress);

		// Trakt comments — only ever shown once the episode has been watched.
		const commentsSection = contentEl.createDiv({ cls: "mediavault-detail-section" });
		commentsSection.createEl("h3", { text: "Comments" });
		if (!this.trakt) {
			commentsSection.createDiv({ cls: "mediavault-modal-hint", text: "Trakt isn't available for this item." });
			return;
		}
		const loading = commentsSection.createDiv({ cls: "mediavault-modal-hint", text: "Loading comments from Trakt..." });
		try {
			const comments = await this.trakt.getEpisodeComments(this.media.tmdbId, episode.seasonNumber, episode.episodeNumber);
			loading.remove();
			this.renderCommentList(commentsSection, comments);
		} catch (err) {
			loading.setText(`Couldn't load comments from Trakt — ${(err as Error).message}`);
		}
	}

	/** Five interactive stars — add or edit a rating (1-5), updating the episode's watch session. */
	private renderEpisodeStarRating(container: HTMLElement, episode: Episode, progress: EpisodeProgress | null): void {
		const wrap = container.createDiv({ cls: "mediavault-episode-star-rating" });
		const current = progress?.rating ?? 0;

		for (let i = 1; i <= 5; i++) {
			const star = wrap.createEl("button", { cls: "clickable-icon mediavault-star-btn" });
			setIcon(star, i <= current ? "star" : "star-off");
			star.toggleClass("is-filled", i <= current);
			star.setAttr("aria-label", `Rate ${i} star${i === 1 ? "" : "s"}`);
			star.addEventListener("click", async () => {
				await markEpisodeWatched(this.storage, episode, true);
				const existing = await this.storage.episodeProgress.findByEpisodeId(episode.id);
				if (existing) await this.storage.episodeProgress.update(existing.id, { rating: i });
				await this.render();
			});
		}
	}

	private static readonly EMOTIONS = ["😀", "😄", "😐", "😢", "😭", "😱", "❤️", "🤯"];

	/** One selectable emoji reaction per watch, editable, with the selected state shown. */
	private renderEpisodeEmotionPicker(container: HTMLElement, episode: Episode, progress: EpisodeProgress | null): void {
		const wrap = container.createDiv({ cls: "mediavault-episode-emotion-picker" });
		wrap.createDiv({ cls: "mediavault-detail-meta", text: "How was it?" });
		const row = wrap.createDiv({ cls: "mediavault-emotion-row" });

		MediaDetailModal.EMOTIONS.forEach((emoji) => {
			const btn = row.createEl("button", { cls: "mediavault-emotion-btn", text: emoji });
			btn.toggleClass("is-selected", progress?.emotion === emoji);
			btn.addEventListener("click", async () => {
				const existing = await this.storage.episodeProgress.findByEpisodeId(episode.id);
				if (!existing) return;
				const next = existing.emotion === emoji ? null : emoji; // click again to clear
				await this.storage.episodeProgress.update(existing.id, { emotion: next });
				await this.render();
			});
		});
	}

	/** Guest cast + crew (director/writer), fetched live from TMDB — only shown while unwatched, per spec. */
	private async renderEpisodeCastCrew(contentEl: HTMLElement, episode: Episode): Promise<void> {
		const section = contentEl.createDiv({ cls: "mediavault-detail-section" });
		const loading = section.createDiv({ cls: "mediavault-modal-hint", text: "Loading cast & crew..." });
		try {
			const { guestCast, crew } = await this.tmdb.getEpisodeCredits(
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
			}

			if (guestCast.length > 0) {
				section.createEl("h3", { text: "Guest cast" });
				const castList = section.createDiv({ cls: "mediavault-episode-crew-list" });
				guestCast.forEach((c) => {
					castList.createDiv({ cls: "mediavault-detail-meta", text: `${c.name} as ${c.character}` });
				});
			}

			if (crew.length === 0 && guestCast.length === 0) {
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
	private async confirmAndDelete(): Promise<void> {
		const scope = describeDeletionScope(this.media);
		const confirmed = confirm(
			`Delete "${this.media.title}"?\n\nThis will permanently delete:\n${scope
				.map((line) => `• ${line}`)
				.join("\n")}\n\nThis action cannot be undone.`
		);
		if (!confirmed) return;

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
