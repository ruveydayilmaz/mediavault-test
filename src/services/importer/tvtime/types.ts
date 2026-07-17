/**
 * Common internal models every TV Time importer (JSON or CSV, whatever
 * category) normalizes into. Nothing downstream of ImportManager ever
 * looks at raw TV Time JSON/CSV shapes again — it only sees these.
 */

/** Identifies a title across services. At least one field should be present. */
export interface ExternalIds {
	tvdbId?: number | null;
	imdbId?: string | null;
	tvTimeUuid?: string | null;
}

export type ImportMediaKind = "movie" | "series";

/** A single watch event — one movie watch, or one episode watch. */
export interface WatchImport {
	kind: ImportMediaKind;
	ids: ExternalIds;
	title: string;
	year: number | null;
	/** Episode-only. */
	seasonNumber?: number;
	episodeNumber?: number;
	episodeTitle?: string;
	watchedAt: string | null; // ISO date, best-effort parsed; null if TV Time didn't record one
	rewatchCount: number;
}

/** A comment/review attached to a movie or a specific episode. */
export interface ReviewImport {
	kind: ImportMediaKind;
	ids: ExternalIds;
	title: string;
	year: number | null;
	seasonNumber?: number;
	episodeNumber?: number;
	commentText: string;
	createdAt: string | null;
	editedAt: string | null;
}

/** A "liked" flag on a movie or episode. */
export interface LikeImport {
	kind: ImportMediaKind;
	ids: ExternalIds;
	title: string;
	year: number | null;
	seasonNumber?: number;
	episodeNumber?: number;
	likedAt: string | null;
}

/** A user rating on a movie or show/episode. */
export interface RatingImport {
	kind: ImportMediaKind;
	ids: ExternalIds;
	title: string;
	year: number | null;
	seasonNumber?: number;
	episodeNumber?: number;
	rating: number;
	ratedAt: string | null;
}

/** A "favorited" flag on a movie or show. */
export interface FavoriteImport {
	kind: ImportMediaKind;
	ids: ExternalIds;
	title: string;
	year: number | null;
}

/** One item referenced by a custom list — same identity fields as everything else, so it resolves through the same MediaResolver. */
export interface ListImportItem {
	kind: ImportMediaKind;
	ids: ExternalIds;
	title: string;
	year: number | null;
}

/** A user-created TV Time custom list ("Costume C-Drama", etc.), detected and now actually imported (roadmap Milestone 5). */
export interface ListImport {
	name: string;
	description: string | null;
	items: ListImportItem[];
}

/** Everything one importer run produced, in the shared shape. */
export interface NormalizedImportBundle {
	watches: WatchImport[];
	reviews: ReviewImport[];
	likes: LikeImport[];
	ratings: RatingImport[];
	favorites: FavoriteImport[];
	lists: ListImport[];
	/** Rows that couldn't be parsed, with a reason and (when available) a row number, for the error summary. */
	warnings: { row?: number; reason: string }[];
}

export function emptyBundle(): NormalizedImportBundle {
	return { watches: [], reviews: [], likes: [], ratings: [], favorites: [], lists: [], warnings: [] };
}

export function mergeBundles(bundles: NormalizedImportBundle[]): NormalizedImportBundle {
	const result = emptyBundle();
	for (const b of bundles) {
		result.watches.push(...b.watches);
		result.reviews.push(...b.reviews);
		result.likes.push(...b.likes);
		result.ratings.push(...b.ratings);
		result.favorites.push(...b.favorites);
		result.lists.push(...b.lists);
		result.warnings.push(...b.warnings);
	}
	return result;
}

/**
 * Every export category MediaVault currently recognizes. New categories
 * should only require: (1) a new value here, (2) a new importer module
 * implementing TVTimeImporter, (3) one line registering it in
 * manager.ts's importer list. Nothing else in the plugin needs to change.
 */
export type ImportCategory =
	| "json_movie"
	| "json_series"
	| "json_list" // a user custom list — imported as a CustomList, see json-list.ts
	| "csv_followed_shows"
	| "csv_watched_episodes"
	| "csv_watched_movies"
	| "csv_comments"
	| "csv_likes"
	| "csv_ratings"
	| "csv_favorites"
	| "unknown";

export interface DetectionResult {
	format: "json" | "csv";
	category: ImportCategory;
	/** Human-readable label for the preview screen, e.g. "Episode Comments". */
	label: string;
}

/**
 * The shared interface every importer strategy implements. ImportManager
 * only ever talks to importers through this — it never knows or cares
 * whether a given category is JSON or CSV under the hood.
 */
export interface TVTimeImporter {
	category: ImportCategory;
	label: string;
	/** Cheap structural check: does this parsed content look like this importer's category? */
	detect(parsed: unknown, format: "json" | "csv"): boolean;
	/** Parses already-format-parsed content (JSON value, or CSV rows) into the common models. */
	parse(parsed: unknown): NormalizedImportBundle;
}
