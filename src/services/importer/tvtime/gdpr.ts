import { parseCSV, RawImportRow } from "../parse";
import {
  parseFlexibleDate,
  extractTitleMetadata,
  TitleMetadata,
} from "../normalize";
import {
  emptyBundle,
  ExternalIds,
  FavoriteImport,
  ListImport,
  MatchMetadata,
  NormalizedImportBundle,
  RatingImport,
  ReviewImport,
  WatchImport,
} from "./types";
import { parseGoMapArray } from "./gdpr-list-parse";

const REACTION_EMOJI: Record<string, string> = {
  "1": "👍",
  "3": "❤️",
  "27": "😴",
  "28": "😢",
  "29": "🤯",
};

export function parseGdprArchive(
  files: Map<string, string>,
): Map<string, NormalizedImportBundle> {
  const parsed = new Map<string, RawImportRow[]>();
  for (const [name, content] of files) {
    if (/\.csv$/i.test(name)) parsed.set(name, parseCSV(content));
  }

  const result = new Map<string, NormalizedImportBundle>();
  const bundleFor = (name: string) => {
    let bundle = result.get(name);
    if (!bundle) {
      bundle = emptyBundle();
      result.set(name, bundle);
    }
    return bundle;
  };

  const seriesById = new Map<string, { title: string; uuid?: string }>();
  for (const name of [
    "followed_tv_show.csv",
    "user_tv_show_data.csv",
    "show_seen_episode_latest.csv",
  ]) {
    for (const row of parsed.get(name) ?? [])
      addSeries(seriesById, row.tv_show_id, row.tv_show_name);
  }
  for (const row of parsed.get("tracking-prod-records-v2.csv") ?? []) {
    addSeries(seriesById, row.s_id, row.series_name, row.uuid);
  }
  for (const row of parsed.get("tracking-prod-records.csv") ?? []) {
    addSeries(seriesById, row.series_id, row.series_name, row.series_uuid);
  }

  for (const [index, row] of (
    parsed.get("tracking-prod-records-v2.csv") ?? []
  ).entries()) {
    const season = number(row.season_number);
    const episode = number(row.episode_number);
    const title = clean(row.series_name);
    if (!title || season === null || episode === null) continue;
    if (looksLikeYearNotSeason(season)) {
      bundleFor("tracking-prod-records-v2.csv").warnings.push({
        row: index + 2,
        reason: `"${title}": entry isn't organized into real TV seasons (season field looks like a year, ${season}). TV Time tracks this as an anthology/collection, which has no TMDB episode equivalent. Skipped.`,
      });
      continue;
    }
    bundleFor("tracking-prod-records-v2.csv").watches.push(
      episodeWatch({
        title,
        season,
        episode,
        watchedAt: row.created_at,
        tvTimeId: row.s_id,
        tvTimeUuid: row.uuid,
        tvTimeEpisodeId: row.episode_id || row.ep_id,
        runtimeSeconds: number(row.runtime),
        sourceRow: index,
      }),
    );
  }

  const v2EpisodeKeys = new Set<string>();
  for (const watch of result.get("tracking-prod-records-v2.csv")?.watches ??
    []) {
    v2EpisodeKeys.add(episodeKey(watch));
  }

  for (const [index, row] of (
    parsed.get("tracking-prod-records.csv") ?? []
  ).entries()) {
    if (row.type !== "watch" && row.type !== "rewatch") continue;
    const watchedAt = epochOrDate(row.watch_date || row.created_at);
    if (
      row.entity_type === "episode" ||
      (row.series_name && row.season_number && row.episode_number)
    ) {
      const season = number(row.season_number),
        episode = number(row.episode_number);
      if (season === null || episode === null || !clean(row.series_name)) {
        bundleFor("tracking-prod-records.csv").warnings.push({
          row: index + 2,
          reason: "Watch event is missing series, season, or episode.",
        });
        continue;
      }
      if (looksLikeYearNotSeason(season)) {
        bundleFor("tracking-prod-records.csv").warnings.push({
          row: index + 2,
          reason: `"${clean(row.series_name)}": entry isn't organized into real TV seasons (season field looks like a year, ${season}). TV Time tracks this as an anthology/collection, which has no TMDB episode equivalent. Skipped.`,
        });
        continue;
      }
      const watch = episodeWatch({
        title: clean(row.series_name)!,
        season,
        episode,
        watchedAt,
        tvTimeId: row.series_id,
        tvTimeUuid: row.series_uuid,
        tvTimeEpisodeId: row.episode_id,
        runtimeSeconds: number(row.runtime),
        sourceRow: index,
      });

      if (!v2EpisodeKeys.has(episodeKey(watch))) {
        bundleFor("tracking-prod-records.csv").watches.push(watch);
      }
    } else if (clean(row.movie_name)) {
      const title = splitTitleYear(clean(row.movie_name)!);
      bundleFor("tracking-prod-records.csv").watches.push({
        kind: "movie",
        ids: {},
        title: title.title,
        year: yearFrom(row.release_date) ?? title.year,
        match: titleMatchHints(title, {
          releaseDate: parseFlexibleDate(row.release_date),
          runtimeSeconds: number(row.runtime),
          country: clean(row.country),
        }),
        watchedAt,
        rewatchCount: 0,
      });
    }
  }

  for (const [index, row] of (
    parsed.get("rewatched_episode.csv") ?? []
  ).entries()) {
    const season = number(row.episode_season_number),
      episode = number(row.episode_number),
      rawTitle = clean(row.tv_show_name);
    if (!rawTitle || season === null || episode === null) continue;
    const parsedTitle = splitTitleYear(rawTitle);
    const count = Math.max(1, number(row.cpt) ?? 1);
    const ids = idsForSeries(seriesById, undefined, undefined, row.episode_id);
    for (let occurrence = 0; occurrence < count; occurrence++) {
      bundleFor("rewatched_episode.csv").watches.push({
        kind: "series",
        ids,
        title: parsedTitle.title,
        year: parsedTitle.year,
        match: titleMatchHints(parsedTitle),
        seasonNumber: season,
        episodeNumber: episode,
        watchedAt: parseFlexibleDate(row.created_at),
        rewatchCount: 1,
      });
    }
    if (count > 20)
      bundleFor("rewatched_episode.csv").warnings.push({
        row: index + 2,
        reason: `Capped suspicious rewatch count for "${rawTitle}".`,
      });
  }

  const primaryEpisodes = new Set<string>();
  for (const name of [
    "tracking-prod-records-v2.csv",
    "tracking-prod-records.csv",
    "rewatched_episode.csv",
  ]) {
    for (const watch of result.get(name)?.watches ?? [])
      primaryEpisodes.add(episodeKey(watch));
  }
  for (const name of [
    "show_seen_episode_latest.csv",
    "seen_episode_latest.csv",
  ]) {
    for (const row of parsed.get(name) ?? []) {
      const rawTitle = clean(row.tv_show_name),
        season = number(row.episode_season_number),
        episode = number(row.episode_number);
      if (!rawTitle || season === null || episode === null) continue;
      const title = splitTitleYear(rawTitle);
      const watch: WatchImport = {
        kind: "series",
        ids: idsForSeries(
          seriesById,
          row.tv_show_id,
          undefined,
          row.episode_id,
        ),
        title: title.title,
        year: title.year,
        match: titleMatchHints(title),
        seasonNumber: season,
        episodeNumber: episode,
        watchedAt: parseFlexibleDate(row.created_at),
        rewatchCount: 0,
      };
      if (!primaryEpisodes.has(episodeKey(watch)))
        bundleFor(name).watches.push(watch);
    }
  }

  for (const name of [
    "ratings-3-prod-episode_votes.csv",
    "ratings-v2-prod-votes.csv",
    "ratings-prod-episode_votes.csv",
  ]) {
    for (const row of parsed.get(name) ?? []) {
      const rawTitle = clean(row.series_name);
      const season = number(row.season_number),
        episode = number(row.episode_number);
      if (!rawTitle || season === null || episode === null) continue;
      const voteValue = extractVoteValue(row.vote_key);
      if (voteValue === null) continue;
      const parsedTitle = splitTitleYear(rawTitle);
      const emoji = REACTION_EMOJI[voteValue] ?? null;
      const rating: RatingImport = {
        kind: "series",
        ids: idsForSeries(seriesById, undefined, row.uuid, row.episode_id),
        title: parsedTitle.title,
        year: parsedTitle.year,
        match: titleMatchHints(parsedTitle),
        seasonNumber: season,
        episodeNumber: episode,
        rating: Number(voteValue),
        emotion: emoji,
        ratedAt: null,
      };
      bundleFor(name).ratings.push(rating);
    }
  }

  for (const row of parsed.get("ratings-live-votes.csv") ?? []) {
    const rawTitle = clean(row.movie_name);
    if (!rawTitle) continue;
    const voteValue = extractVoteValue(row.vote_key);
    if (voteValue === null) continue;
    const parsedTitle = splitTitleYear(rawTitle);
    const emoji = REACTION_EMOJI[voteValue] ?? null;
    const rating: RatingImport = {
      kind: "movie",
      ids: { tvTimeUuid: clean(row.uuid) },
      title: parsedTitle.title,
      year: parsedTitle.year,
      match: titleMatchHints(parsedTitle),
      rating: Number(voteValue),
      emotion: emoji,
      ratedAt: null,
    };
    bundleFor("ratings-live-votes.csv").ratings.push(rating);
  }

  for (const row of parsed.get("comments-prod-comments.csv") ?? []) {
    const text = clean(row.text);
    if (!text) continue;
    if (row.entity_type === "movie") {
      const rawTitle = clean(row.movie_name);
      if (!rawTitle) continue;
      const parsedTitle = splitTitleYear(rawTitle);
      const review: ReviewImport = {
        kind: "movie",
        ids: { tvTimeUuid: clean(row.entity_uuid) ?? clean(row.uuid) },
        title: parsedTitle.title,
        year: parsedTitle.year,
        match: titleMatchHints(parsedTitle),
        commentText: text,
        createdAt: parseFlexibleDate(row.created_at),
        editedAt: parseFlexibleDate(row.updated_at),
      };
      bundleFor("comments-prod-comments.csv").reviews.push(review);
    } else {
      const rawTitle = clean(row.series_name);
      if (!rawTitle) continue;
      const parsedTitle = splitTitleYear(rawTitle);
      const review: ReviewImport = {
        kind: "series",
        ids: { tvTimeUuid: clean(row.entity_uuid) ?? clean(row.uuid) },
        title: parsedTitle.title,
        year: parsedTitle.year,
        match: titleMatchHints(parsedTitle),
        commentText: text,
        createdAt: parseFlexibleDate(row.created_at),
        editedAt: parseFlexibleDate(row.updated_at),
      };
      bundleFor("comments-prod-comments.csv").reviews.push(review);
    }
  }

  for (const row of parsed.get("episode_comment.csv") ?? []) {
    const text = clean(row.comment);
    const rawTitle = clean(row.tv_show_name);
    const season = number(row.episode_season_number);
    const episode = number(row.episode_number);
    if (!text || !rawTitle) continue;
    const parsedTitle = splitTitleYear(rawTitle);
    const review: ReviewImport = {
      kind: "series",
      ids: idsForSeries(seriesById, undefined, undefined, row.episode_id),
      title: parsedTitle.title,
      year: parsedTitle.year,
      match: titleMatchHints(parsedTitle),
      seasonNumber: season ?? undefined,
      episodeNumber: episode ?? undefined,
      commentText: text,
      createdAt: parseFlexibleDate(row.created_at),
      editedAt: parseFlexibleDate(row.updated_at),
    };
    bundleFor("episode_comment.csv").reviews.push(review);
  }

  for (const row of parsed.get("show_comment.csv") ?? []) {
    const text = clean(row.comment);
    const rawTitle = clean(row.tv_show_name);
    if (!text || !rawTitle) continue;
    const parsedTitle = splitTitleYear(rawTitle);
    const review: ReviewImport = {
      kind: "series",
      ids: idsForSeries(seriesById, row.tv_show_id),
      title: parsedTitle.title,
      year: parsedTitle.year,
      match: titleMatchHints(parsedTitle),
      commentText: text,
      createdAt: parseFlexibleDate(row.created_at),
      editedAt: parseFlexibleDate(row.updated_at),
    };
    bundleFor("show_comment.csv").reviews.push(review);
  }

  for (const row of parsed.get("user_show_special_status.csv") ?? []) {
    const rawTitle = clean(row.tv_show_name);
    const status = clean(row.status);
    if (!rawTitle) continue;
    const parsedTitle = splitTitleYear(rawTitle);
    const ids = idsForSeries(seriesById, row.tv_show_id);

    if (status === "for_later") {
      bundleFor("user_show_special_status.csv").watches.push({
        kind: "series",
        ids,
        title: parsedTitle.title,
        year: parsedTitle.year,
        match: titleMatchHints(parsedTitle),
        watchedAt: null,
        rewatchCount: 0,
      });
    } else if (status === "favorite") {
      bundleFor("user_show_special_status.csv").favorites.push({
        kind: "series",
        ids,
        title: parsedTitle.title,
        year: parsedTitle.year,
        match: titleMatchHints(parsedTitle),
      });
    }
  }

  for (const row of parsed.get("user_tv_show_data.csv") ?? []) {
    if (row.is_favorited !== "1") continue;
    const rawTitle = clean(row.tv_show_name);
    if (!rawTitle) continue;
    const parsedTitle = splitTitleYear(rawTitle);
    const fav: FavoriteImport = {
      kind: "series",
      ids: idsForSeries(seriesById, row.tv_show_id),
      title: parsedTitle.title,
      year: parsedTitle.year,
      match: titleMatchHints(parsedTitle),
    };
    bundleFor("user_tv_show_data.csv").favorites.push(fav);
  }

  for (const row of parsed.get("lists-prod-lists.csv") ?? []) {
    const name = clean(row.name);
    if (!name) continue;
    const objectsRaw = row.objects ?? "";
    const items = parseGoMapArray(objectsRaw);
    if (items.length === 0) continue;

    const listImport: ListImport = {
      name,
      description: clean(row.description),
      items: items
        .filter((item) => item.uuid || item.tvTimeId)
        .map((item) => ({
          kind: (item.type === "series" ? "series" : "movie") as
            | "series"
            | "movie",
          ids: { tvTimeUuid: item.uuid, tvTimeId: item.tvTimeId },
          title:
            lookupSeriesTitle(seriesById, item.tvTimeId, item.uuid) ?? name,
          year: null,
        })),
    };
    bundleFor("lists-prod-lists.csv").lists.push(listImport);
  }

  return result;
}

