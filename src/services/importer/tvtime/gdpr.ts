import { parseCSV, RawImportRow } from "../parse";
import { parseFlexibleDate, extractTitleMetadata, TitleMetadata } from "../normalize";
import { emptyBundle, ExternalIds, FavoriteImport, ListImport, MatchMetadata, NormalizedImportBundle, RatingImport, ReviewImport, WatchImport } from "./types";
import { parseGoMapArray } from "./gdpr-list-parse";

/**
 * TV Time reaction codes embedded in `vote_key` suffixes, mapped to emoji.
 * TV Time does not use 1-10 numeric ratings — these are emoji reactions
 * applied to episodes and movies. Imported as `emotion` on EpisodeProgress /
 * EpisodeWatch rather than as a numeric `rating`.
 */
const REACTION_EMOJI: Record<string, string> = {
	"1": "👍",  // like
	"3": "❤️", // heart / love
	"27": "😴", // bored
	"28": "😢", // sad / cry
	"29": "🤯", // mind-blown / wow
};

/**
 * Parser for TV Time's current GDPR archive. This is intentionally archive-aware:
 * TV Time spreads a single watch history across several tracking tables and its
 * numeric ids only identify records inside that archive (they are not TVDB ids).
 */
export function parseGdprArchive(files: Map<string, string>): Map<string, NormalizedImportBundle> {
	const parsed = new Map<string, RawImportRow[]>();
	for (const [name, content] of files) {
		if (/\.csv$/i.test(name)) parsed.set(name, parseCSV(content));
	}

	const result = new Map<string, NormalizedImportBundle>();
	const bundleFor = (name: string) => {
		let bundle = result.get(name);
		if (!bundle) { bundle = emptyBundle(); result.set(name, bundle); }
		return bundle;
	};

	// ── Series lookup table ────────────────────────────────────────────
	const seriesById = new Map<string, { title: string; uuid?: string }>();
	for (const name of ["followed_tv_show.csv", "user_tv_show_data.csv", "show_seen_episode_latest.csv"]) {
		for (const row of parsed.get(name) ?? []) addSeries(seriesById, row.tv_show_id, row.tv_show_name);
	}
	for (const row of parsed.get("tracking-prod-records-v2.csv") ?? []) {
		addSeries(seriesById, row.s_id, row.series_name, row.uuid);
	}
	for (const row of parsed.get("tracking-prod-records.csv") ?? []) {
		addSeries(seriesById, row.series_id, row.series_name, row.series_uuid);
	}

	// ── V2 tracking (principal episode event log) ──────────────────────
	// The v2 table is the principal, high-volume episode event log. It contains
	// both ordinary and bulk-fill watches, all of which are real watches.
	for (const [index, row] of (parsed.get("tracking-prod-records-v2.csv") ?? []).entries()) {
		const season = number(row.season_number);
		const episode = number(row.episode_number);
		const title = clean(row.series_name);
		if (!title || season === null || episode === null) continue; // user-series/statistics rows, not events
		if (looksLikeYearNotSeason(season)) {
			bundleFor("tracking-prod-records-v2.csv").warnings.push({
				row: index + 2,
				reason: `"${title}": entry isn't organized into real TV seasons (season field looks like a year, ${season}) — TV Time tracks this as an anthology/collection, which has no TMDB episode equivalent. Skipped.`,
			});
			continue;
		}
		bundleFor("tracking-prod-records-v2.csv").watches.push(episodeWatch({
			title, season, episode, watchedAt: row.created_at, tvTimeId: row.s_id,
			tvTimeUuid: row.uuid, tvTimeEpisodeId: row.episode_id || row.ep_id,
			runtimeSeconds: number(row.runtime), sourceRow: index,
		}));
	}

	// ── V1 tracking (older events + movie watches) ─────────────────────
	// Collect V2 episode keys first so V1 episode watches that duplicate a V2
	// event are skipped. V1 movie watches are always kept (V2 has no movies).
	const v2EpisodeKeys = new Set<string>();
	for (const watch of result.get("tracking-prod-records-v2.csv")?.watches ?? []) {
		v2EpisodeKeys.add(episodeKey(watch));
	}

	// Older tracking records include both per-episode and movie watches. This
	// table is not redundant with v2 (it preserves older events and movie data).
	// `type: "rewatch"` rows are real rewatch events (same shape as "watch",
	// entity_type "movie") — previously dropped by this filter entirely, a
	// silent loss of real watch history rather than a warning or skip.
	for (const [index, row] of (parsed.get("tracking-prod-records.csv") ?? []).entries()) {
		if (row.type !== "watch" && row.type !== "rewatch") continue;
		const watchedAt = epochOrDate(row.watch_date || row.created_at);
		if (row.entity_type === "episode" || (row.series_name && row.season_number && row.episode_number)) {
			const season = number(row.season_number), episode = number(row.episode_number);
			if (season === null || episode === null || !clean(row.series_name)) {
				bundleFor("tracking-prod-records.csv").warnings.push({ row: index + 2, reason: "Watch event is missing series, season, or episode." });
				continue;
			}
			if (looksLikeYearNotSeason(season)) {
				bundleFor("tracking-prod-records.csv").warnings.push({
					row: index + 2,
					reason: `"${clean(row.series_name)}": entry isn't organized into real TV seasons (season field looks like a year, ${season}) — TV Time tracks this as an anthology/collection, which has no TMDB episode equivalent. Skipped.`,
				});
				continue;
			}
			const watch = episodeWatch({
				title: clean(row.series_name)!, season, episode, watchedAt, tvTimeId: row.series_id,
				tvTimeUuid: row.series_uuid, tvTimeEpisodeId: row.episode_id, runtimeSeconds: number(row.runtime), sourceRow: index,
			});
			// Deduplicate: skip if the same episode already exists in V2
			if (!v2EpisodeKeys.has(episodeKey(watch))) {
				bundleFor("tracking-prod-records.csv").watches.push(watch);
			}
		} else if (clean(row.movie_name)) {
			const title = splitTitleYear(clean(row.movie_name)!);
			bundleFor("tracking-prod-records.csv").watches.push({
				// `uuid` is the watch-event id in this table, not a media id.
				kind: "movie", ids: {}, title: title.title, year: yearFrom(row.release_date) ?? title.year,
				match: titleMatchHints(title, { releaseDate: parseFlexibleDate(row.release_date), runtimeSeconds: number(row.runtime), country: clean(row.country) }),
				watchedAt, rewatchCount: 0,
			});
		}
	}

	// ── Rewatch episodes ───────────────────────────────────────────────
	// A rewatched_episode row represents extra watches; cpt is the number of
	// additional viewings, rather than a replacement for the original watch.
	for (const [index, row] of (parsed.get("rewatched_episode.csv") ?? []).entries()) {
		const season = number(row.episode_season_number), episode = number(row.episode_number), rawTitle = clean(row.tv_show_name);
		if (!rawTitle || season === null || episode === null) continue;
		const parsedTitle = splitTitleYear(rawTitle);
		const count = Math.max(1, number(row.cpt) ?? 1);
		const ids = idsForSeries(seriesById, undefined, undefined, row.episode_id);
		for (let occurrence = 0; occurrence < count; occurrence++) {
			bundleFor("rewatched_episode.csv").watches.push({ kind: "series", ids, title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle), seasonNumber: season, episodeNumber: episode, watchedAt: parseFlexibleDate(row.created_at), rewatchCount: 1 });
		}
		if (count > 20) bundleFor("rewatched_episode.csv").warnings.push({ row: index + 2, reason: `Capped suspicious rewatch count for "${rawTitle}".` });
	}

	// ── Latest-state fallbacks ─────────────────────────────────────────
	// These tables are latest-state fallbacks. Do not manufacture the earlier
	// episodes; when full tracking data is present, duplicate state rows are
	// deliberately excluded by episode id/title+number.
	const primaryEpisodes = new Set<string>();
	for (const name of ["tracking-prod-records-v2.csv", "tracking-prod-records.csv", "rewatched_episode.csv"]) {
		for (const watch of result.get(name)?.watches ?? []) primaryEpisodes.add(episodeKey(watch));
	}
	for (const name of ["show_seen_episode_latest.csv", "seen_episode_latest.csv"]) {
		for (const row of parsed.get(name) ?? []) {
			const rawTitle = clean(row.tv_show_name), season = number(row.episode_season_number), episode = number(row.episode_number);
			if (!rawTitle || season === null || episode === null) continue;
			const title = splitTitleYear(rawTitle);
			const watch: WatchImport = { kind: "series", ids: idsForSeries(seriesById, row.tv_show_id, undefined, row.episode_id), title: title.title, year: title.year, match: titleMatchHints(title), seasonNumber: season, episodeNumber: episode, watchedAt: parseFlexibleDate(row.created_at), rewatchCount: 0 };
			if (!primaryEpisodes.has(episodeKey(watch))) bundleFor(name).watches.push(watch);
		}
	}

	// ── Ratings → emotions ─────────────────────────────────────────────
	// TV Time's GDPR export contains four rating/vote files. The vote value
	// is encoded in the `vote_key` suffix (e.g. "3909-29317850-3" → "3").
	// These are reaction codes, not numeric 1-10 ratings.

	// Episode rating files (share similar schemas)
	for (const name of [
		"ratings-3-prod-episode_votes.csv",
		"ratings-v2-prod-votes.csv",
		"ratings-prod-episode_votes.csv",
	]) {
		for (const row of parsed.get(name) ?? []) {
			const rawTitle = clean(row.series_name);
			const season = number(row.season_number), episode = number(row.episode_number);
			if (!rawTitle || season === null || episode === null) continue;
			const voteValue = extractVoteValue(row.vote_key);
			if (voteValue === null) continue;
			const parsedTitle = splitTitleYear(rawTitle);
			const emoji = REACTION_EMOJI[voteValue] ?? null;
			const rating: RatingImport = {
				kind: "series", ids: idsForSeries(seriesById, undefined, row.uuid, row.episode_id),
				title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle), seasonNumber: season, episodeNumber: episode,
				rating: Number(voteValue), emotion: emoji, ratedAt: null,
			};
			bundleFor(name).ratings.push(rating);
		}
	}

	// Movie rating file (ratings-live-votes.csv): has movie_name, episode_id=0
	for (const row of parsed.get("ratings-live-votes.csv") ?? []) {
		const rawTitle = clean(row.movie_name);
		if (!rawTitle) continue;
		const voteValue = extractVoteValue(row.vote_key);
		if (voteValue === null) continue;
		const parsedTitle = splitTitleYear(rawTitle);
		const emoji = REACTION_EMOJI[voteValue] ?? null;
		const rating: RatingImport = {
			kind: "movie", ids: { tvTimeUuid: clean(row.uuid) },
			title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
			rating: Number(voteValue), emotion: emoji, ratedAt: null,
		};
		bundleFor("ratings-live-votes.csv").ratings.push(rating);
	}

	// ── Comments / Reviews ─────────────────────────────────────────────
	// comments-prod-comments.csv: unified comment table (movies + shows)
	for (const row of parsed.get("comments-prod-comments.csv") ?? []) {
		const text = clean(row.text);
		if (!text) continue;
		if (row.entity_type === "movie") {
			const rawTitle = clean(row.movie_name);
			if (!rawTitle) continue;
			const parsedTitle = splitTitleYear(rawTitle);
			const review: ReviewImport = {
				kind: "movie", ids: { tvTimeUuid: clean(row.entity_uuid) ?? clean(row.uuid) },
				title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
				commentText: text, createdAt: parseFlexibleDate(row.created_at), editedAt: parseFlexibleDate(row.updated_at),
			};
			bundleFor("comments-prod-comments.csv").reviews.push(review);
		} else {
			// Series/show-level comment (no season/episode)
			const rawTitle = clean(row.series_name);
			if (!rawTitle) continue;
			const parsedTitle = splitTitleYear(rawTitle);
			const review: ReviewImport = {
				kind: "series", ids: { tvTimeUuid: clean(row.entity_uuid) ?? clean(row.uuid) },
				title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
				commentText: text, createdAt: parseFlexibleDate(row.created_at), editedAt: parseFlexibleDate(row.updated_at),
			};
			bundleFor("comments-prod-comments.csv").reviews.push(review);
		}
	}

	// episode_comment.csv: per-episode comments with season/episode numbers
	for (const row of parsed.get("episode_comment.csv") ?? []) {
		const text = clean(row.comment);
		const rawTitle = clean(row.tv_show_name);
		const season = number(row.episode_season_number);
		const episode = number(row.episode_number);
		if (!text || !rawTitle) continue;
		const parsedTitle = splitTitleYear(rawTitle);
		const review: ReviewImport = {
			kind: "series", ids: idsForSeries(seriesById, undefined, undefined, row.episode_id),
			title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
			seasonNumber: season ?? undefined, episodeNumber: episode ?? undefined,
			commentText: text, createdAt: parseFlexibleDate(row.created_at), editedAt: parseFlexibleDate(row.updated_at),
		};
		bundleFor("episode_comment.csv").reviews.push(review);
	}

	// show_comment.csv: show-level comments
	for (const row of parsed.get("show_comment.csv") ?? []) {
		const text = clean(row.comment);
		const rawTitle = clean(row.tv_show_name);
		if (!text || !rawTitle) continue;
		const parsedTitle = splitTitleYear(rawTitle);
		const review: ReviewImport = {
			kind: "series", ids: idsForSeries(seriesById, row.tv_show_id),
			title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
			commentText: text, createdAt: parseFlexibleDate(row.created_at), editedAt: parseFlexibleDate(row.updated_at),
		};
		bundleFor("show_comment.csv").reviews.push(review);
	}

	// ── Special statuses (for_later → Plan to Watch, favorite) ─────────
	for (const row of parsed.get("user_show_special_status.csv") ?? []) {
		const rawTitle = clean(row.tv_show_name);
		const status = clean(row.status);
		if (!rawTitle) continue;
		const parsedTitle = splitTitleYear(rawTitle);
		const ids = idsForSeries(seriesById, row.tv_show_id);

		if (status === "for_later") {
			// Import as a watch with no date — commit.ts will set the media to
			// PlanToWatch status when it sees a watch with no watchedAt.
			bundleFor("user_show_special_status.csv").watches.push({
				kind: "series", ids, title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
				watchedAt: null, rewatchCount: 0,
			});
		} else if (status === "favorite") {
			bundleFor("user_show_special_status.csv").favorites.push({
				kind: "series", ids, title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
			});
		}
	}

	// ── Favorites from user_tv_show_data.csv ───────────────────────────
	for (const row of parsed.get("user_tv_show_data.csv") ?? []) {
		if (row.is_favorited !== "1") continue;
		const rawTitle = clean(row.tv_show_name);
		if (!rawTitle) continue;
		const parsedTitle = splitTitleYear(rawTitle);
		const fav: FavoriteImport = {
			kind: "series", ids: idsForSeries(seriesById, row.tv_show_id),
			title: parsedTitle.title, year: parsedTitle.year, match: titleMatchHints(parsedTitle),
		};
		bundleFor("user_tv_show_data.csv").favorites.push(fav);
	}

	// ── Custom lists (Go map format) ───────────────────────────────────
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
					kind: (item.type === "series" ? "series" : "movie") as "series" | "movie",
					ids: { tvTimeUuid: item.uuid, tvTimeId: item.tvTimeId },
					title: lookupSeriesTitle(seriesById, item.tvTimeId, item.uuid) ?? name,
					year: null,
				})),
		};
		bundleFor("lists-prod-lists.csv").lists.push(listImport);
	}

	return result;
}

