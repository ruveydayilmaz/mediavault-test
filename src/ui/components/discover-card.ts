import { App, Notice } from "obsidian";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { addMediaFromTMDB } from "../../services/media-import";
import { buildMediaItemFromTMDB } from "../../services/media-import";
import { MediaType } from "../../types/enums";
import { MediaDetailModal } from "../modals/media-detail-modal";

/**
 * Common shape every Discover-style card renders from, whether the source
 * was a TMDBSearchResult, a Recommendation, or a discover/search result.
 * Shared between Explore (Discover/Browse/Search tabs) and the
 * Recommended For You modal (Library/Favorites roadmap, Milestone 3) so
 * both use one card implementation instead of two near-duplicates.
 */
export interface DiscoverCardData {
	tmdbId: number;
	mediaKind: "movie" | "tv";
	title: string;
	year: number | null;
	posterPath: string | null;
	reason?: string;
	/** Already resolved to a local media id (e.g. a Recommendation for an owned title) — skips the TMDB-id lookup on click. */
	mediaId?: string | null;
}

export interface DiscoverCardDeps {
	app: App;
	storage: StorageService;
	tmdb: TMDBService;
	/** Whether this card's title is already in the library — shows "In library" instead of the add button. Omit to always show the add button. */
	isOwned?: (card: DiscoverCardData) => boolean;
	onAdded?: (card: DiscoverCardData) => void;
}

/** Renders one poster card into `container` using the shared Explore card classes/sizing. */
export function renderDiscoverCard(container: HTMLElement, deps: DiscoverCardDeps, card: DiscoverCardData): void {
	const el = container.createDiv({ cls: "mediavault-explore-card" });

	const poster = el.createDiv({ cls: "mediavault-explore-poster" });
	const posterUrl = tmdbImageUrl(card.posterPath, "w200");
	if (posterUrl) poster.createEl("img", { attr: { src: posterUrl, alt: card.title, loading: "lazy" } });
	else poster.setText("🎬");

	const info = el.createDiv({ cls: "mediavault-explore-info" });
	info.createDiv({ cls: "mediavault-explore-title", text: card.year ? `${card.title} (${card.year})` : card.title });
	if (card.reason) {
		info.createDiv({ cls: "mediavault-explore-reason", text: card.reason });
	}

	const owned = card.mediaId != null || (deps.isOwned?.(card) ?? false);

	poster.addEventListener("click", async () => {
		if (card.mediaId) {
			const media = await deps.storage.media.findById(card.mediaId);
			if (media) {
				new MediaDetailModal(deps.app, deps.storage, deps.tmdb, media).open();
				return;
			}
		}
		const type = card.mediaKind === "movie" ? MediaType.Movie : MediaType.TVShow;
		const existing = await deps.storage.media.findByTmdbId(card.tmdbId, type);
		if (existing) {
			new MediaDetailModal(deps.app, deps.storage, deps.tmdb, existing).open();
			return;
		}
		try {
			const details = card.mediaKind === "movie" ? await deps.tmdb.getMovie(card.tmdbId) : await deps.tmdb.getTV(card.tmdbId);
			const previewMedia = buildMediaItemFromTMDB(details);
			new MediaDetailModal(
				deps.app,
				deps.storage,
				deps.tmdb,
				previewMedia,
				undefined,
				undefined,
				"cast",
				undefined,
				undefined,
				true,
				details.tmdbRating
			).open();
		} catch (err) {
			new Notice(`MediaVault: couldn't load "${card.title}" — ${(err as Error).message}`);
		}
	});

	if (owned) {
		poster.createDiv({ cls: "mediavault-explore-owned-badge", text: "In library" });
	} else {
		const addBtn = poster.createDiv({ cls: "mediavault-explore-add-floating" });
		addBtn.setAttr("aria-label", "Add to library");
		addBtn.setText("+");
		addBtn.addEventListener("click", async (evt) => {
			evt.stopPropagation();
			try {
				const result = await addMediaFromTMDB(deps.storage, deps.tmdb, card.tmdbId, card.mediaKind);
				new Notice(
					result.alreadyExisted
						? `MediaVault: "${result.mediaItem.title}" is already in your library.`
						: `MediaVault: added "${result.mediaItem.title}" to your library.`
				);
				addBtn.addClass("is-added");
				addBtn.setText("✓");
				deps.onAdded?.(card);
			} catch (err) {
				new Notice(`MediaVault: failed to add — ${(err as Error).message}`);
			}
		});
	}
}