// Helpers
function episodeWatch(input: {
  title: string;
  season: number;
  episode: number;
  watchedAt: string | null;
  tvTimeId?: string;
  tvTimeUuid?: string;
  tvTimeEpisodeId?: string;
  runtimeSeconds: number | null;
  sourceRow: number;
}): WatchImport {
  const title = splitTitleYear(input.title);
  return {
    kind: "series",
    ids: {
      tvTimeId: clean(input.tvTimeId),
      tvTimeUuid: clean(input.tvTimeUuid),
      tvTimeEpisodeId: clean(input.tvTimeEpisodeId),
    },
    title: title.title,
    year: title.year,
    match: { runtimeSeconds: input.runtimeSeconds },
    seasonNumber: input.season,
    episodeNumber: input.episode,
    watchedAt: epochOrDate(input.watchedAt),
    rewatchCount: 0,
  };
}

function addSeries(
  map: Map<string, { title: string; uuid?: string }>,
  id: string | undefined,
  title: string | undefined,
  uuid?: string,
): void {
  const key = clean(id),
    name = clean(title);
  if (key && name)
    map.set(key, { title: name, uuid: clean(uuid) ?? undefined });
}
function idsForSeries(
  map: Map<string, { title: string; uuid?: string }>,
  id?: string,
  uuid?: string,
  episodeId?: string,
): ExternalIds {
  return {
    tvTimeId: clean(id),
    tvTimeUuid:
      clean(uuid) ?? (clean(id) ? (map.get(clean(id)!)?.uuid ?? null) : null),
    tvTimeEpisodeId: clean(episodeId),
  };
}

