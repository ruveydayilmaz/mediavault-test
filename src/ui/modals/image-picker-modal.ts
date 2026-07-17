import { App, Modal, Notice } from "obsidian";
import type { TMDBService } from "../../api/tmdb";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { TMDBImageOption } from "../../types/tmdb";

export type ImagePickerKind = "poster" | "backdrop";

/**
 * Fetches every TMDB poster or backdrop for a title and lets the user pick
 * one, persisted via `onSelect`. Used by MediaDetailModal's three-dot menu
 * "Edit Poster" / "Edit Banner" actions (Milestone 3).
 */
export class ImagePickerModal extends Modal {
	private tmdb: TMDBService;
	private tmdbId: number;
	private mediaKind: "movie" | "tv";
	private imageKind: ImagePickerKind;
	private currentPath: string | null;
	private onSelect: (filePath: string) => void | Promise<void>;

	constructor(
		app: App,
		tmdb: TMDBService,
		tmdbId: number,
		mediaKind: "movie" | "tv",
		imageKind: ImagePickerKind,
		currentPath: string | null,
		onSelect: (filePath: string) => void | Promise<void>
	) {
		super(app);
		this.tmdb = tmdb;
		this.tmdbId = tmdbId;
		this.mediaKind = mediaKind;
		this.imageKind = imageKind;
		this.currentPath = currentPath;
		this.onSelect = onSelect;
	}

	onOpen(): void {
		void this.render();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-image-picker-modal");

		contentEl.createEl("h3", { text: this.imageKind === "poster" ? "Choose a poster" : "Choose a banner" });

		const loading = contentEl.createDiv({ cls: "mediavault-modal-hint", text: "Loading images from TMDB..." });

		let options: TMDBImageOption[];
		try {
			const images = await this.tmdb.getImages(this.tmdbId, this.mediaKind);
			options = this.imageKind === "poster" ? images.posters : images.backdrops;
		} catch {
			loading.setText("Couldn't load images from TMDB. Check your API key and connection.");
			return;
		}

		loading.remove();

		if (options.length === 0) {
			contentEl.createDiv({ cls: "mediavault-modal-hint", text: "No images available for this title." });
			return;
		}

		const grid = contentEl.createDiv({ cls: "mediavault-image-picker-grid" });
		grid.addClass(this.imageKind === "poster" ? "is-poster-grid" : "is-backdrop-grid");

		options.forEach((option) => {
			const tile = grid.createDiv({
				cls: `mediavault-image-picker-tile ${option.filePath === this.currentPath ? "is-selected" : ""}`,
			});
			const url = tmdbImageUrl(option.filePath, "w342");
			if (url) {
				tile.createEl("img", { attr: { src: url, loading: "lazy" } });
			}
			if (option.filePath === this.currentPath) {
				tile.createDiv({ cls: "mediavault-image-picker-current-badge", text: "Current" });
			}
			tile.addEventListener("click", async () => {
				await this.onSelect(option.filePath);
				new Notice(`MediaVault: ${this.imageKind === "poster" ? "poster" : "banner"} updated.`);
				this.close();
			});
		});
	}
}
