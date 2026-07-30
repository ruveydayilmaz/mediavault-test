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

function applyManualOrder(
  currentIds: string[],
  savedOrder: string[],
): string[] {
  const currentSet = new Set(currentIds);
  const ordered = savedOrder.filter((id) => currentSet.has(id));
  const known = new Set(ordered);
  for (const id of currentIds) {
    if (!known.has(id)) ordered.push(id);
  }
  return ordered;
}

export function getSystemFavoriteLists(
  allMedia: MediaItem[],
  settings: MediaVaultSettings,
): CustomList[] {
  const now = new Date().toISOString();
  const favorites = allMedia.filter((m) => m.isFavorite);
  const movieIds = favorites
    .filter((m) => m.type === MediaType.Movie)
    .map((m) => m.id);
  const tvIds = favorites
    .filter((m) => m.type === MediaType.TVShow)
    .map((m) => m.id);

  const movieSort = settings.favoriteListSortModes.movies;
  const tvSort = settings.favoriteListSortModes.tv;

  return [
    {
      id: SYSTEM_FAVORITE_MOVIES_ID,
      title: "Favorite Movies",
      description: "Every movie you've marked as a favorite.",
      mediaIds:
        movieSort === "manual"
          ? applyManualOrder(movieIds, settings.favoriteListManualOrder.movies)
          : movieIds,
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
      mediaIds:
        tvSort === "manual"
          ? applyManualOrder(tvIds, settings.favoriteListManualOrder.tv)
          : tvIds,
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

export function resolveListMedia(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  const byId = new Map(allMedia.map((m) => [m.id, m]));
  const resolved: MediaItem[] = [];
  for (const mediaId of list.mediaIds) {
    const media = byId.get(mediaId);
    if (media) resolved.push(media);
  }
  return resolved;
}

export function sortListMedia(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  const media = resolveListMedia(list, allMedia);

  switch (list.sortMode) {
    case "recent":
      return [...media].sort((a, b) =>
        recentSortKey(b).localeCompare(recentSortKey(a)),
      );
    case "title":
      return [...media].sort((a, b) => a.title.localeCompare(b.title));
    case "rating":
      return [...media].sort(
        (a, b) => (b.averageRating ?? -1) - (a.averageRating ?? -1),
      );
    case "year":
      return [...media].sort((a, b) => (b.year ?? 0) - (a.year ?? 0));
    case "runtime":
      return [...media].sort((a, b) => (b.runtime ?? 0) - (a.runtime ?? 0));
    case "dateAdded":
      return media;
    case "manual":
    default:
      return media;
  }
}

export function getListBannerPosters(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  return sortListMedia(list, allMedia).slice(0, 4);
}
