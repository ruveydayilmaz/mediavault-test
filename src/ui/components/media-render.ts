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

/**
 * Single source of truth for status-based progress bar styling (Part 2:
 * Synchronize Dropped Status Styling). Every place that renders a
 * progress bar fill for a `MediaItem` — the Details hero/season bars,
 * Favorites cards, and any future reusable media card — should derive its
 * color from this rather than re-deriving its own "is this dropped"
 * check, so adding a new status-based color later only means editing
 * this one function.
 */
export function progressFillClass(status: MediaStatus): string {
	switch (status) {
		case MediaStatus.Dropped:
			return "is-dropped";
		default:
			return "";
	}
}

/**
 * Builds the full class list for a progress-fill element: the base class
 * plus whatever `progressFillClass` says for this item's current status.
 * Callers just do `fill.addClass(...)`-free construction by passing this
 * straight into `createDiv({ cls })`.
 */
export function progressFillClasses(baseClass: string, status: MediaStatus): string {
	const statusClass = progressFillClass(status);
	return statusClass ? `${baseClass} ${statusClass}` : baseClass;
}

export function renderPoster(container: HTMLElement, item: MediaItem, size: "w200" | "w342" = "w200"): void {
	const posterUrl = tmdbImageUrl(item.posterPath, size);
	if (posterUrl) {
		container.createEl("img", { attr: { src: posterUrl, alt: item.title, loading: "lazy" } });
	} else {
		container.setText("🎬");
	}
}

/**
 * Single source of truth for "how far watched is this item, as a percent
 * 0-100" — TV derives it from episode progress; movies derive it from
 * `MediaItem.status` plus, for partial watches, the `movieProgress` record
 * (roadmap Milestone 3: Movie Progress Bars). Returns null when there's
 * nothing worth showing a bar for (a movie that's still Plan to Watch, or
 * a TV show with no episodes imported yet) — callers should render no bar
 * at all in that case, exactly like the pre-existing TV-only behavior.
 */
export async function getShowPercentWatched(storage: StorageService, mediaId: MediaItem["id"]): Promise<number | null> {
	const episodes = await storage.episodes.findByMediaId(mediaId);
	if (!episodes.length) return null;

	const progress = await storage.episodeProgress.getShowProgress(mediaId, episodes);
	return progress.percentWatched;
}

/** Movie counterpart to getShowPercentWatched — see getMediaPercentWatched for the combined entry point most callers should use. */
export async function getMoviePercentWatched(storage: StorageService, item: MediaItem): Promise<number | null> {
	if (item.status === MediaStatus.Completed) return 100;

	if (item.status === MediaStatus.Watching || item.status === MediaStatus.Dropped) {
		const progress = await storage.movieProgress.findByMediaId(item.id);
		if (!progress) return null;
		return progress.totalRuntime > 0 ? (progress.currentMinute / progress.totalRuntime) * 100 : 0;
	}

	return null;
}

/** The one function library/favorites/lists/search card renderers should call — dispatches to the movie or TV rule above based on `item.type`. */
export async function getMediaPercentWatched(storage: StorageService, item: MediaItem): Promise<number | null> {
	return item.type === MediaType.TVShow ? getShowPercentWatched(storage, item.id) : getMoviePercentWatched(storage, item);
}

/**
 * Renders the thin progress-bar overlay used across every card style
 * (Grid, Favorites, Custom Lists, Search results) — a single absolutely-
 * positioned track along the poster's bottom edge, filled and colored via
 * `progressFillClasses`. Callers needing a different base class (e.g. an
 * inline table-cell bar) can pass one; otherwise this is a drop-in
 * replacement for what was previously duplicated per-caller markup.
 */
export function renderProgressOverlay(
	posterEl: HTMLElement,
	percent: number,
	status: MediaStatus,
	trackClass = "mediavault-card-progress",
	fillClass = "mediavault-card-progress-fill"
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
