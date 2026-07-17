import { RatingScale } from "../types/enums";

export type { RatingScale };

export interface MediaVaultSettings {
	/** Schema/data version for migrations */
	dataVersion: number;

	/** TMDB API key, set by the user */
	tmdbApiKey: string;

	/** Trakt OAuth client id/secret + tokens (populated after auth flow) */
	traktClientId: string;
	traktClientSecret: string;
	traktAccessToken: string | null;
	traktRefreshToken: string | null;
	/** Unix ms timestamp when traktAccessToken expires; null if never authorized. */
	traktTokenExpiresAt: number | null;

	/** How (if at all) Trakt sync should run automatically. */
	traktAutoSync: "manual" | "on_startup" | "interval";
	/** Only used when traktAutoSync === "interval". */
	traktSyncIntervalMinutes: number;
	/** ISO timestamp of the last successful sync, shown in settings. */
	traktLastSyncedAt: string | null;
	/** Folder (relative to vault root) where "Trakt Rating History.md" is written. */
	traktHistoryNotePath: string;

	/** Where generated media notes are stored */
	mediaFolderPath: string;
	autoCreateNotes: boolean;

	/** Display preferences */
	defaultView: "grid" | "list" | "table";
	posterDisplay: boolean;
	/**
	 * Persists the user's last-chosen library sort so it's remembered
	 * across sessions (roadmap Milestone 5: Default "Recent" Sorting).
	 * "recent" is the shipped default — latest watch date if the item has
	 * watch history, otherwise date added, newest first.
	 */
	defaultSort: "recent" | "title" | "rating" | "watchCount" | "year" | "runtime";
	defaultSortDirection: "asc" | "desc";

	/** Rating scale used across the UI */
	ratingScale: RatingScale;

	/** Cache duration for TMDB responses, in minutes */
	cacheDurationMinutes: number;

	/**
	 * How often (in hours) a Currently Watching show's episode metadata is
	 * allowed to auto-refresh from TMDB (Milestone 9: Automatic TMDB
	 * Episode Synchronization). Shows with no episodes imported yet always
	 * sync regardless of this interval; Finished/Dropped/Plan to Watch
	 * shows never auto-refresh at all.
	 */
	episodeSyncIntervalHours: number;

	/** Remembered collapsed/expanded state of the Watch Next sidebar's sections (roadmap Milestone 6). */
	watchNextSidebarCollapsed: boolean;
	watchNextUpcomingTab: "episodes" | "movies";

	/** Notifications (roadmap Milestone 8). Per-type enable flags plus delivery preferences. */
	notificationsEnabled: {
		newEpisode: boolean;
		newSeason: boolean;
		movieReleased: boolean;
		seriesReturned: boolean;
		watchlistReminder: boolean;
		continueWatchingReminder: boolean;
	};
	/** 24h "HH:mm" — the daily check only runs once per day, at or after this local time. */
	notificationTime: string;
	/** Suppresses toast delivery; notifications still get recorded to history. */
	notificationSilent: boolean;
	/** IANA timezone name (e.g. "America/New_York"); empty string means "use the system's local time". */
	notificationTimezone: string;
	/** ISO calendar date (YYYY-MM-DD) the daily check last ran, so it fires at most once per day. */
	notificationLastCheckedDate: string | null;
}

export const DEFAULT_SETTINGS: MediaVaultSettings = {
	dataVersion: 1,
	tmdbApiKey: "",
	traktClientId: "",
	traktClientSecret: "",
	traktAccessToken: null,
	traktRefreshToken: null,
	traktTokenExpiresAt: null,
	traktAutoSync: "manual",
	traktSyncIntervalMinutes: 60,
	traktLastSyncedAt: null,
	traktHistoryNotePath: "MediaVault/Trakt Rating History.md",
	mediaFolderPath: "MediaVault",
	autoCreateNotes: false,
	defaultView: "grid",
	posterDisplay: true,
	defaultSort: "recent",
	defaultSortDirection: "desc",
	ratingScale: RatingScale.TenPoint,
	cacheDurationMinutes: 60 * 24,
	episodeSyncIntervalHours: 24,
	watchNextSidebarCollapsed: false,
	watchNextUpcomingTab: "episodes",
	notificationsEnabled: {
		newEpisode: true,
		newSeason: true,
		movieReleased: true,
		seriesReturned: true,
		watchlistReminder: false,
		continueWatchingReminder: false,
	},
	notificationTime: "09:00",
	notificationSilent: false,
	notificationTimezone: "",
	notificationLastCheckedDate: null,
};