// ── Helpers ────────────────────────────────────────────────────────────

function episodeWatch(input: { title: string; season: number; episode: number; watchedAt: string | null; tvTimeId?: string; tvTimeUuid?: string; tvTimeEpisodeId?: string; runtimeSeconds: number | null; sourceRow: number }): WatchImport {
	const title = splitTitleYear(input.title);
	return { kind: "series", ids: { tvTimeId: clean(input.tvTimeId), tvTimeUuid: clean(input.tvTimeUuid), tvTimeEpisodeId: clean(input.tvTimeEpisodeId) }, title: title.title, year: title.year, match: { runtimeSeconds: input.runtimeSeconds }, seasonNumber: input.season, episodeNumber: input.episode, watchedAt: epochOrDate(input.watchedAt), rewatchCount: 0 };
}

function addSeries(map: Map<string, { title: string; uuid?: string }>, id: string | undefined, title: string | undefined, uuid?: string): void {
	const key = clean(id), name = clean(title);
	if (key && name) map.set(key, { title: name, uuid: clean(uuid) ?? undefined });
}
function idsForSeries(map: Map<string, { title: string; uuid?: string }>, id?: string, uuid?: string, episodeId?: string): ExternalIds {
	return { tvTimeId: clean(id), tvTimeUuid: clean(uuid) ?? (clean(id) ? map.get(clean(id)!)?.uuid ?? null : null), tvTimeEpisodeId: clean(episodeId) };
}

