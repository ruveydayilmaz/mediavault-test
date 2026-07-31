import { MediaItem } from "../../models/media";
import { MediaStatus, MediaType } from "../../types/enums";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import type { StorageService } from "../../services/storage";

export function statusLabel(status: MediaStatus): string {
  switch (status) {
    case MediaStatus.Watching:
      return "Currently Watching";
    case MediaStatus.Completed:
      return "Finished";
    case MediaStatus.WaitingForNewSeason:
      return "Waiting for New Season";
    case MediaStatus.UpToDate:
      return "Up to Date";
    case MediaStatus.OnHold:
      return "On Hold";
    case MediaStatus.Dropped:
      return "Dropped";
    case MediaStatus.PlanToWatch:
      return "Plan to Watch";
    case MediaStatus.Rewatching:
      return "Rewatching";
    case MediaStatus.ComfortMedia:
      return "Comfort Media";
    case MediaStatus.Favorite:
      return "Favorite";
    default:
      return status;
  }
}

export function progressFillClass(status: MediaStatus): string {
  switch (status) {
    case MediaStatus.Dropped:
      return "is-dropped";
    default:
      return "";
  }
}

export function progressFillClasses(
  baseClass: string,
  status: MediaStatus,
): string {
  const statusClass = progressFillClass(status);
  return statusClass ? `${baseClass} ${statusClass}` : baseClass;
}

export function renderPoster(
  container: HTMLElement,
  item: MediaItem,
  size: "w200" | "w342" = "w200",
): void {
  const posterUrl = tmdbImageUrl(item.posterPath, size);
  if (posterUrl) {
    container.createEl("img", {
      attr: { src: posterUrl, alt: item.title, loading: "lazy" },
    });
  } else {
    container.setText("🎬");
  }
}

export async function getShowPercentWatched(
  storage: StorageService,
  mediaId: MediaItem["id"],
): Promise<number | null> {
  const episodes = await storage.episodes.findByMediaId(mediaId);
  if (!episodes.length) return null;

  const progress = await storage.episodeProgress.getShowProgress(
    mediaId,
    episodes,
  );
  return progress.percentWatched;
}

export async function getMoviePercentWatched(
  storage: StorageService,
  item: MediaItem,
): Promise<number | null> {
  if (item.status === MediaStatus.Completed) return 100;

  if (
    item.status === MediaStatus.Watching ||
    item.status === MediaStatus.Dropped
  ) {
    const progress = await storage.movieProgress.findByMediaId(item.id);
    if (!progress) return null;
    return progress.totalRuntime > 0
      ? (progress.currentMinute / progress.totalRuntime) * 100
      : 0;
  }

  return null;
}

export async function getMediaPercentWatched(
  storage: StorageService,
  item: MediaItem,
): Promise<number | null> {
  return item.type === MediaType.TVShow
    ? getShowPercentWatched(storage, item.id)
    : getMoviePercentWatched(storage, item);
}

export function renderProgressOverlay(
  posterEl: HTMLElement,
  percent: number,
  status: MediaStatus,
  trackClass = "mediavault-card-progress",
  fillClass = "mediavault-card-progress-fill",
): void {
  const track = posterEl.createDiv({ cls: trackClass });
  track.createDiv({
    cls: progressFillClasses(fillClass, status),
    attr: { style: `width:${Math.round(percent)}%` },
  });
}

export function formatRuntime(minutes: number | null): string {
  if (!minutes) return "—";
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export function formatRating(rating: number | null): string {
  return rating === null ? "—" : rating.toFixed(1);
}
