import {
  TMDBRawSearchResultItem,
  TMDBRawMovieDetails,
  TMDBRawTVDetails,
  TMDBRawEpisode,
  TMDBSearchResult,
  TMDBNormalizedDetails,
  TMDBNormalizedEpisode,
  TMDBMediaKind,
} from "../types/tmdb";
import { TMDB_IMAGE_BASE } from "./tmdb-http-client";

// Rough check for "Latin-ish" text (Latin letters/marks, digits, and common
// punctuation/whitespace). Used to decide which of a person's two TMDB name
// fields (`name` / `original_name`) is the romanized/international name we
// should show primarily, vs. the native-script name we keep as secondary
// "Original name" info.
const LATIN_ISH_RE = /^[\x20-\x7E\u00C0-\u024F\u1E00-\u1EFF\s'’.-]+$/;

export function isLatinish(value: string): boolean {
  return LATIN_ISH_RE.test(value);
}

/**
 * Given TMDB's `name` and `original_name` fields for a person credit, pick
 * the romanized/international name to display primarily and the
 * native-script name (if any) to preserve as "original name" info.
 *
 * TMDB's `name` is whatever is set as the person's canonical display name;
 * for many East Asian actors that canonical name is itself stored in native
 * script, with `original_name` mirroring it or vice versa. Whichever of the
 * two is Latin-script wins as the display name; the other, if genuinely
 * different, is kept as the original name.
 */
export function pickPersonNames(
  name: string,
  originalName?: string | null,
): { displayName: string; originalName: string | null } {
  if (!originalName || originalName === name) {
    return { displayName: name, originalName: null };
  }

  const nameIsLatin = isLatinish(name);
  const originalIsLatin = isLatinish(originalName);

  if (nameIsLatin && !originalIsLatin) {
    return { displayName: name, originalName };
  }
  if (!nameIsLatin && originalIsLatin) {
    return { displayName: originalName, originalName: name };
  }
  // Both (or neither) are Latin-script but differ — keep TMDB's `name` as
  // the display name and surface `original_name` as additional info.
  return { displayName: name, originalName };
}

export function tmdbImageUrl(
  path: string | null,
  size: "w200" | "w342" | "w500" | "original" = "w342",
): string | null {
  if (!path) return null;
  return `${TMDB_IMAGE_BASE}/${size}${path}`;
}

export function normalizeSearchResult(
  raw: TMDBRawSearchResultItem,
  mediaKind: TMDBMediaKind,
): TMDBSearchResult {
  const title =
    mediaKind === "movie"
      ? (raw.title ?? raw.name ?? "")
      : (raw.name ?? raw.title ?? "");
  const originalTitle = raw.original_title ?? raw.original_name ?? null;
  const dateStr = mediaKind === "movie" ? raw.release_date : raw.first_air_date;

  return {
    tmdbId: raw.id,
    mediaKind,
    title,
    originalTitle,
    year: extractYear(dateStr),
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    overview: raw.overview ?? "",
    country: raw.origin_country?.[0] ?? null,
    language: raw.original_language ?? null,
    adult: raw.adult,
  };
}

export function normalizeMovieDetails(
  raw: TMDBRawMovieDetails,
): TMDBNormalizedDetails {
  return {
    tmdbId: raw.id,
    mediaKind: "movie",
    title: raw.title,
    originalTitle: raw.original_title ?? null,
    year: extractYear(raw.release_date),
    releaseDate: raw.release_date ?? null,
    runtime: raw.runtime ?? null,
    genres: (raw.genres ?? []).map((g) => g.name),
    genreIds: (raw.genres ?? []).map((g) => g.id),
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    overview: raw.overview ?? "",
    language: raw.original_language ?? null,
    country: raw.origin_country?.[0] ?? null,
    productionCompanies: (raw.production_companies ?? []).map((c) => ({
      tmdbCompanyId: c.id,
      name: c.name,
      logoPath: c.logo_path,
      originCountry: c.origin_country || null,
    })),
    cast: (raw.credits?.cast ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        character: c.character,
        profilePath: c.profile_path,
        order: c.order,
      };
    }),
    crew: (raw.credits?.crew ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        job: c.job,
        department: c.department,
        profilePath: c.profile_path,
      };
    }),
    tmdbRating: raw.vote_average ?? null,
  };
}

export function normalizeTVDetails(
  raw: TMDBRawTVDetails,
): TMDBNormalizedDetails {
  return {
    tmdbId: raw.id,
    mediaKind: "tv",
    title: raw.name,
    originalTitle: raw.original_name ?? null,
    year: extractYear(raw.first_air_date),
    releaseDate: raw.first_air_date ?? null,
    runtime: raw.episode_run_time?.[0] ?? null,
    genres: (raw.genres ?? []).map((g) => g.name),
    genreIds: (raw.genres ?? []).map((g) => g.id),
    posterPath: raw.poster_path,
    backdropPath: raw.backdrop_path,
    overview: raw.overview ?? "",
    language: raw.original_language ?? null,
    country: raw.origin_country?.[0] ?? null,
    productionCompanies: (raw.production_companies ?? []).map((c) => ({
      tmdbCompanyId: c.id,
      name: c.name,
      logoPath: c.logo_path,
      originCountry: c.origin_country || null,
    })),
    cast: (raw.credits?.cast ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        character: c.character,
        profilePath: c.profile_path,
        order: c.order,
      };
    }),
    crew: (raw.credits?.crew ?? []).map((c) => {
      const { displayName, originalName } = pickPersonNames(
        c.name,
        c.original_name,
      );
      return {
        tmdbPersonId: c.id,
        name: displayName,
        originalName,
        job: c.job,
        department: c.department,
        profilePath: c.profile_path,
      };
    }),
    seasons: (raw.seasons ?? [])
      .filter((s) => s.season_number > 0) // exclude "Specials"
      .map((s) => ({
        seasonNumber: s.season_number,
        episodeCount: s.episode_count,
        name: s.name,
        airDate: s.air_date,
      })),
    tvStatus: raw.status,
    tmdbRating: raw.vote_average ?? null,
  };
}

export function normalizeEpisode(raw: TMDBRawEpisode): TMDBNormalizedEpisode {
  return {
    tmdbEpisodeId: raw.id,
    seasonNumber: raw.season_number,
    episodeNumber: raw.episode_number,
    title: raw.name,
    runtime: raw.runtime,
    airDate: raw.air_date,
    synopsis: raw.overview || null,
    thumbnailPath: raw.still_path,
    tmdbRating: raw.vote_average,
  };
}

function extractYear(dateStr: string | null | undefined): number | null {
  if (!dateStr) return null;
  const year = parseInt(dateStr.slice(0, 4), 10);
  return isNaN(year) ? null : year;
}
