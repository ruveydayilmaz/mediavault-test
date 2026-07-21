import { MediaItem } from "../models/media";
import { WatchSession } from "../models/review";
import { Episode, EpisodeProgress } from "../models/episode";
import { MediaType } from "../types/enums";
import type { StorageService } from "./storage";

export interface DashboardStatistics {
	movieCount: number;
	movieRuntimeMinutes: number;
	episodeCount: number;
	episodeRuntimeMinutes: number;
}

export interface StatisticsInput {
	media: MediaItem[];
	sessions: WatchSession[];
	episodes: Episode[];
	episodeProgress: EpisodeProgress[];
}

/**
 * Pure computation for the four Home dashboard stat cards. Always derived
 * fresh from watch sessions / episode progress rather than a cached
 * counter, per the spec — so there's nothing to keep in sync and nothing
 * that can drift out of date after an import, a Trakt sync, or a manual
 * mark-watched/delete.
 */
export function computeStatistics(input: StatisticsInput): DashboardStatistics {
	const { media, sessions, episodes, episodeProgress } = input;

	const movieIds = new Set(media.filter((m) => m.type === MediaType.Movie).map((m) => m.id));

	// "Movies watched" — distinct movies with at least one logged watch session.
	// Every WatchSession represents a completed watch (the plugin has no
	// partial/in-progress movie session concept), so this is exactly
	// "completed watch sessions" grouped down to unique titles.
	const watchedMovieSessions = sessions.filter((s) => movieIds.has(s.mediaId));
	const movieCount = new Set(watchedMovieSessions.map((s) => s.mediaId)).size;

	// "Movie watch time" — sums runtime per watch EVENT, not per unique
	// title: rewatching a 120-minute movie twice is 240 minutes of your
	// life spent watching it, and should count as such.
	const movieRuntimeById = new Map(media.filter((m) => m.type === MediaType.Movie).map((m) => [m.id, m.runtime ?? 0]));
	const movieRuntimeMinutes = watchedMovieSessions.reduce((sum, s) => sum + (movieRuntimeById.get(s.mediaId) ?? 0), 0);

	// "Episodes watched" — episodes don't have a rewatch-count field in the
	// current model (EpisodeProgress is a single watched/unwatched record
	// per episode), so this is simply the count of watched episodes.
	const watchedProgress = episodeProgress.filter((p) => p.watched);
	const episodeCount = watchedProgress.length;

	const episodeRuntimeById = new Map(episodes.map((e) => [e.id, e.runtime ?? 0]));
	const episodeRuntimeMinutes = watchedProgress.reduce((sum, p) => sum + (episodeRuntimeById.get(p.episodeId) ?? 0), 0);

	return { movieCount, movieRuntimeMinutes, episodeCount, episodeRuntimeMinutes };
}

/**
 * Thin async wrapper exposing the four named methods from the spec,
 * fetching fresh data from storage on every call. Kept dependency-light —
 * StatisticsService doesn't cache anything itself, deliberately: an
 * existing test asserts it always recomputes from live storage rather
 * than a cached counter, so mutating the mock stores between calls on
 * the same instance is expected to change the result immediately. If a
 * memoization layer is ever needed, it should key off something that
 * invalidates on every relevant mutation without a live version signal
 * from storage the way analytics' `computeAnalyticsMemoized` does.
 */
export class StatisticsService {
	constructor(private storage: StorageService) {}

	private async load(): Promise<StatisticsInput> {
		const [media, sessions, episodes, episodeProgress] = await Promise.all([
			this.storage.media.getAll(),
			this.storage.watchSessions.getAll(),
			this.storage.episodes.getAll(),
			this.storage.episodeProgress.getAll(),
		]);
		return { media, sessions, episodes, episodeProgress };
	}

	async getAll(): Promise<DashboardStatistics> {
		return computeStatistics(await this.load());
	}

	async getMovieCount(): Promise<number> {
		return (await this.getAll()).movieCount;
	}

	async getMovieRuntime(): Promise<number> {
		return (await this.getAll()).movieRuntimeMinutes;
	}

	async getEpisodeCount(): Promise<number> {
		return (await this.getAll()).episodeCount;
	}

	async getEpisodeRuntime(): Promise<number> {
		return (await this.getAll()).episodeRuntimeMinutes;
	}
}

/** Formats minutes as a human-readable duration using the two most significant units: "Xy Zmo" / "Xmo Yd" / "Xd Yh" / "Xh Ym" / "Ym". */
export function formatWatchTime(totalMinutes: number): string {
	if (totalMinutes <= 0) return "0m";

	const totalHours = Math.floor(totalMinutes / 60);
	const totalDays = Math.floor(totalHours / 24);
	const totalMonths = Math.floor(totalDays / 30.44);
	const totalYears = Math.floor(totalDays / 365.25);

	if (totalYears > 0) {
		const remainingMonths = Math.floor((totalDays - totalYears * 365.25) / 30.44);
		return remainingMonths > 0 ? `${totalYears}y ${remainingMonths}mo` : `${totalYears}y`;
	}
	if (totalMonths > 0) {
		const remainingDays = Math.floor(totalDays - totalMonths * 30.44);
		return remainingDays > 0 ? `${totalMonths}mo ${remainingDays}d` : `${totalMonths}mo`;
	}
	const hours = Math.floor((totalMinutes % (24 * 60)) / 60);
	const minutes = totalMinutes % 60;
	if (totalDays > 0) return `${totalDays}d ${hours}h`;
	if (hours > 0) return `${hours}h ${minutes}m`;
	return `${minutes}m`;
}
