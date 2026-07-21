import { App, Modal, Notice } from "obsidian";
import type { StorageService } from "../../services/storage";
import { dropSeries } from "../../services/drop-series-service";

export interface DropSeriesModalOptions {
	mediaId: string;
	mediaTitle: string;
	onDropped: () => void;
}

export class DropSeriesModal extends Modal {
	private storage: StorageService;
	private options: DropSeriesModalOptions;
	private reason = "";

	constructor(app: App, storage: StorageService, options: DropSeriesModalOptions) {
		super(app);
		this.storage = storage;
		this.options = options;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("mediavault-drop-series-modal");
		contentEl.createEl("h3", { text: "Why did you stop watching?" });
		contentEl.createDiv({
			cls: "mediavault-modal-hint",
			text: `Optional — for "${this.options.mediaTitle}". Leave blank if you'd rather not say.`,
		});

		const textarea = contentEl.createEl("textarea", {
			cls: "mediavault-episode-notes-input",
			attr: { placeholder: "e.g. I lost interest after Season 3." },
		});
		textarea.addEventListener("input", () => {
			this.reason = textarea.value;
		});

		const buttons = contentEl.createDiv({ cls: "mediavault-modal-buttons" });
		buttons.createEl("button", { text: "Cancel" }).addEventListener("click", () => this.close());

		const dropBtn = buttons.createEl("button", { cls: "mod-warning", text: "Drop Series" });
		dropBtn.addEventListener("click", async () => {
			await dropSeries(this.storage, this.options.mediaId, this.reason);
			new Notice(`MediaVault: marked "${this.options.mediaTitle}" as dropped.`);
			this.options.onDropped();
			this.close();
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