/**
 * Looks up a series/movie title from the cross-file series map by either
 * numeric id or UUID. Used by list import to resolve list items that only
 * have an id/UUID (the list CSV doesn't include titles).
 */
function lookupSeriesTitle(map: Map<string, { title: string; uuid?: string }>, id: string | null, uuid: string | null): string | null {
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

/**
 * Extracts the vote value from a TV Time `vote_key`. The format is
 * `{episode_id}-{user_id}-{value}` for episode ratings or
 * `{uuid}-{user_id}-{value}` for movie ratings. Returns the last
 * numeric segment, or null if the format is unrecognizable.
 */
function extractVoteValue(voteKey: string | undefined): string | null {
	if (!voteKey) return null;
	const parts = voteKey.split("-");
	if (parts.length < 2) return null;
	const last = parts[parts.length - 1];
	return /^\d+$/.test(last) ? last : null;
}

function clean(value?: string | null): string | null { const v = value?.trim(); return v ? v : null; }
function number(value?: string | null): number | null { const n = Number(value); return Number.isFinite(n) && n >= 0 ? n : null; }
/**
 * TV Time's export occasionally puts a 4-digit year in the `season_number`
 * column instead of a real season (seen for anthology/podcast-style entries
 * like "Rotten Mango", "Formula 1", "Studio Ghibli" collections — these
 * aren't organized into TMDB-style seasons at all). A real season number is
 * never this large, so treat anything >= 1900 as a signal this isn't a
 * season and the row should be diagnosed rather than silently turned into
 * an episode watch that can never match a real TMDB episode.
 */
function looksLikeYearNotSeason(season: number): boolean { return season >= 1900; }
function yearFrom(value?: string | null): number | null { const match = value?.match(/^(\d{4})/); return match ? Number(match[1]) : null; }
/**
 * Every GDPR title field goes through this before matching. Delegates to
 * `extractTitleMetadata()` for the full parenthetical classification (year,
 * country, language, alternate title) — kept under its historical name
 * since every call site below only originally cared about title/year, and
 * this way none of them needed to change shape to keep compiling.
 */
function splitTitleYear(title: string): TitleMetadata {
	return extractTitleMetadata(title);
}

/**
 * Turns the country/language/alternate-title hints extracted from a title
 * into a `MatchMetadata` object for attaching to a watch/review/rating/etc.,
 * or `undefined` when nothing was extracted (the common case) — so
 * call sites can spread it in without any conditional logic of their own,
 * and importers untouched by this still produce identical bundles.
 */
function titleMatchHints(meta: TitleMetadata, extra?: MatchMetadata): MatchMetadata | undefined {
	const hasHints = meta.country !== null || meta.language !== null || meta.alternateTitle !== null;
	if (!hasHints && !extra) return undefined;
	return {
		...extra,
		country: extra?.country ?? meta.country ?? undefined,
		language: meta.language ?? undefined,
		originalTitle: extra?.originalTitle ?? meta.alternateTitle ?? undefined,
	};
}
function epochOrDate(value?: string | null): string | null { if (value && /^\d{10}(?:\.\d+)?$/.test(value)) return new Date(Number(value) * 1000).toISOString().slice(0, 10); return parseFlexibleDate(value ?? null); }
function episodeKey(watch: WatchImport): string { return watch.ids.tvTimeEpisodeId ? `id:${watch.ids.tvTimeEpisodeId}` : `${watch.title.toLowerCase()}|${watch.seasonNumber}|${watch.episodeNumber}`; }
