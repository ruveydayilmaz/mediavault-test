import { MediaVaultId, ISODateString } from "../types/common";

export type NotificationType =
	| "new_episode"
	| "new_season"
	| "movie_released"
	| "series_returned"
	| "watchlist_reminder"
	| "continue_watching_reminder";

/**
 * One fired notification. Persisted (not just shown as a toast and
 * forgotten) for two reasons: it's the de-duplication record — "notify
 * only once" (roadmap Milestone 8) needs something durable to check
 * against, since Obsidian gives plugins no OS-level notification history —
 * and it doubles as the in-app history list.
 */
export interface MediaVaultNotification {
	id: MediaVaultId;
	type: NotificationType;
	mediaId: MediaVaultId;
	title: string;
	message: string;
	createdAt: ISODateString;
	read: boolean;
}
