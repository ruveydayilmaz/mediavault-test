import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";
import { t } from "../../i18n";
import { makeClearable } from "../components/clearable-input";
import { renderListCard } from "../components/list-card";

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
      t("addToList.addToListTitle"),
      "h3",
    );

    const [lists, allMedia] = await Promise.all([
      this.storage.customLists.getAll(),
      this.storage.media.getAll(),
    ]);
    const listEl = contentEl.createDiv({
      cls: "mediavault-add-to-list-options mediavault-lists-grid",
    });

    if (lists.length === 0) {
      listEl.createEl("p", {
        cls: "mediavault-empty-state",
        text: t("addToList.noListsYet"),
      });
    }

    for (const list of lists) {
      const alreadyIn = list.mediaIds.includes(this.media.id);
      const card = renderListCard(listEl, list, allMedia, (cardEl) => {
        if (alreadyIn) {
          const confirmed = confirm(
            t("addToList.removeConfirm", {
              title: this.media.title,
              list: list.title,
            }),
          );
          if (!confirmed) return;
          void this.storage.customLists
            .removeMedia(list.id, this.media.id)
            .then(async () => {
              this.onChanged?.();
              await this.render();
            });
          return;
        }

        void this.storage.customLists
          .addMedia(list.id, this.media.id)
          .then(() => {
            this.onChanged?.();
            cardEl.addClass("is-added-flash");
            window.setTimeout(() => {
              cardEl.removeClass("is-added-flash");
            }, 900);
          });
      });

      if (alreadyIn) {
        card.addClass("is-in-list");
        card.createDiv({
          cls: "mediavault-list-card-in-badge",
          text: t("addToList.alreadyInList"),
        });
      }
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
