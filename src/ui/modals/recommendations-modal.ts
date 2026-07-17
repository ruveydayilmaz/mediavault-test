import { App, Modal, Notice } from "obsidian";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { buildRecommendations, RecommendationSet } from "../../services/recommendation/engine";
import { Recommendation } from "../../services/recommendation/types";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { addMediaFromTMDB } from "../../services/media-import";
import { MediaDetailModal } from "./media-detail-modal";

const CATEGORY_TITLES: Record<keyof RecommendationSet, string> = {
	similarToFavorites: "Because you loved...",
	hiddenGems: "Hidden gems for you",
	comfortRewatch: "Comfort rewatches",
	highEnergy: "High-energy picks",
	lowAttention: "Low-attention picks",
};

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
		contentEl.createEl("h2", { text: "Recommended for you" });

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
			const row = contentEl.createDiv({ cls: "mediavault-rec-row" });
			list.forEach((rec) => this.renderCard(row, rec));
		});
	}

	private renderCard(container: HTMLElement, rec: Recommendation): void {
		const card = container.createDiv({ cls: "mediavault-rec-card" });

		const poster = card.createDiv({ cls: "mediavault-rec-poster" });
		const posterUrl = tmdbImageUrl(rec.posterPath, "w200");
		if (posterUrl) {
			poster.createEl("img", { attr: { src: posterUrl, alt: rec.title, loading: "lazy" } });
		} else {
			poster.setText("🎬");
		}

		const info = card.createDiv({ cls: "mediavault-rec-info" });
		info.createDiv({ cls: "mediavault-rec-title", text: rec.year ? `${rec.title} (${rec.year})` : rec.title });
		if (rec.reasons.length > 0) {
			info.createDiv({ cls: "mediavault-rec-reason", text: rec.reasons[0] });
		}

		if (rec.mediaId) {
			// Already in the library — open its detail view.
			card.addEventListener("click", async () => {
				const media = await this.storage.media.findById(rec.mediaId as string);
				if (media) {
					this.close();
					new MediaDetailModal(this.app, this.storage, this.tmdb, media).open();
				}
			});
		} else if (rec.tmdbId && rec.mediaKind) {
			const addBtn = info.createEl("button", { text: "Add to library" });
			addBtn.addEventListener("click", async (evt) => {
				evt.stopPropagation();
				try {
					const result = await addMediaFromTMDB(this.storage, this.tmdb, rec.tmdbId as number, rec.mediaKind as "movie" | "tv");
					new Notice(
						result.alreadyExisted
							? `MediaVault: "${result.mediaItem.title}" is already in your library.`
							: `MediaVault: added "${result.mediaItem.title}" to your library.`
					);
				} catch (err) {
					new Notice(`MediaVault: failed to add — ${(err as Error).message}`);
				}
			});
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
