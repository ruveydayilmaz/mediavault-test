import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { buildRecommendations, RecommendationSet } from "../../services/recommendation/engine";
import { renderDiscoverCard, DiscoverCardData } from "../components/discover-card";

const CATEGORY_TITLES: Record<keyof RecommendationSet, string> = {
	similarToFavorites: "Because you loved...",
	hiddenGems: "Hidden gems for you",
	comfortRewatch: "Comfort rewatches",
	highEnergy: "High-energy picks",
	lowAttention: "Low-attention picks",
};

/**
 * Shares its card rendering, grid/row sizing, loading, and empty states
 * with the Explore view's Discover tab via `renderDiscoverCard` and the
 * `.mediavault-explore-*` classes (Library/Favorites roadmap, Milestone 3)
 * — this modal no longer maintains its own separate card implementation.
 * The modal itself is the only vertically-scrolling container; each
 * recommendation row scrolls horizontally only.
 */
export class RecommendationsModal extends Modal {
	private storage: StorageService;
	private tmdb: TMDBService;

	constructor(app: App, storage: StorageService, tmdb: TMDBService) {
		super(app);
		this.storage = storage;
		this.tmdb = tmdb;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-recommendations-modal");
		renderModalHeader(this, contentEl, "Recommended for you");

		const loading = contentEl.createDiv({ cls: "mediavault-rec-loading", text: "Building recommendations..." });

		let recs: RecommendationSet;
		try {
			recs = await buildRecommendations(this.storage, this.tmdb);
		} catch (err) {
			loading.setText(`Failed to build recommendations — ${(err as Error).message}`);
			return;
		}
		loading.remove();

		const hasAny = Object.values(recs).some((list) => list.length > 0);
		if (!hasAny) {
			contentEl.createDiv({
				cls: "mediavault-rec-empty",
				text: "Not enough data yet — rate a few watches and set up some comfort profiles to get recommendations.",
			});
			return;
		}

		(Object.keys(recs) as (keyof RecommendationSet)[]).forEach((key) => {
			const list = recs[key];
			if (list.length === 0) return;
			contentEl.createEl("h3", { text: CATEGORY_TITLES[key] });
			const row = contentEl.createDiv({ cls: "mediavault-explore-row" });
			list.forEach((rec) => {
				if (!rec.mediaId && (!rec.tmdbId || !rec.mediaKind)) return;
				const card: DiscoverCardData = {
					tmdbId: rec.tmdbId ?? 0,
					mediaKind: rec.mediaKind ?? "movie",
					title: rec.title,
					year: rec.year,
					posterPath: rec.posterPath,
					reason: rec.reasons[0],
					mediaId: rec.mediaId,
				};
				renderDiscoverCard(row, { app: this.app, storage: this.storage, tmdb: this.tmdb }, card);
			});
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
