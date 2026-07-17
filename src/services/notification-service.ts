import type { StorageService } from "./storage";
import type { TMDBService } from "../api/tmdb";
import { MediaItem } from "../models/media";
import { NotificationType } from "../models/notification";
import { MediaStatus, MediaType } from "../types/enums";
import { ENDED_TV_STATUSES } from "./status-service";
import { MediaVaultSettings } from "../settings/settings";

const RETURNING_TV_STATUSES: ReadonlySet<string> = new Set(["Returning Series", "In Production", "Planned", "Pilot"]);

/** How long a reminder's cooldown lasts before it's allowed to repeat. */
const REMINDER_COOLDOWN_DAYS = 14;
/** A Plan to Watch / Watch Later item is only reminded about once it's sat untouched this long. */
const WATCHLIST_STALE_DAYS = 30;
/** A Watching show is only reminded about once nothing's been watched for this long. */
const CONTINUE_WATCHING_STALE_DAYS = 21;

function daysAgo(iso: string, now: Date): number {
	return (now.getTime() - new Date(iso).getTime()) / (1000 * 60 * 60 * 24);
}

function isoDateOnly(d: Date): string {
	return d.toISOString().slice(0, 10);
}

/**
 * Should the daily check run right now? At most once per calendar day
 * (`notificationLastCheckedDate`), and not before the configured local
 * time-of-day. Timezone is honored on a best-effort basis — Intl's
 * formatter handles the IANA-name case; an empty string falls back to the
 * system's own local time, which `now` already is.
 */
export function shouldRunDailyCheck(settings: MediaVaultSettings, now: Date = new Date()): boolean {
	const today = isoDateOnly(now);
	if (settings.notificationLastCheckedDate === today) return false;

	let localHours = now.getHours();
	let localMinutes = now.getMinutes();
	if (settings.notificationTimezone) {
		try {
			const parts = new Intl.DateTimeFormat("en-US", {
				timeZone: settings.notificationTimezone,
				hour: "numeric",
				minute: "numeric",
				hour12: false,
			}).formatToParts(now);
			localHours = parseInt(parts.find((p) => p.type === "hour")?.value ?? "0", 10);
			localMinutes = parseInt(parts.find((p) => p.type === "minute")?.value ?? "0", 10);
		} catch {
			// Invalid/unrecognized timezone string — fall back to system local time rather than throwing.
		}
	}

	const [targetHour, targetMinute] = settings.notificationTime.split(":").map((n) => parseInt(n, 10));
	const nowMinutes = localHours * 60 + localMinutes;
	const targetMinutes = (targetHour || 0) * 60 + (targetMinute || 0);
	return nowMinutes >= targetMinutes;
}

interface PendingNotification {
	type: NotificationType;
	mediaId: string;
	title: string;
	message: string;
}

/**
 * Metadata-diff checks: refetches TMDB details for shows/movies that could
 * still change (not Completed/Dropped, or a movie not yet released) and
 * compares against what's already stored locally — the locally-stored
 * MediaItem/Episode records ARE the "previously known metadata" baseline,
 * so this never needs a second snapshot store. Returns both the
 * notifications to fire and the MediaItem field updates to persist
 * afterward (so the next run's baseline is current).
 */
