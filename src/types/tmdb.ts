/**
 * Types for TMDB API responses. "Raw" types mirror TMDB's actual JSON shape
 * (snake_case, minimal fields we care about). "Normalized" types are what
 * TMDBService returns to the rest of the plugin — camelCase, pruned to what
 * MediaVault's models need, ready to feed into NewMediaItemInput etc.
 */

export type TMDBMediaKind = "movie" | "tv";

// ---- Raw TMDB shapes (subset of fields actually used) ----

export interface TMDBRawSearchResultItem {
	id: number;
	title?: string; // movie
	name?: string; // tv
	original_title?: string;
	original_name?: string;
	release_date?: string; // movie
	first_air_date?: string; // tv
	poster_path: string | null;
	backdrop_path: string | null;
	overview: string;
	genre_ids?: number[];
	media_type?: string;
	/** TV search results only — TMDB does not return this for movie search results. */
	origin_country?: string[];
	original_language?: string;
}

export interface TMDBRawSearchResponse {
	page: number;
	total_pages: number;
	total_results: number;
	results: TMDBRawSearchResultItem[];
}

export interface TMDBRawGenre {
	id: number;
	name: string;
}

export interface TMDBRawProductionCompany {
	id: number;
	name: string;
	logo_path: string | null;
	origin_country: string;
}

export interface TMDBRawCastMember {
	id: number;
	name: string;
	character: string;
	profile_path: string | null;
	order: number;
}

export interface TMDBRawCrewMember {
	id: number;
	name: string;
	job: string;
	department: string;
	profile_path: string | null;
}

export interface TMDBRawCredits {
	cast: TMDBRawCastMember[];
	crew: TMDBRawCrewMember[];
}

export interface TMDBRawMovieDetails {
	id: number;
	title: string;
	original_title: string;
	release_date: string | null;
	runtime: number | null;
	genres: TMDBRawGenre[];
	poster_path: string | null;
	backdrop_path: string | null;
	overview: string;
	production_companies: TMDBRawProductionCompany[];
	original_language: string | null;
	origin_country?: string[];
	credits?: TMDBRawCredits;
	vote_average?: number | null;
}

export interface TMDBRawTVDetails {
	id: number;
	name: string;
	original_name: string;
	first_air_date: string | null;
	episode_run_time: number[];
	genres: TMDBRawGenre[];
	poster_path: string | null;
	backdrop_path: string | null;
	overview: string;
	production_companies: TMDBRawProductionCompany[];
	original_language: string | null;
	origin_country?: string[];
	number_of_seasons: number;
	number_of_episodes: number;
	/** e.g. "Returning Series", "Ended", "Canceled", "In Production", "Planned", "Pilot" */
	status?: string;
	credits?: TMDBRawCredits;
	seasons?: TMDBRawSeasonSummary[];
	vote_average?: number | null;
}

export interface TMDBRawSeasonSummary {
	season_number: number;
	episode_count: number;
	name: string;
	air_date: string | null;
}

export interface TMDBRawEpisode {
	id: number;
	season_number: number;
	episode_number: number;
	name: string;
	runtime: number | null;
	air_date: string | null;
	overview: string;
	still_path: string | null;
	vote_average: number | null;
}

export interface TMDBRawSeasonDetails {
	season_number: number;
	episodes: TMDBRawEpisode[];
}

// ---- Normalized shapes returned by TMDBService ----

export interface TMDBSearchResult {
	tmdbId: number;
	mediaKind: TMDBMediaKind;
	title: string;
	originalTitle: string | null;
	year: number | null;
	posterPath: string | null;
	backdropPath: string | null;
	overview: string;
	/** Origin country (TV only — TMDB's search endpoint doesn't return this for movies), used as a matching hint. */
	country: string | null;
	/** Original language code, used as a secondary matching hint alongside country. */
	language: string | null;
}

export interface TMDBNormalizedDetails {
	tmdbId: number;
	mediaKind: TMDBMediaKind;
	title: string;
	originalTitle: string | null;
	year: number | null;
	/** Movie release date, or TV first-air date — full ISO date where TMDB provides one, not just the year. Used by Watch Next's "Upcoming" tab. */
	releaseDate: string | null;
	runtime: number | null;
	genres: string[];
	posterPath: string | null;
	backdropPath: string | null;
	overview: string;
	language: string | null;
	country: string | null;
	productionCompanies: {
		tmdbCompanyId: number;
		name: string;
		logoPath: string | null;
		originCountry: string | null;
	}[];
	cast: {
		tmdbPersonId: number;
		name: string;
		character: string;
		profilePath: string | null;
		order: number;
	}[];
	crew: {
		tmdbPersonId: number;
		name: string;
		job: string;
		department: string;
		profilePath: string | null;
	}[];
	/** TV-only: season summaries for driving episode import */
	seasons?: {
		seasonNumber: number;
		episodeCount: number;
		name: string;
		airDate: string | null;
	}[];
	/** TV-only: TMDB's raw show status (e.g. "Returning Series", "Ended"), used to distinguish "Finished" from "Waiting for New Season". */
	tvStatus?: string;
	/** TMDB's public vote average (0-10), shown in Filmography Preview mode where there's no local averageRating yet. */
	tmdbRating: number | null;
}

export interface TMDBNormalizedEpisode {
	tmdbEpisodeId: number;
	seasonNumber: number;
	episodeNumber: number;
	title: string;
	runtime: number | null;
	airDate: string | null;
	synopsis: string | null;
	thumbnailPath: string | null;
	tmdbRating: number | null;
}

// ---- Images (Milestone 3: Media Details Modal Redesign — poster/banner picker) ----

export interface TMDBRawImage {
	file_path: string;
	width: number;
	height: number;
	aspect_ratio: number;
	vote_average?: number;
	iso_639_1?: string | null;
}

export interface TMDBRawImagesResponse {
	id: number;
	posters: TMDBRawImage[];
	backdrops: TMDBRawImage[];
}

/** A single selectable image in the poster/banner picker, already normalized to a plain file path. */
export interface TMDBImageOption {
	filePath: string;
	width: number;
	height: number;
}

export interface TMDBImageOptions {
	posters: TMDBImageOption[];
	backdrops: TMDBImageOption[];
}

// ---- Person / Cast & Filmography (Milestone 4: Cast & Filmography System) ----

export interface TMDBRawCombinedCreditItem {
	id: number;
	media_type: "movie" | "tv" | string;
	title?: string;
	name?: string;
	poster_path?: string | null;
	release_date?: string;
	first_air_date?: string;
	character?: string;
	popularity?: number;
	genre_ids?: number[];
}

export interface TMDBRawPersonDetails {
	id: number;
	name: string;
	profile_path?: string | null;
	birthday?: string | null;
	place_of_birth?: string | null;
	combined_credits?: {
		cast?: TMDBRawCombinedCreditItem[];
	};
}

export interface TMDBFilmographyItem {
	tmdbId: number;
	mediaKind: "movie" | "tv";
	category: "movie" | "tv_series" | "tv_program";
	title: string;
	posterPath: string | null;
	year: string | null;
	character: string | null;
	popularity: number;
}

export interface TMDBPersonDetails {
	tmdbPersonId: number;
	name: string;
	profilePath: string | null;
	birthday: string | null;
	placeOfBirth: string | null;
	filmography: TMDBFilmographyItem[];
}
