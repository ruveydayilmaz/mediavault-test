import { MediaItem } from "../../models/media";
import { MediaStatus } from "../../types/enums";
import { tmdbImageUrl } from "../../api/tmdb-normalize";

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

export function renderPoster(container: HTMLElement, item: MediaItem, size: "w200" | "w342" = "w200"): void {
	const posterUrl = tmdbImageUrl(item.posterPath, size);
	if (posterUrl) {
		container.createEl("img", { attr: { src: posterUrl, alt: item.title, loading: "lazy" } });
	} else {
		container.setText("🎬");
	}
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
