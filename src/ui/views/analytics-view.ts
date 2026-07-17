import { ItemView, WorkspaceLeaf } from "obsidian";
import type { Chart } from "chart.js";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_ANALYTICS } from "../../constants";
import { computeAnalyticsMemoized } from "../../services/analytics/memoized";
import { createChart, CHART_PALETTE, themeColors } from "../components/chart-wrapper";
import { computeDailyWatchCounts, renderCalendarHeatmap } from "../components/heatmap";

/**
 * The full visual analytics dashboard. Charts are created lazily — only
 * when the view is actually opened — and every chart instance is torn
 * down via .destroy() before the next render, since Chart.js keeps a
 * live render loop attached to each canvas that won't stop on its own.
 */
export class AnalyticsView extends ItemView {
	private plugin: MediaVaultPlugin;
	private activeCharts: Chart[] = [];

	constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_ANALYTICS;
	}

	getDisplayText(): string {
		return "MediaVault Analytics";
	}

	getIcon(): string {
		return "bar-chart-3";
	}

	async onOpen(): Promise<void> {
		await this.render();
	}

	async onClose(): Promise<void> {
		this.destroyCharts();
	}

	async refresh(): Promise<void> {
		await this.render();
	}

	private destroyCharts(): void {
		this.activeCharts.forEach((c) => c.destroy());
		this.activeCharts = [];
	}

	private async render(): Promise<void> {
		this.destroyCharts();

		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("mediavault-analytics-view");

		const [media, sessions, episodes, episodeProgress] = await Promise.all([
			this.plugin.storage.media.getAll(),
			this.plugin.storage.watchSessions.getAll(),
			this.plugin.storage.episodes.getAll(),
			this.plugin.storage.episodeProgress.getAll(),
		]);

		const stats = computeAnalyticsMemoized({ media, sessions, episodes, episodeProgress }, this.plugin.storage.getDataVersion());

		if (media.length === 0) {
			root.createDiv({
				cls: "mediavault-analytics-empty",
				text: "Add some media and log a few watches to see your stats here.",
			});
			return;
		}

		const headline = root.createDiv({ cls: "mediavault-analytics-headline" });
		headline.createDiv({ text: `${stats.moviesWatchedCount} movies · ${stats.episodesWatchedCount} episodes watched` });
		headline.createDiv({
			cls: "mediavault-analytics-subline",
			text: `${Math.floor(stats.totalRuntimeMinutes / 60)}h total · avg rating ${stats.averageRating?.toFixed(1) ?? "—"} · ${stats.completionRate}% completed`,
		});

		const grid = root.createDiv({ cls: "mediavault-analytics-chart-grid" });

		// --- Genre breakdown: pie chart ---
		if (stats.topGenres.length > 0) {
			const card = this.chartCard(grid, "Genre breakdown");
			const chart = createChart(
				card,
				"pie",
				{
					labels: stats.topGenres.map((g) => g.label),
					datasets: [
						{
							data: stats.topGenres.map((g) => g.count),
							backgroundColor: CHART_PALETTE,
						},
					],
				},
				{ plugins: { legend: { position: "right" } } }
			);
			this.activeCharts.push(chart);
		}

		// --- Monthly watch trend: line chart ---
		if (stats.monthlyWatchTrend.length > 0) {
			const card = this.chartCard(grid, "Monthly watch trend");
			const colors = themeColors();
			const recent = stats.monthlyWatchTrend.slice(-12);
			const chart = createChart(
				card,
				"line",
				{
					labels: recent.map((t) => t.period),
					datasets: [
						{
							label: "Watches",
							data: recent.map((t) => t.count),
							borderColor: colors.accent,
							backgroundColor: colors.accent,
							tension: 0.3,
						},
					],
				},
				{
					plugins: { legend: { display: false } },
					scales: {
						x: { ticks: { color: colors.muted }, grid: { color: colors.border } },
						y: { ticks: { color: colors.muted }, grid: { color: colors.border }, beginAtZero: true },
					},
				}
			);
			this.activeCharts.push(chart);
		}

		// --- Rewatch frequency vs first watches: bar chart ---
		{
			const card = this.chartCard(grid, "Rewatch frequency");
			const colors = themeColors();
			const firstWatches = sessions.filter((s) => s.rewatchNumber === 0).length;
			const chart = createChart(
				card,
				"bar",
				{
					labels: ["First watches", "Rewatches"],
					datasets: [
						{
							data: [firstWatches, stats.rewatchCount],
							backgroundColor: [CHART_PALETTE[0], CHART_PALETTE[1]],
						},
					],
				},
				{
					plugins: { legend: { display: false } },
					scales: {
						x: { ticks: { color: colors.muted }, grid: { display: false } },
						y: { ticks: { color: colors.muted }, grid: { color: colors.border }, beginAtZero: true },
					},
				}
			);
			this.activeCharts.push(chart);
		}

		// --- Top actors: horizontal bar ---
		if (stats.topActors.length > 0) {
			const card = this.chartCard(grid, "Top actors");
			const colors = themeColors();
			const chart = createChart(
				card,
				"bar",
				{
					labels: stats.topActors.map((a) => a.label),
					datasets: [{ data: stats.topActors.map((a) => a.count), backgroundColor: CHART_PALETTE[2] }],
				},
				{
					indexAxis: "y",
					plugins: { legend: { display: false } },
					scales: {
						x: { ticks: { color: colors.muted }, grid: { color: colors.border }, beginAtZero: true },
						y: { ticks: { color: colors.muted }, grid: { display: false } },
					},
				}
			);
			this.activeCharts.push(chart);
		}

		// --- Watch activity heatmap (current year) ---
		const heatmapSection = root.createDiv({ cls: "mediavault-analytics-section" });
		heatmapSection.createEl("h3", { text: `Watch activity — ${new Date().getFullYear()}` });
		const dailyCounts = computeDailyWatchCounts(sessions, episodeProgress);
		renderCalendarHeatmap(heatmapSection, dailyCounts, new Date().getFullYear());
	}

	private chartCard(container: HTMLElement, title: string): HTMLElement {
		const card = container.createDiv({ cls: "mediavault-chart-card" });
		card.createEl("h3", { text: title });
		const canvasWrap = card.createDiv({ cls: "mediavault-chart-canvas-wrap" });
		return canvasWrap;
	}
}
