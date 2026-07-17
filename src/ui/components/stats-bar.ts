import { DashboardStatistics, formatWatchTime } from "../../services/statistics-service";

interface StatCardRefs {
	valueEl: HTMLElement;
}

/**
 * Reusable Statistics component (Milestone 1: Statistics Refresh & Delete
 * Bug). Mounts the 4 stat cards exactly once via `mount()`; every
 * subsequent update calls `update()`, which writes into the already-mounted
 * value nodes instead of tearing down and recreating the bar. This makes
 * repeated/overlapping refreshes (e.g. two async refresh() calls racing
 * after a delete) idempotent — there's nothing to duplicate because nothing
 * is re-appended.
 */
export class StatsBar {
	private barEl: HTMLElement | null = null;
	private cards: StatCardRefs[] = [];

	/** Creates the DOM structure once. Safe to call multiple times — a later call is a no-op if already mounted. */
	mount(container: HTMLElement): void {
		if (this.barEl && this.barEl.isConnected) return;

		container.empty();
		this.barEl = container.createDiv({ cls: "mediavault-stats-bar" });
		this.cards = [
			this.createCard(this.barEl, "Movies Watched"),
			this.createCard(this.barEl, "Movie Watch Time"),
			this.createCard(this.barEl, "Episodes Watched"),
			this.createCard(this.barEl, "TV Watch Time"),
		];
	}

	/** Updates the existing cards in place. Mounts first if this is the first call. */
	update(container: HTMLElement, stats: DashboardStatistics): void {
		this.mount(container);

		const values = [
			String(stats.movieCount),
			formatWatchTime(stats.movieRuntimeMinutes),
			String(stats.episodeCount),
			formatWatchTime(stats.episodeRuntimeMinutes),
		];

		this.cards.forEach((card, i) => card.valueEl.setText(values[i]));
	}

	private createCard(container: HTMLElement, label: string): StatCardRefs {
		const card = container.createDiv({ cls: "mediavault-stat-card" });
		const valueEl = card.createDiv({ cls: "mediavault-stat-card-value", text: "—" });
		card.createDiv({ cls: "mediavault-stat-card-label", text: label });
		return { valueEl };
	}
}
