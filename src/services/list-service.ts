import { MediaItem } from "../models/media";
import { MediaType } from "../types/enums";
import { CustomList } from "../models/list";
import { recentSortKey } from "./library-query";

export const SYSTEM_FAVORITE_MOVIES_ID = "system:favorite-movies";
export const SYSTEM_FAVORITE_TV_ID = "system:favorite-tv";

export function isSystemListId(id: string): boolean {
	return id === SYSTEM_FAVORITE_MOVIES_ID || id === SYSTEM_FAVORITE_TV_ID;
}

/**
 * The two built-in "Favorite Movies" / "Favorite TV Series" smart lists
 * (Library/Favorites roadmap, Milestone 1). Never stored in
 * CustomListRepository — computed live from `isFavorite` media every time,
 * so they can't drift from actual favorite status and never need
 * migrating. They're surfaced via the Favorites section's nav arrow, not
 * the regular Lists carousel.
 */
export function getSystemFavoriteLists(allMedia: MediaItem[]): CustomList[] {
	const now = new Date().toISOString();
	const favorites = allMedia.filter((m) => m.isFavorite);
	const movieIds = favorites.filter((m) => m.type === MediaType.Movie).map((m) => m.id);
	const tvIds = favorites.filter((m) => m.type === MediaType.TVShow).map((m) => m.id);

	return [
		{
			id: SYSTEM_FAVORITE_MOVIES_ID,
			title: "Favorite Movies",
			description: "Every movie you've marked as a favorite.",
			mediaIds: movieIds,
			sortMode: "recent",
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
			mediaIds: tvIds,
			sortMode: "recent",
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
