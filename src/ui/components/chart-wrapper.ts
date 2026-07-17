import {
	Chart,
	ChartConfiguration,
	ChartData,
	ChartOptions,
	LineController,
	LineElement,
	PointElement,
	BarController,
	BarElement,
	PieController,
	ArcElement,
	CategoryScale,
	LinearScale,
	Tooltip,
	Legend,
} from "chart.js";

// Register only what MediaVault actually uses — keeps the bundle lean
// instead of pulling in chart.js's full "auto" registry.
Chart.register(
	LineController,
	LineElement,
	PointElement,
	BarController,
	BarElement,
	PieController,
	ArcElement,
	CategoryScale,
	LinearScale,
	Tooltip,
	Legend
);

/** Reads a CSS custom property from the document so charts inherit the active Obsidian theme's colors. */
function cssVar(name: string, fallback: string): string {
	const value = getComputedStyle(document.body).getPropertyValue(name).trim();
	return value || fallback;
}

export function themeColors() {
	return {
		text: cssVar("--text-normal", "#dcddde"),
		muted: cssVar("--text-muted", "#999"),
		accent: cssVar("--interactive-accent", "#7c3aed"),
		border: cssVar("--background-modifier-border", "#444"),
	};
}

/** A fixed rotating palette for multi-slice charts (pies, multi-series bars), theme-agnostic since it needs N distinct hues. */
export const CHART_PALETTE = [
	"#7c9eff", "#ff9e7c", "#7cffb2", "#e77cff", "#ffe07c",
	"#7cd8ff", "#ff7c9e", "#b2ff7c", "#c17cff", "#ffb27c",
];

/**
 * Creates a Chart.js chart inside a fresh canvas appended to `container`.
 * Returns the Chart instance so the caller can call .destroy() before
 * re-rendering (e.g. on data refresh) — Chart.js does not garbage-collect
 * old instances left attached to a canvas automatically.
 */
export function createChart(
	container: HTMLElement,
	type: ChartConfiguration["type"],
	data: ChartData,
	options: ChartOptions = {}
): Chart {
	const canvas = container.createEl("canvas");
	const colors = themeColors();

	const mergedOptions: ChartOptions = {
		responsive: true,
		maintainAspectRatio: false,
		color: colors.text,
		plugins: {
			legend: {
				labels: { color: colors.text },
			},
			...options.plugins,
		},
		scales: options.scales,
		...options,
	};

	return new Chart(canvas, { type, data, options: mergedOptions } as ChartConfiguration);
}