export async function checkMetadataUpdates(
	storage: StorageService,
	tmdb: TMDBService,
	enabled: MediaVaultSettings["notificationsEnabled"]
): Promise<{ pending: PendingNotification[]; mediaUpdates: Map<string, Partial<MediaItem>> }> {
	const pending: PendingNotification[] = [];
	const mediaUpdates = new Map<string, Partial<MediaItem>>();
	const allMedia = await storage.media.getAll();

	// --- TV shows: new episode, new season, series returned ---
	const activeShows = allMedia.filter(
		(m) => m.type === MediaType.TVShow && m.status !== MediaStatus.Dropped && m.status !== MediaStatus.Completed
	);

	for (const show of activeShows) {
		let details;
		try {
			details = await tmdb.getTV(show.tmdbId);
		} catch {
			continue; // network hiccup / rate limit — just skip this show for today, try again tomorrow
		}

		if (
			enabled.seriesReturned &&
			show.tvStatus &&
			ENDED_TV_STATUSES.has(show.tvStatus) &&
			details.tvStatus &&
			RETURNING_TV_STATUSES.has(details.tvStatus)
		) {
			pending.push({
				type: "series_returned",
				mediaId: show.id,
				title: show.title,
				message: `"${show.title}" has returned for more episodes.`,
			});
		}

		if (details.tvStatus && details.tvStatus !== show.tvStatus) {
			mediaUpdates.set(show.id, { ...mediaUpdates.get(show.id), tvStatus: details.tvStatus });
		}

		if ((enabled.newEpisode || enabled.newSeason) && details.seasons) {
			const knownEpisodes = await storage.episodes.findByMediaId(show.id);
			const knownMaxSeason = knownEpisodes.reduce((max, e) => Math.max(max, e.seasonNumber), 0);

			for (const season of details.seasons) {
				if (season.seasonNumber === 0) continue; // specials
				if (enabled.newSeason && season.seasonNumber > knownMaxSeason) {
					pending.push({
						type: "new_season",
						mediaId: show.id,
						title: show.title,
						message: `"${show.title}" has a new season (Season ${season.seasonNumber}).`,
					});
				} else if (enabled.newEpisode && season.seasonNumber <= knownMaxSeason && season.episodeCount > 0) {
					// A season we already know about grew more episodes than we've imported — a new episode aired.
					const knownInSeason = knownEpisodes.filter((e) => e.seasonNumber === season.seasonNumber).length;
					if (season.episodeCount > knownInSeason) {
						pending.push({
							type: "new_episode",
							mediaId: show.id,
							title: show.title,
							message: `"${show.title}" has a new episode available.`,
						});
					}
				}
			}
		}
	}

	// --- Movies: released ---
	if (enabled.movieReleased) {
		const pendingMovies = allMedia.filter(
			(m) => m.type === MediaType.Movie && m.releaseDate !== null && new Date(m.releaseDate).getTime() > Date.now()
		);
		for (const movie of pendingMovies) {
			let details;
			try {
				details = await tmdb.getMovie(movie.tmdbId);
			} catch {
				continue;
			}
			if (details.releaseDate && new Date(details.releaseDate).getTime() <= Date.now()) {
				pending.push({
					type: "movie_released",
					mediaId: movie.id,
					title: movie.title,
					message: `"${movie.title}" has been released.`,
				});
			}
			if (details.releaseDate && details.releaseDate !== movie.releaseDate) {
				mediaUpdates.set(movie.id, { ...mediaUpdates.get(movie.id), releaseDate: details.releaseDate });
			}
		}
	}

	return { pending, mediaUpdates };
}

/** Reminders: purely local, no TMDB calls — driven by how long something's sat idle. */
export function checkReminders(
	allMedia: MediaItem[],
	enabled: MediaVaultSettings["notificationsEnabled"],
	now: Date = new Date()
): PendingNotification[] {
	const pending: PendingNotification[] = [];

	if (enabled.watchlistReminder) {
		for (const m of allMedia) {
			if (m.status !== MediaStatus.PlanToWatch && m.status !== MediaStatus.WatchLater) continue;
			if (daysAgo(m.createdAt, now) < WATCHLIST_STALE_DAYS) continue;
			pending.push({
				type: "watchlist_reminder",
				mediaId: m.id,
				title: m.title,
				message: `"${m.title}" has been on your watchlist a while — still interested?`,
			});
		}
	}

	if (enabled.continueWatchingReminder) {
		for (const m of allMedia) {
			if (m.status !== MediaStatus.Watching) continue;
			if (daysAgo(m.updatedAt, now) < CONTINUE_WATCHING_STALE_DAYS) continue;
			pending.push({
				type: "continue_watching_reminder",
				mediaId: m.id,
				title: m.title,
				message: `You haven't continued "${m.title}" in a while.`,
			});
		}
	}

	return pending;
}

const RECURRING_TYPES: ReadonlySet<NotificationType> = new Set(["watchlist_reminder", "continue_watching_reminder"]);

/**
 * Runs the full daily check: metadata diff + reminders, filtered through
 * the repository's dedupe rules, persisted, and returned for the caller to
 * deliver (as toasts, native notifications, etc.) — delivery is
 * deliberately not this function's job, so it stays testable without a UI.
 */
export async function runNotificationCheck(
	storage: StorageService,
	tmdb: TMDBService,
	settings: MediaVaultSettings,
	now: Date = new Date()
): Promise<PendingNotification[]> {
	const { pending: metadataPending, mediaUpdates } = await checkMetadataUpdates(storage, tmdb, settings.notificationsEnabled);

	for (const [mediaId, patch] of mediaUpdates) {
		await storage.media.update(mediaId, patch);
	}

	const allMedia = await storage.media.getAll();
	const reminderPending = checkReminders(allMedia, settings.notificationsEnabled, now);

	const toFire: PendingNotification[] = [];
	const cooldownSince = new Date(now.getTime() - REMINDER_COOLDOWN_DAYS * 24 * 60 * 60 * 1000).toISOString();

	for (const n of [...metadataPending, ...reminderPending]) {
		const isDuplicate = RECURRING_TYPES.has(n.type)
			? await storage.notifications.notifiedSince(n.type, n.mediaId, cooldownSince)
			: await storage.notifications.alreadyNotified(n.type, n.mediaId);
		if (isDuplicate) continue;
		await storage.notifications.record(n.type, n.mediaId, n.title, n.message);
		toFire.push(n);
	}

	return toFire;
}
