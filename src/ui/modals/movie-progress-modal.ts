import { App, Modal, Setting, Notice } from "obsidian";
import { renderMobileBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";
import { setMovieProgress } from "../../services/movie-progress-service";

export interface MoviePartialWatchModalOptions {
	media: MediaItem;
	existingMinute: number | null;
	onSaved: () => void;
}

/** "Where did you stop watching? [ 74 ] minutes" (Milestone 3: Partially Watched Movies). */
export class MoviePartialWatchModal extends Modal {
	private storage: StorageService;
	private options: MoviePartialWatchModalOptions;
	private minute: number | null;

	constructor(app: App, storage: StorageService, options: MoviePartialWatchModalOptions) {
		super(app);
		this.storage = storage;
		this.options = options;
		this.minute = options.existingMinute;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("mediavault-movie-progress-modal");
		renderMobileBackButton(this, contentEl);
		contentEl.createEl("h3", { text: "Where did you stop watching?" });

		new Setting(contentEl).setName("Minutes in").addText((text) => {
			text.inputEl.type = "number";
			text.inputEl.min = "0";
			text
				.setPlaceholder("74")
				.setValue(this.minute !== null ? String(this.minute) : "")
				.onChange((value) => {
					const parsed = parseInt(value, 10);
					this.minute = value.trim() === "" || isNaN(parsed) ? null : parsed;
				});
			text.inputEl.focus();
		});

		const buttons = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

		const saveBtn = buttons.createEl("button", { cls: "mod-cta", text: "Save" });
		saveBtn.addEventListener("click", async () => {
			if (this.minute === null || this.minute < 0) {
				new Notice("MediaVault: enter how many minutes in you stopped.");
				return;
			}
			await setMovieProgress(this.storage, this.options.media, this.minute);
			new Notice(`MediaVault: saved progress at ${this.minute} min.`);
			this.options.onSaved();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
