import { DashboardStatistics, formatWatchTime } from "../../services/statistics-service";

interface StatCardRefs {
	valueEl: HTMLElement;
}

interface MobileStatRefs {
	movieTime: HTMLElement;
	tvTime: HTMLElement;
	movieCount: HTMLElement;
	episodeCount: HTMLElement;
}
export class StatsBar {
	private barEl: HTMLElement | null = null;
	private cards: StatCardRefs[] = [];
	private mobileRefs: MobileStatRefs | null = null;

	/** Creates the DOM structure once. Safe to call multiple times — a later call is a no-op if already mounted. */
	mount(container: HTMLElement, mobile = false): void {
		if (this.barEl && this.barEl.isConnected) return;

		container.empty();
		this.barEl = container.createDiv({
			cls: mobile
				? "mediavault-stats-bar mediavault-stats-mobile"
				: "mediavault-stats-bar",
		});

		if (mobile) {
			this.createMobileCard(this.barEl);
			return;
		}

		this.cards = [
			this.createCard(this.barEl, "Movies Watched"),
			this.createCard(this.barEl, "Movie Watch Time"),
			this.createCard(this.barEl, "Episodes Watched"),
			this.createCard(this.barEl, "TV Watch Time"),
		];
	}

	/** Updates the existing cards in place. Mounts first if this is the first call. */
	update(container: HTMLElement, stats: DashboardStatistics, mobile = false): void {
		this.mount(container, mobile);

		if (mobile && this.mobileRefs) {
			this.mobileRefs.movieTime.setText(formatWatchTime(stats.movieRuntimeMinutes));
			this.mobileRefs.tvTime.setText(formatWatchTime(stats.episodeRuntimeMinutes));

			this.mobileRefs.movieCount.setText(
				`${stats.movieCount.toLocaleString()} movies watched`
			);

			this.mobileRefs.episodeCount.setText(
				`${stats.episodeCount.toLocaleString()} episodes watched`
			);

			return;
		}

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

	private createMobileCard(container: HTMLElement): void {
		const card = container.createDiv({
			cls: "mediavault-stat-mobile-card",
		});

		const columns = card.createDiv({
			cls: "mediavault-stat-mobile-columns",
		});

		const movie = columns.createDiv({
			cls: "mediavault-stat-mobile-column",
		});

		const tv = columns.createDiv({
			cls: "mediavault-stat-mobile-column",
		});

		this.mobileRefs = {
			movieTime: movie.createDiv({
				cls: "mediavault-stat-mobile-value",
				text: "—",
			}),
			movieCount: movie.createDiv({
				cls: "mediavault-stat-mobile-label",
				text: "Movies",
			}),
			tvTime: tv.createDiv({
				cls: "mediavault-stat-mobile-value",
				text: "—",
			}),
			episodeCount: tv.createDiv({
				cls: "mediavault-stat-mobile-label",
				text: "TV",
			}),
		};
	}
}
