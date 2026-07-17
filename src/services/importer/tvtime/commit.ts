import type { StorageService } from "../../storage";
import type { TMDBService } from "../../../api/tmdb";
import { MediaItem } from "../../../models/media";
import { MediaType } from "../../../types/enums";
import { buildMediaItemFromTMDB } from "../../media-import";
import { addWatchSession } from "../../watch-session-service";
import { markEpisodeWatched } from "../../episode-status-sync";
import { importEpisodesForShow } from "../../episode-import";
import { findTMDBCandidates, classifyMatch } from "../tmdb-match";
import { NormalizedImportBundle, WatchImport, ReviewImport, LikeImport, RatingImport, ListImport, ExternalIds, ImportMediaKind } from "./types";

export interface ImportReport {
	moviesImported: number;
	showsImported: number;
	episodesUpdated: number;
	commentsImported: number;
	likesImported: number;
	favoritesImported: number;
	ratingsImported: number;
	listsImported: number;
	duplicatesMerged: number;
	skipped: number;
	errors: { reason: string }[];
}

export function emptyReport(): ImportReport {
	return {
		moviesImported: 0,
		showsImported: 0,
		episodesUpdated: 0,
		commentsImported: 0,
		likesImported: 0,
		favoritesImported: 0,
		ratingsImported: 0,
		listsImported: 0,
		duplicatesMerged: 0,
		skipped: 0,
		errors: [],
	};
}

function resolutionKey(ids: ExternalIds, title: string, year: number | null): string {
	return JSON.stringify([ids.tvdbId ?? null, ids.imdbId ?? null, ids.tvTimeUuid ?? null, title.toLowerCase().trim(), year]);
}

/**
 * Resolves a bundle item (movie or show) to a local MediaItem, creating one
 * via TMDB if nothing matches locally yet. Matches in priority order:
 * TVDB id, IMDb id, TV Time's own uuid, then falls back to a TMDB
 * title(+year) search. Memoized per commitBundle() call so the same title
 * referenced across watches/reviews/likes/ratings/favorites only resolves
 * (and only hits TMDB) once.
 */
export class MediaResolver {
	private cache = new Map<string, { media: MediaItem | null; isNew: boolean }>();

	constructor(
		private storage: StorageService,
		private tmdb: TMDBService,
		private report: ImportReport
	) {}

	async resolve(ids: ExternalIds, title: string, year: number | null, kind: ImportMediaKind): Promise<MediaItem | null> {
		const key = resolutionKey(ids, title, year);
		const cached = this.cache.get(key);
		if (cached) return cached.media;

		const result = await this.doResolve(ids, title, year, kind);
		this.cache.set(key, result);
		return result.media;
	}

