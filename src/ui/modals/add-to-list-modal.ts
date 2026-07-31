import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";

export class AddToListModal extends Modal {
  private storage: StorageService;
  private media: MediaItem;
  private onChanged?: () => void;

  constructor(
    app: App,
    storage: StorageService,
    media: MediaItem,
    onChanged?: () => void,
  ) {
    super(app);
    this.storage = storage;
    this.media = media;
    this.onChanged = onChanged;
  }

  onOpen(): void {
    void this.render();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-add-to-list-modal");
    renderModalHeader(
      this,
      contentEl,
      `Add "${this.media.title}" to a list`,
      "h3",
    );

    const lists = await this.storage.customLists.getAll();
    const listEl = contentEl.createDiv({
      cls: "mediavault-add-to-list-options",
    });

    if (lists.length === 0) {
      listEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: "You don't have any lists yet.",
      });
    }

    for (const list of lists) {
      const row = listEl.createEl("label", {
        cls: "mediavault-add-to-list-row",
      });
      const checkbox = row.createEl("input", { type: "checkbox" });
      checkbox.checked = list.mediaIds.includes(this.media.id);
      row.createSpan({ text: list.title });

      checkbox.addEventListener("change", async () => {
        if (checkbox.checked) {
          await this.storage.customLists.addMedia(list.id, this.media.id);
        } else {
          const confirmed = confirm(
            `Remove "${this.media.title}" from "${list.title}"?\n\nThis only removes it from this list — the item stays in your library, and your watch history/favorites are not affected.`,
          );
          if (!confirmed) {
            checkbox.checked = true;
            return;
          }
          await this.storage.customLists.removeMedia(list.id, this.media.id);
        }
        this.onChanged?.();
      });
    }

    const createRow = contentEl.createDiv({
      cls: "mediavault-add-to-list-create-row",
    });
    const newListInput = createRow.createEl("input", {
      type: "text",
      attr: { placeholder: "New list name..." },
    });
    const createBtn = createRow.createEl("button", {
      text: "Create + Add",
      cls: "mod-cta",
    });
    createBtn.addEventListener("click", async () => {
      const title = newListInput.value.trim();
      if (!title) {
        new Notice("MediaVault: enter a list name first.");
        return;
      }
      const list = await this.storage.customLists.create({ title });
      await this.storage.customLists.addMedia(list.id, this.media.id);
      this.onChanged?.();
      await this.render();
    });
  }
}