function lookupSeriesTitle(
  map: Map<string, { title: string; uuid?: string }>,
  id: string | null,
  uuid: string | null,
): string | null {
  if (id) {
    const entry = map.get(id);
    if (entry) return entry.title;
  }
  if (uuid) {
    for (const entry of map.values()) {
      if (entry.uuid === uuid) return entry.title;
    }
  }
  return null;
}

function extractVoteValue(voteKey: string | undefined): string | null {
  if (!voteKey) return null;
  const parts = voteKey.split("-");
  if (parts.length < 2) return null;
  const last = parts[parts.length - 1];
  return /^\d+$/.test(last) ? last : null;
}

function clean(value?: string | null): string | null {
  const v = value?.trim();
  return v ? v : null;
}
function number(value?: string | null): number | null {
  const n = Number(value);
  return Number.isFinite(n) && n >= 0 ? n : null;
}

function looksLikeYearNotSeason(season: number): boolean {
  return season >= 1900;
}
function yearFrom(value?: string | null): number | null {
  const match = value?.match(/^(\d{4})/);
  return match ? Number(match[1]) : null;
}

function splitTitleYear(title: string): TitleMetadata {
  return extractTitleMetadata(title);
}

function titleMatchHints(
  meta: TitleMetadata,
  extra?: MatchMetadata,
): MatchMetadata | undefined {
  const hasHints =
    meta.country !== null ||
    meta.language !== null ||
    meta.alternateTitle !== null;
  if (!hasHints && !extra) return undefined;
  return {
    ...extra,
    country: extra?.country ?? meta.country ?? undefined,
    language: meta.language ?? undefined,
    originalTitle: extra?.originalTitle ?? meta.alternateTitle ?? undefined,
  };
}
function epochOrDate(value?: string | null): string | null {
  if (value && /^\d{10}(?:\.\d+)?$/.test(value))
    return new Date(Number(value) * 1000).toISOString().slice(0, 10);
  return parseFlexibleDate(value ?? null);
}
function episodeKey(watch: WatchImport): string {
  return watch.ids.tvTimeEpisodeId
    ? `id:${watch.ids.tvTimeEpisodeId}`
    : `${watch.title.toLowerCase()}|${watch.seasonNumber}|${watch.episodeNumber}`;
}