	private async doResolve(
		ids: ExternalIds,
		title: string,
		year: number | null,
		kind: ImportMediaKind
	): Promise<{ media: MediaItem | null; isNew: boolean }> {
		// 1. TVDB id
		if (ids.tvdbId != null) {
			const existing = await this.storage.media.findByTvdbId(ids.tvdbId);
			if (existing) {
				this.report.duplicatesMerged++;
				return { media: existing, isNew: false };
			}
		}

		// 2. IMDb id
		if (ids.imdbId) {
			const existing = await this.storage.media.findByImdbId(ids.imdbId);
			if (existing) {
				this.report.duplicatesMerged++;
				return { media: existing, isNew: false };
			}
		}

		// 3. TV Time's own uuid
		if (ids.tvTimeUuid) {
			const existing = await this.storage.media.findByTvTimeUuid(ids.tvTimeUuid);
			if (existing) {
				this.report.duplicatesMerged++;
				return { media: existing, isNew: false };
			}
		}

		// 4. Title (+year) fallback — search the local library first, then TMDB to create if nothing local matches.
		const allMedia = await this.storage.media.getAll();
		const normalizedTitle = title.toLowerCase().replace(/[^a-z0-9]/g, "");
		const localMatch = allMedia.find((m) => {
			if (m.title.toLowerCase().replace(/[^a-z0-9]/g, "") !== normalizedTitle) return false;
			return year === null || m.year === null || m.year === year;
		});
		if (localMatch) {
			this.report.duplicatesMerged++;
			return { media: localMatch, isNew: false };
		}

		// Nothing local — resolve a brand-new MediaItem via TMDB. Requires an API key/network; if that fails
		// or the match is ambiguous, this title is skipped rather than guessed at.
		try {
			const tmdbKind = kind === "movie" ? "movie" : "tv";
			const candidates = await findTMDBCandidates(this.tmdb, { kind: tmdbKind, title, year });
			const status = classifyMatch({ kind: tmdbKind, title, year }, candidates);

			if (status !== "matched") {
				this.report.errors.push({
					reason: `"${title}": ${status === "ambiguous" ? "multiple possible TMDB matches" : "no TMDB match found"} — skipped.`,
				});
				return { media: null, isNew: false };
			}

			const top = candidates[0];
			const details = tmdbKind === "movie" ? await this.tmdb.getMovie(top.tmdbId) : await this.tmdb.getTV(top.tmdbId);

			// Someone else in this same import run may have already created this exact tmdbId — check before saving again.
			const existingByTmdb = await this.storage.media.findByTmdbId(top.tmdbId, tmdbKind === "movie" ? MediaType.Movie : MediaType.TVShow);
			if (existingByTmdb) {
				this.report.duplicatesMerged++;
				return { media: existingByTmdb, isNew: false };
			}

			const mediaItem = buildMediaItemFromTMDB(details);
			mediaItem.tvdbId = ids.tvdbId ?? null;
			mediaItem.imdbId = ids.imdbId ?? null;
			mediaItem.tvTimeUuid = ids.tvTimeUuid ?? null;

			const saved = await this.storage.media.save(mediaItem);
			if (kind === "movie") this.report.moviesImported++;
			else this.report.showsImported++;

			return { media: saved, isNew: true };
		} catch (err) {
			this.report.errors.push({ reason: `"${title}": ${(err as Error).message}` });
			return { media: null, isNew: false };
		}
	}
}

async function applyWatch(storage: StorageService, tmdb: TMDBService, watch: WatchImport, media: MediaItem, report: ImportReport): Promise<void> {
	if (watch.kind === "movie") {
		await addWatchSession(storage, {
			mediaId: media.id,
			watchDate: watch.watchedAt ?? new Date().toISOString().slice(0, 10),
			rating: null,
			review: "",
		});
		return;
	}

	if (watch.seasonNumber === undefined || watch.episodeNumber === undefined) {
		report.skipped++;
		return;
	}

	// Ensure real episode metadata exists before marking progress (idempotent — only adds genuinely new episodes).
	await importEpisodesForShow(storage, tmdb, media);
	const episodes = await storage.episodes.findByMediaId(media.id);
	const episode = episodes.find((e) => e.seasonNumber === watch.seasonNumber && e.episodeNumber === watch.episodeNumber);

	if (!episode) {
		report.skipped++;
		report.errors.push({
			reason: `"${watch.title}" S${watch.seasonNumber}E${watch.episodeNumber}: no matching episode found on TMDB — skipped.`,
		});
		return;
	}

	await markEpisodeWatched(storage, episode, true, watch.watchedAt ?? undefined);
	report.episodesUpdated++;
}

async function applyReview(storage: StorageService, review: ReviewImport, media: MediaItem, report: ImportReport): Promise<void> {
	if (review.kind === "movie") {
		const sessions = await storage.watchSessions.findByMediaId(media.id);
		const emptyReviewSession = sessions.find((s) => !s.review);

		if (emptyReviewSession) {
			await storage.watchSessions.update(emptyReviewSession.id, { review: review.commentText });
		} else if (sessions.length === 0) {
			// No watch logged yet — the comment itself implies a watch happened.
			await addWatchSession(storage, {
				mediaId: media.id,
				watchDate: review.createdAt ?? new Date().toISOString().slice(0, 10),
				rating: null,
				review: review.commentText,
			});
		} else {
			// Every session already has its own review text — never overwrite any of them.
			report.skipped++;
			return;
		}
		report.commentsImported++;
		return;
	}

	// Episode comment
	if (review.seasonNumber === undefined || review.episodeNumber === undefined) {
		report.skipped++;
		return;
	}
	const episodes = await storage.episodes.findByMediaId(media.id);
	const episode = episodes.find((e) => e.seasonNumber === review.seasonNumber && e.episodeNumber === review.episodeNumber);
	if (!episode) {
		report.skipped++;
		return;
	}
	const progress = await storage.episodeProgress.findByEpisodeId(episode.id);
	if (progress && progress.review) {
		report.skipped++; // never overwrite an existing episode review
		return;
	}
	if (progress) {
		await storage.episodeProgress.update(progress.id, { review: review.commentText });
	} else {
		await storage.episodeProgress.create({
			mediaId: media.id,
			episodeId: episode.id,
			seasonNumber: episode.seasonNumber,
			episodeNumber: episode.episodeNumber,
			watched: false,
			watchedDate: null,
			rating: null,
			review: review.commentText,
			emotion: null,
			isFavorite: false,
			liked: false,
			likedAt: null,
			comfortNote: null,
		});
	}
	report.commentsImported++;
}

