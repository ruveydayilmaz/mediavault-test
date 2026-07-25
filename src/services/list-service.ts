import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";
import { CustomList } from "../models/list";
import { recentSortKey } from "./library-query";
import { MediaVaultSettings } from "../settings/settings";

export const SYSTEM_FAVORITE_MOVIES_ID = "system:favorite-movies";
export const SYSTEM_FAVORITE_TV_ID = "system:favorite-tv";

export function isSystemListId(id: string): boolean {
	return id === SYSTEM_FAVORITE_MOVIES_ID || id === SYSTEM_FAVORITE_TV_ID;
}

/** Applies a persisted manual order to a fresh set of favorite ids: known ids keep their saved relative order, anything newly favorited (not yet in the saved order) is appended at the end, anything no longer favorited is dropped. */
function applyManualOrder(currentIds: string[], savedOrder: string[]): string[] {
	const currentSet = new Set(currentIds);
	const ordered = savedOrder.filter((id) => currentSet.has(id));
	const known = new Set(ordered);
	for (const id of currentIds) {
		if (!known.has(id)) ordered.push(id);
	}
	return ordered;
}

/**
 * The two built-in "Favorite Movies" / "Favorite TV Series" smart lists
 * (Library/Favorites roadmap, Milestone 1; sorting persistence added in a
 * follow-up milestone). Never stored in CustomListRepository — membership
 * is always computed live from `isFavorite` media so it can't drift, but
 * sort mode and manual order ARE persisted (in settings, since there's no
 * repository record to hold them) and reused via the exact same
 * `sortListMedia`/`ListSortMode` machinery as regular custom lists.
 */
export function getSystemFavoriteLists(allMedia: MediaItem[], settings: MediaVaultSettings): CustomList[] {
	const now = new Date().toISOString();
	const favorites = allMedia.filter((m) => m.isFavorite);
	const movieIds = favorites.filter((m) => m.type === MediaType.Movie).map((m) => m.id);
	const tvIds = favorites.filter((m) => m.type === MediaType.TVShow).map((m) => m.id);

	const movieSort = settings.favoriteListSortModes.movies;
	const tvSort = settings.favoriteListSortModes.tv;

	return [
		{
			id: SYSTEM_FAVORITE_MOVIES_ID,
			title: "Favorite Movies",
			description: "Every movie you've marked as a favorite.",
			mediaIds: movieSort === "manual" ? applyManualOrder(movieIds, settings.favoriteListManualOrder.movies) : movieIds,
			sortMode: movieSort,
			owner: null,
			isImported: false,
			importSource: null,
			createdAt: now,
			updatedAt: now,
			isSystem: true,
		},
		{
			id: SYSTEM_FAVORITE_TV_ID,
			title: "Favorite TV Series",
			description: "Every TV series you've marked as a favorite.",
			mediaIds: tvSort === "manual" ? applyManualOrder(tvIds, settings.favoriteListManualOrder.tv) : tvIds,
			sortMode: tvSort,
			owner: null,
			isImported: false,
			importSource: null,
			createdAt: now,
			updatedAt: now,
			isSystem: true,
		},
	];
}

/** "Just now" / "3 days ago" / falls back to the plain date beyond a month — used for a list's "Last updated" (roadmap Milestone 7). */
export function formatRelativeDate(iso: string): string {
	const then = new Date(iso).getTime();
	if (Number.isNaN(then)) return iso;
	const diffMs = Date.now() - then;
	const diffMinutes = Math.floor(diffMs / 60000);
	if (diffMinutes < 1) return "Just now";
	if (diffMinutes < 60) return `${diffMinutes}m ago`;
	const diffHours = Math.floor(diffMinutes / 60);
	if (diffHours < 24) return `${diffHours}h ago`;
	const diffDays = Math.floor(diffHours / 24);
	if (diffDays < 30) return `${diffDays}d ago`;
	return iso.slice(0, 10);
}

/** Resolves a list's mediaIds into actual MediaItem records, silently dropping any that no longer exist. */
export function resolveListMedia(list: CustomList, allMedia: MediaItem[]): MediaItem[] {
	const byId = new Map(allMedia.map((m) => [m.id, m]));
	const resolved: MediaItem[] = [];
	for (const mediaId of list.mediaIds) {
		const media = byId.get(mediaId);
		if (media) resolved.push(media);
	}
	return resolved;
}

/**
 * Returns a list's media in display order. "manual" trusts `mediaIds`
 * order as-is (drag-and-drop writes there directly); every other mode is a
 * pure sort computed fresh each time, never mutating the list.
 */
export function sortListMedia(list: CustomList, allMedia: MediaItem[]): MediaItem[] {
	const media = resolveListMedia(list, allMedia);

	switch (list.sortMode) {
		case "recent":
			// Same rule as library "Recent" sorting (roadmap Milestone 5) — reused via recentSortKey rather than re-derived here.
			return [...media].sort((a, b) => recentSortKey(b).localeCompare(recentSortKey(a)));
		case "title":
			return [...media].sort((a, b) => a.title.localeCompare(b.title));
		case "rating":
			return [...media].sort((a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1));
		case "year":
			return [...media].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
		case "runtime":
			return [...media].sort((a, b) => (b.runtime ?? 0) - (a.runtime ?? 0));
		case "dateAdded":
			// mediaIds is append-ordered (addMedia pushes to the end), so its
			// current order already reflects date-added order.
			return media;
		case "manual":
		default:
			return media;
	}
}

/** First four posters in display order, for the list's banner grid. Fewer than four is expected and fine. */
export function getListBannerPosters(list: CustomList, allMedia: MediaItem[]): MediaItem[] {
	return sortListMedia(list, allMedia).slice(0, 4);
}
