import { WatchSession } from "../../models/review";
import { EpisodeProgress } from "../../models/episode";

/** Aggregates every watch event (movie sessions + watched episodes) into counts per calendar day. */
export function computeDailyWatchCounts(
	sessions: WatchSession[],
	episodeProgress: EpisodeProgress[]
): Map<string, number> {
	const counts = new Map<string, number>();

	const addDate = (date: string | null) => {
		if (!date) return;
		const day = date.slice(0, 10);
		counts.set(day, (counts.get(day) ?? 0) + 1);
	};

	sessions.forEach((s) => addDate(s.watchDate));
	episodeProgress.filter((p) => p.watched).forEach((p) => addDate(p.watchedDate));

	return counts;
}

const MONTH_NAMES = [
	"Jan", "Feb", "Mar", "Apr", "May", "Jun",
	"Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

/**
 * Renders a simple month-by-day calendar heatmap for the given year: one
 * row per month, one cell per day, shaded by watch count that day. Kept as
 * plain CSS grid rather than a Chart.js plugin — heatmaps aren't a native
 * chart.js type and pulling in a plugin for this one view isn't worth it.
 */
export function renderCalendarHeatmap(container: HTMLElement, dailyCounts: Map<string, number>, year: number): void {
	const maxCount = Math.max(1, ...dailyCounts.values());
	const grid = container.createDiv({ cls: "mediavault-heatmap" });

	for (let month = 0; month < 12; month++) {
		const row = grid.createDiv({ cls: "mediavault-heatmap-row" });
		row.createSpan({ cls: "mediavault-heatmap-month-label", text: MONTH_NAMES[month] });

		const daysInMonth = new Date(year, month + 1, 0).getDate();
		const cellsEl = row.createDiv({ cls: "mediavault-heatmap-cells" });

		for (let day = 1; day <= daysInMonth; day++) {
			const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
			const count = dailyCounts.get(dateStr) ?? 0;
			const intensity = count === 0 ? 0 : Math.min(4, Math.ceil((count / maxCount) * 4));

			const cell = cellsEl.createDiv({ cls: `mediavault-heatmap-cell intensity-${intensity}` });
			cell.setAttr("title", `${dateStr}: ${count} watch${count === 1 ? "" : "es"}`);
		}
	}
}