async function applyLike(storage: StorageService, like: LikeImport, media: MediaItem, report: ImportReport): Promise<void> {
	if (like.seasonNumber === undefined || like.episodeNumber === undefined) {
		await storage.media.update(media.id, { liked: true, likedAt: like.likedAt });
		report.likesImported++;
		return;
	}

	const episodes = await storage.episodes.findByMediaId(media.id);
	const episode = episodes.find((e) => e.seasonNumber === like.seasonNumber && e.episodeNumber === like.episodeNumber);
	if (!episode) {
		report.skipped++;
		return;
	}
	const progress = await storage.episodeProgress.findByEpisodeId(episode.id);
	if (progress) {
		await storage.episodeProgress.update(progress.id, { liked: true, likedAt: like.likedAt });
	} else {
		await storage.episodeProgress.create({
			mediaId: media.id,
			episodeId: episode.id,
			seasonNumber: episode.seasonNumber,
			episodeNumber: episode.episodeNumber,
			watched: false,
			watchedDate: null,
			rating: null,
			review: null,
			emotion: null,
			isFavorite: false,
			liked: true,
			likedAt: like.likedAt,
			comfortNote: null,
		});
	}
	report.likesImported++;
}

async function applyRating(storage: StorageService, rating: RatingImport, media: MediaItem, report: ImportReport): Promise<void> {
	if (rating.seasonNumber === undefined || rating.episodeNumber === undefined) {
		const sessions = await storage.watchSessions.findByMediaId(media.id);
		const unratedSession = sessions.find((s) => s.rating === null);

		if (unratedSession) {
			await storage.watchSessions.update(unratedSession.id, { rating: rating.rating });
		} else if (sessions.length === 0) {
			await addWatchSession(storage, {
				mediaId: media.id,
				watchDate: rating.ratedAt ?? new Date().toISOString().slice(0, 10),
				rating: rating.rating,
				review: "",
			});
		} else {
			report.skipped++; // every session is already rated — never silently overwrite
			return;
		}
		report.ratingsImported++;
		return;
	}

	const episodes = await storage.episodes.findByMediaId(media.id);
	const episode = episodes.find((e) => e.seasonNumber === rating.seasonNumber && e.episodeNumber === rating.episodeNumber);
	if (!episode) {
		report.skipped++;
		return;
	}
	const progress = await storage.episodeProgress.findByEpisodeId(episode.id);
	if (progress && progress.rating !== null) {
		report.skipped++; // never silently overwrite an existing rating
		return;
	}
	if (progress) {
		await storage.episodeProgress.update(progress.id, { rating: rating.rating });
	} else {
		await storage.episodeProgress.create({
			mediaId: media.id,
			episodeId: episode.id,
			seasonNumber: episode.seasonNumber,
			episodeNumber: episode.episodeNumber,
			watched: false,
			watchedDate: null,
			rating: rating.rating,
			review: null,
			emotion: null,
			isFavorite: false,
			liked: false,
			likedAt: null,
			comfortNote: null,
		});
	}
	report.ratingsImported++;
}

async function applyFavorite(storage: StorageService, media: MediaItem, report: ImportReport): Promise<void> {
	await storage.media.update(media.id, { isFavorite: true });
	report.favoritesImported++;
}

/**
 * Creates or updates the CustomList for one TV Time list. Matched by name
 * against existing imported lists so re-running the same import is
 * idempotent — never creates a duplicate list. When the list already
 * exists, new items are unioned in; nothing is ever removed, so a manual
 * addition the user made locally survives a re-import even if the source
 * list on TV Time has since changed.
 */
