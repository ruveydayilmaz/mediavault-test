import { App, Modal, Setting, Notice } from "obsidian";
import type { StorageService } from "../../services/storage";
import { WatchSession } from "../../models/review";
import { Mood, WatchSource } from "../../types/enums";
import { addWatchSession, updateWatchSession } from "../../services/watch-session-service";

interface WatchSessionModalOptions {
	mediaId: string;
	mediaTitle: string;
	/** If provided, the modal edits this existing session instead of creating a new one. */
	existingSession?: WatchSession;
	onSaved?: () => void;
}

/**
 * Modal for logging a new watch (rewatch) or editing an existing one.
 * Creating always calls addWatchSession (a NEW session, never overwriting
 * prior ones); only explicitly editing an existing session updates it.
 */
export class WatchSessionModal extends Modal {
	private storage: StorageService;
	private options: WatchSessionModalOptions;

	private watchDate: string;
	private rating: number | null;
	private review: string;
	private mood: Mood | null;
	private context: string;
	private watchSource: WatchSource | null;

	constructor(app: App, storage: StorageService, options: WatchSessionModalOptions) {
		super(app);
		this.storage = storage;
		this.options = options;

		const existing = options.existingSession;
		this.watchDate = existing?.watchDate ?? new Date().toISOString().slice(0, 10);
		this.rating = existing?.rating ?? null;
		this.review = existing?.review ?? "";
		this.mood = existing?.mood ?? null;
		this.context = existing?.context ?? "";
		this.watchSource = existing?.watchSource ?? null;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-watch-session-modal");

		const isEdit = !!this.options.existingSession;
		contentEl.createEl("h2", {
			text: isEdit
				? `Edit review — ${this.options.mediaTitle}`
				: `Log a watch — ${this.options.mediaTitle}`,
		});

		if (!isEdit) {
			contentEl.createEl("p", {
				cls: "mediavault-modal-hint",
				text: "This creates a new watch session. Past reviews are never overwritten.",
			});
		}

		new Setting(contentEl).setName("Watch date").addText((text) =>
			text.setValue(this.watchDate).onChange((value) => {
				this.watchDate = value;
			}).inputEl.setAttribute("type", "date")
		);

		new Setting(contentEl).setName("Rating (0-10)").addText((text) =>
			text
				.setPlaceholder("e.g. 8.5")
				.setValue(this.rating !== null ? String(this.rating) : "")
				.onChange((value) => {
					const parsed = parseFloat(value);
					this.rating = value.trim() === "" || isNaN(parsed) ? null : parsed;
				})
		);

		new Setting(contentEl).setName("Mood").addDropdown((dropdown) => {
			dropdown.addOption("", "—");
			Object.values(Mood).forEach((m) => dropdown.addOption(m, m[0].toUpperCase() + m.slice(1)));
			dropdown.setValue(this.mood ?? "");
			dropdown.onChange((value) => {
				this.mood = (value as Mood) || null;
			});
		});

		new Setting(contentEl).setName("Watch source").addDropdown((dropdown) => {
			dropdown.addOption("", "—");
			Object.values(WatchSource).forEach((s) =>
				dropdown.addOption(s, s.replace("_", " ").replace(/^./, (c) => c.toUpperCase()))
			);
			dropdown.setValue(this.watchSource ?? "");
			dropdown.onChange((value) => {
				this.watchSource = (value as WatchSource) || null;
			});
		});

		new Setting(contentEl).setName("Context").setDesc("e.g. \"rainy Sunday\", \"watched with family\"").addText((text) =>
			text.setValue(this.context).onChange((value) => {
				this.context = value;
			})
		);

		new Setting(contentEl).setName("Review").addTextArea((textarea) => {
			textarea.setValue(this.review).onChange((value) => {
				this.review = value;
			});
			textarea.inputEl.rows = 6;
			textarea.inputEl.addClass("mediavault-review-textarea");
		});

		const buttonRow = contentEl.createDiv({ cls: "mediavault-modal-buttons" });

		const saveBtn = buttonRow.createEl("button", {
			text: isEdit ? "Save changes" : "Log watch",
			cls: "mod-cta",
		});
		saveBtn.addEventListener("click", () => void this.save());

		const cancelBtn = buttonRow.createEl("button", { text: "Cancel" });
		cancelBtn.addEventListener("click", () => this.close());
	}

	private async save(): Promise<void> {
		if (!this.watchDate) {
			new Notice("MediaVault: please set a watch date.");
			return;
		}
		if (this.rating !== null && (this.rating < 0 || this.rating > 10)) {
			new Notice("MediaVault: rating must be between 0 and 10.");
			return;
		}

		try {
			if (this.options.existingSession) {
				await updateWatchSession(this.storage, this.options.existingSession.id, {
					watchDate: this.watchDate,
					rating: this.rating,
					review: this.review,
					mood: this.mood,
					context: this.context || null,
					watchSource: this.watchSource,
				});
				new Notice("MediaVault: review updated.");
			} else {
				await addWatchSession(this.storage, {
					mediaId: this.options.mediaId,
					watchDate: this.watchDate,
					rating: this.rating,
					review: this.review,
					mood: this.mood,
					context: this.context || null,
					watchSource: this.watchSource,
				});
				new Notice("MediaVault: watch logged.");
			}
			this.options.onSaved?.();
			this.close();
		} catch (err) {
			new Notice(`MediaVault: failed to save — ${(err as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
