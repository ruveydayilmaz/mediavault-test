import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";

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
      t("addToList.addToListTitle", { title: this.media.title }),
      "h3",
    );

    const lists = await this.storage.customLists.getAll();
    const listEl = contentEl.createDiv({
      cls: "mediavault-add-to-list-options",
    });

    if (lists.length === 0) {
      listEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("addToList.noListsYet"),
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
            t("addToList.removeConfirm", {
              title: this.media.title,
              list: list.title,
            }),
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
      attr: { placeholder: t("addToList.newListPlaceholder") },
    });
    makeClearable(newListInput);
    const createBtn = createRow.createEl("button", {
      text: t("addToList.createAndAdd"),
      cls: "mod-cta",
    });
    createBtn.addEventListener("click", async () => {
      const title = newListInput.value.trim();
      if (!title) {
        new Notice(t("notice.enterListName"));
        return;
      }
      const list = await this.storage.customLists.create({ title });
      await this.storage.customLists.addMedia(list.id, this.media.id);
      this.onChanged?.();
      await this.render();
    });
  }
}
