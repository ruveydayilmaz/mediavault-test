export interface ExternalIds {
  tvdbId?: number | null;
  imdbId?: string | null;
  tvTimeUuid?: string | null;
  tvTimeId?: string | null;
  tvTimeEpisodeId?: string | null;
}

export interface MatchMetadata {
  originalTitle?: string | null;
  releaseDate?: string | null;
  runtimeSeconds?: number | null;
  country?: string | null;
  language?: string | null;
}

export type ImportMediaKind = "movie" | "series";

export interface WatchImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;

  seasonNumber?: number;
  episodeNumber?: number;
  episodeTitle?: string;
  watchedAt: string | null;
  rewatchCount: number;
}

export interface ReviewImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
  seasonNumber?: number;
  episodeNumber?: number;
  commentText: string;
  createdAt: string | null;
  editedAt: string | null;
}

export interface LikeImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
  seasonNumber?: number;
  episodeNumber?: number;
  likedAt: string | null;
}

export interface RatingImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
  seasonNumber?: number;
  episodeNumber?: number;
  rating: number;
  emotion?: string | null;
  ratedAt: string | null;
}

export interface FavoriteImport {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
}

export interface ListImportItem {
  kind: ImportMediaKind;
  ids: ExternalIds;
  title: string;
  year: number | null;
  match?: MatchMetadata;
}

export interface ListImport {
  name: string;
  description: string | null;
  items: ListImportItem[];
  /**
   * Stable identity for this list, independent of the (mutable, possibly
   * duplicated) display `name`. Used to match a list across re-imports so
   * distinct lists never collapse into one, and so the same list updates
   * in place instead of duplicating on re-import.
   */
  sourceKey: string;
}

export interface NormalizedImportBundle {
  watches: WatchImport[];
  reviews: ReviewImport[];
  likes: LikeImport[];
  ratings: RatingImport[];
  favorites: FavoriteImport[];
  lists: ListImport[];
  warnings: { row?: number; reason: string }[];
}

export function emptyBundle(): NormalizedImportBundle {
  return {
    watches: [],
    reviews: [],
    likes: [],
    ratings: [],
    favorites: [],
    lists: [],
    warnings: [],
  };
}

export function mergeBundles(
  bundles: NormalizedImportBundle[],
): NormalizedImportBundle {
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

export type ImportCategory =
  | "json_movie"
  | "json_series"
  | "json_list"
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
  label: string;
}

export interface TVTimeImporter {
  category: ImportCategory;
  label: string;
  detect(parsed: unknown, format: "json" | "csv"): boolean;
  parse(parsed: unknown): NormalizedImportBundle;
}
