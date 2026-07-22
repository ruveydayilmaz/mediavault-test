import { App, Modal, Notice } from "obsidian";
import { renderMobileBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { CustomList } from "../../models/list";

export class CreateListModal extends Modal {
	private storage: StorageService;
	private onCreated: (list: CustomList) => void;

	constructor(app: App, storage: StorageService, onCreated: (list: CustomList) => void) {
		super(app);
		this.storage = storage;
		this.onCreated = onCreated;
	}

	onOpen(): void {
		const { contentEl } = this;
		contentEl.addClass("mediavault-create-list-modal");
		renderMobileBackButton(this, contentEl);
		contentEl.createEl("h3", { text: "New list" });

		const titleInput = contentEl.createEl("input", { type: "text", attr: { placeholder: "Title, e.g. \"Cozy Anime\"" } });
		const descInput = contentEl.createEl("textarea", { attr: { placeholder: "Description (optional)" } });

		const createBtn = contentEl.createEl("button", { text: "Create", cls: "mod-cta" });
		createBtn.addEventListener("click", async () => {
			const title = titleInput.value.trim();
			if (!title) {
				new Notice("MediaVault: enter a list name first.");
				return;
			}
			const list = await this.storage.customLists.create({ title, description: descInput.value.trim() || null });
			this.onCreated(list);
			this.close();
		});

		titleInput.addEventListener("keydown", (evt) => {
			if (evt.key === "Enter") createBtn.click();
		});
	}
}
