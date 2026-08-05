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
  Legend,
);

// getComputedStyle() forces a style/layout recalculation, so recomputing it
// once per chart (interleaved with each chart's canvas DOM insertion) causes
// repeated forced reflows when a view renders several charts back to back.
// Theme colors only change when the Obsidian theme itself changes, so a
// short-lived cache lets a whole render pass share a single read.
let cachedColors: ReturnType<typeof computeThemeColors> | null = null;

function computeThemeColors() {
  const bodyStyle = getComputedStyle(document.body);
  const cssVar = (name: string, fallback: string): string => {
    const value = bodyStyle.getPropertyValue(name).trim();
    return value || fallback;
  };
  return {
    text: cssVar("--text-normal", "#dcddde"),
    muted: cssVar("--text-muted", "#999"),
    accent: cssVar("--interactive-accent", "#7c3aed"),
    border: cssVar("--background-modifier-border", "#444"),
  };
}

export function themeColors() {
  if (!cachedColors) {
    cachedColors = computeThemeColors();
    // Invalidate on the next frame so a later render pass (e.g. after a
    // theme change) always picks up fresh values, while calls made
    // synchronously within the same render pass reuse this one read.
    requestAnimationFrame(() => {
      cachedColors = null;
    });
  }
  return cachedColors;
}

export const CHART_PALETTE = [
  "#7c9eff",
  "#ff9e7c",
  "#7cffb2",
  "#e77cff",
  "#ffe07c",
  "#7cd8ff",
  "#ff7c9e",
  "#b2ff7c",
  "#c17cff",
  "#ffb27c",
];

export function createChart(
  container: HTMLElement,
  type: ChartConfiguration["type"],
  data: ChartData,
  options: ChartOptions = {},
): Chart {
  // Read theme colors before touching the DOM so this doesn't interleave a
  // style read with the canvas insertion below (which would force a
  // synchronous style/layout recalculation).
  const colors = themeColors();
  const canvas = container.createEl("canvas");

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

  return new Chart(canvas, {
    type,
    data,
    options: mergedOptions,
  } as ChartConfiguration);
}
