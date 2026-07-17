import { App, Modal } from "obsidian";
import type { StorageService } from "../../services/storage";
import { computeAnalyticsMemoized } from "../../services/analytics/memoized";
import { CountItem } from "../../services/analytics/types";

function formatRuntime(minutes: number): string {
	const hours = Math.floor(minutes / 60);
	const mins = minutes % 60;
	return `${hours.toLocaleString()}h ${mins}m`;
}

/**
 * Text-based stats summary — a quick "how much have I watched" view.
 * The full visual dashboard (pie/bar/trend/heatmap charts via Chart.js) is
 * Milestone 12; this surfaces the same computeAnalytics() backend in the
 * meantime as a simple readable list.
 */
export class AnalyticsSummaryModal extends Modal {
	private storage: StorageService;

	constructor(app: App, storage: StorageService) {
		super(app);
		this.storage = storage;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-analytics-modal");
		contentEl.createEl("h2", { text: "Your MediaVault Stats" });

		const [media, sessions, episodes, episodeProgress] = await Promise.all([
			this.storage.media.getAll(),
			this.storage.watchSessions.getAll(),
			this.storage.episodes.getAll(),
			this.storage.episodeProgress.getAll(),
		]);

		const stats = computeAnalyticsMemoized({ media, sessions, episodes, episodeProgress }, this.storage.getDataVersion());

		const headline = contentEl.createDiv({ cls: "mediavault-analytics-headline" });
		headline.createDiv({ text: `You've watched ${formatRuntime(stats.totalRuntimeMinutes)}` });
		headline.createDiv({
			cls: "mediavault-analytics-subline",
			text: `${stats.moviesWatchedCount} movies · ${stats.episodesWatchedCount} episodes · ${stats.rewatchCount} rewatches`,
		});

		const grid = contentEl.createDiv({ cls: "mediavault-analytics-grid" });
		this.stat(grid, "Average rating", stats.averageRating !== null ? stats.averageRating.toFixed(1) : "—");
		this.stat(grid, "Completion rate", `${stats.completionRate}%`);
		this.stat(grid, "Library size", String(media.length));

		this.renderTopList(contentEl, "Top genres", stats.topGenres);
		this.renderTopList(contentEl, "Top actors", stats.topActors);
		this.renderTopList(contentEl, "Top directors", stats.topDirectors);
		this.renderTopList(contentEl, "Top studios", stats.topStudios);

		if (stats.monthlyWatchTrend.length > 0) {
			contentEl.createEl("h3", { text: "Monthly watch trend" });
			const trendEl = contentEl.createDiv({ cls: "mediavault-analytics-trend" });
			const maxCount = Math.max(...stats.monthlyWatchTrend.map((t) => t.count));
			stats.monthlyWatchTrend.slice(-12).forEach((t) => {
				const row = trendEl.createDiv({ cls: "mediavault-analytics-trend-row" });
				row.createSpan({ cls: "mediavault-analytics-trend-label", text: t.period });
				const barTrack = row.createDiv({ cls: "mediavault-analytics-trend-track" });
				const bar = barTrack.createDiv({ cls: "mediavault-analytics-trend-bar" });
				bar.style.width = `${(t.count / maxCount) * 100}%`;
				row.createSpan({ cls: "mediavault-analytics-trend-count", text: String(t.count) });
			});
		}
	}

	private stat(container: HTMLElement, label: string, value: string): void {
		const box = container.createDiv({ cls: "mediavault-analytics-stat" });
		box.createDiv({ cls: "mediavault-analytics-stat-value", text: value });
		box.createDiv({ cls: "mediavault-analytics-stat-label", text: label });
	}

	private renderTopList(container: HTMLElement, title: string, items: CountItem[]): void {
		if (items.length === 0) return;
		container.createEl("h3", { text: title });
		const list = container.createDiv({ cls: "mediavault-analytics-toplist" });
		items.slice(0, 5).forEach((item) => {
			const row = list.createDiv({ cls: "mediavault-analytics-toplist-row" });
			row.createSpan({ text: item.label });
			row.createSpan({ cls: "mediavault-analytics-toplist-count", text: String(item.count) });
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