async function applyList(storage: StorageService, list: ListImport, mediaIds: string[], report: ImportReport): Promise<void> {
	const existingLists = await storage.customLists.getAll();
	const existing = existingLists.find((l) => l.isImported && l.importSource === list.name);

	if (existing) {
		const missing = mediaIds.filter((id) => !existing.mediaIds.includes(id));
		if (missing.length > 0) {
			await storage.customLists.update(existing.id, { mediaIds: [...existing.mediaIds, ...missing] });
		}
	} else {
		await storage.customLists.create({
			title: list.name,
			description: list.description,
			mediaIds,
			isImported: true,
			importSource: list.name,
		});
	}
	report.listsImported++;
}

/**
 * Writes an entire normalized import bundle into storage: resolves each
 * referenced title to a MediaItem (creating via TMDB only when nothing
 * local matches), then applies watches, reviews, likes, ratings, and
 * favorites through the existing invariant-preserving services —
 * addWatchSession/markEpisodeWatched already trigger StatusService
 * recalculation, so imported media automatically land on the right status.
 */
export type ImportProgressCallback = (done: number, total: number, stage: string) => void;

/**
 * Writes an entire normalized import bundle into storage: resolves each
 * referenced title to a MediaItem (creating via TMDB only when nothing
 * local matches), then applies watches, reviews, likes, ratings, and
 * favorites through the existing invariant-preserving services —
 * addWatchSession/markEpisodeWatched already trigger StatusService
 * recalculation, so imported media automatically land on the right status.
 *
 * Accepts an optional progress callback, called after each item across all
 * five stages with a running (done, total) count plus a human-readable
 * stage label — large imports (hundreds of comments/watches, each
 * potentially a TMDB lookup) can take a while, so the UI has something to
 * show besides a frozen "Importing..." notice.
 */
export async function commitBundle(
	storage: StorageService,
	tmdb: TMDBService,
	bundle: NormalizedImportBundle,
	onProgress?: ImportProgressCallback
): Promise<ImportReport> {
	const report = emptyReport();
	const resolver = new MediaResolver(storage, tmdb, report);

	const total =
		bundle.watches.length +
		bundle.reviews.length +
		bundle.likes.length +
		bundle.ratings.length +
		bundle.favorites.length +
		bundle.lists.length;
	let done = 0;
	const tick = (stage: string) => {
		done++;
		onProgress?.(done, total, stage);
	};

	for (const watch of bundle.watches) {
		const media = await resolver.resolve(watch.ids, watch.title, watch.year, watch.kind);
		if (!media) {
			report.skipped++;
		} else {
			await applyWatch(storage, tmdb, watch, media, report);
		}
		tick("Watch history");
	}

	for (const review of bundle.reviews) {
		const media = await resolver.resolve(review.ids, review.title, review.year, review.kind);
		if (!media) {
			report.skipped++;
		} else {
			await applyReview(storage, review, media, report);
		}
		tick("Comments");
	}

	for (const like of bundle.likes) {
		const media = await resolver.resolve(like.ids, like.title, like.year, like.kind);
		if (!media) {
			report.skipped++;
		} else {
			await applyLike(storage, like, media, report);
		}
		tick("Likes");
	}

	for (const rating of bundle.ratings) {
		const media = await resolver.resolve(rating.ids, rating.title, rating.year, rating.kind);
		if (!media) {
			report.skipped++;
		} else {
			await applyRating(storage, rating, media, report);
		}
		tick("Ratings");
	}

	for (const fav of bundle.favorites) {
		const media = await resolver.resolve(fav.ids, fav.title, fav.year, fav.kind);
		if (!media) {
			report.skipped++;
		} else {
			await applyFavorite(storage, media, report);
		}
		tick("Favorites");
	}

	for (const list of bundle.lists) {
		const mediaIds: string[] = [];
		for (const item of list.items) {
			const media = await resolver.resolve(item.ids, item.title, item.year, item.kind);
			if (media) mediaIds.push(media.id);
			else report.skipped++;
		}
		await applyList(storage, list, mediaIds, report);
		tick("Custom lists");
	}

	report.skipped += bundle.warnings.length;

	return report;
}
