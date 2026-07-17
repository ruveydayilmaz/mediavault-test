import { MediaItem } from "../models/media";
import { MediaType, MediaStatus } from "../types/enums";
import { TMDBNormalizedDetails, TMDBMediaKind } from "../types/tmdb";
import { generateId } from "./storage/base-repository";
import type { StorageService } from "./storage";

function mediaKindToType(kind: TMDBMediaKind): MediaType {
	return kind === "movie" ? MediaType.Movie : MediaType.TVShow;
}

/** Builds a fully-formed MediaItem from normalized TMDB details, ready to persist. */
export function buildMediaItemFromTMDB(
	details: TMDBNormalizedDetails,
	externalIds?: { tvdbId?: number | null; imdbId?: string | null; tvTimeUuid?: string | null }
): MediaItem {
	const now = new Date().toISOString();

	return {
		id: generateId(),
		tmdbId: details.tmdbId,
		tvdbId: externalIds?.tvdbId ?? null,
		imdbId: externalIds?.imdbId ?? null,
		tvTimeUuid: externalIds?.tvTimeUuid ?? null,
		type: mediaKindToType(details.mediaKind),
		title: details.title,
		originalTitle: details.originalTitle,
		year: details.year,
		releaseDate: details.releaseDate,
		genres: details.genres,
		runtime: details.runtime,
		posterPath: details.posterPath,
		backdropPath: details.backdropPath,
		cast: details.cast,
		crew: details.crew,
		productionCompanies: details.productionCompanies,
		language: details.language,
		country: details.country,
		synopsis: details.overview || null,
		status: MediaStatus.PlanToWatch,
		tvStatus: details.tvStatus ?? null,
		isFavorite: false,
		liked: false,
		likedAt: null,
		notes: "",
		tags: [],
		averageRating: null,
		watchCount: 0,
		lastWatchedDate: null,
		notePath: null,
		episodesLastSyncedAt: null,
		createdAt: now,
		updatedAt: now,
	};
}

export interface AddMediaResult {
	mediaItem: MediaItem;
	alreadyExisted: boolean;
}

/**
 * Adds a TMDB search result to the library: fetches full details, converts
 * to a MediaItem, and saves it — unless a MediaItem with the same tmdbId +
 * type already exists, in which case the existing item is returned instead
 * of creating a duplicate.
 */
export async function addMediaFromTMDB(
	storage: StorageService,
	tmdb: { getMovie: (id: number) => Promise<TMDBNormalizedDetails>; getTV: (id: number) => Promise<TMDBNormalizedDetails> },
	tmdbId: number,
	kind: TMDBMediaKind
): Promise<AddMediaResult> {
	const type = mediaKindToType(kind);

	const existing = await storage.media.findByTmdbId(tmdbId, type);
	if (existing) {
		return { mediaItem: existing, alreadyExisted: true };
	}

	const details = kind === "movie" ? await tmdb.getMovie(tmdbId) : await tmdb.getTV(tmdbId);
	const mediaItem = buildMediaItemFromTMDB(details);
	await storage.media.save(mediaItem);

	return { mediaItem, alreadyExisted: false };
}
