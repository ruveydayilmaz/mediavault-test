import { App, Modal, Notice, Menu } from "obsidian";
import { renderInlineBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type MediaVaultPlugin from "../../main";
import { CustomList, ListSortMode } from "../../models/list";
import { MediaItem } from "../../models/media";
import {
  sortListMedia,
  formatRelativeDate,
  getSystemFavoriteLists,
  SYSTEM_FAVORITE_MOVIES_ID,
} from "../../services/list-service";
import {
  renderPoster,
  getMediaPercentWatched,
  renderProgressOverlay,
} from "../components/media-render";
import { SelectMediaModal } from "./select-media-modal";
import { addDestructiveMenuItem } from "../components/destructive-menu-item";
import { isAndroidDevice } from "../../utils/platform";
import { t } from "../../i18n";

function getSortModeOptions(): { value: ListSortMode; label: string }[] {
  return [
    { value: "recent", label: t("lists.sortRecent") },
    { value: "manual", label: t("lists.sortManual") },
    { value: "dateAdded", label: t("lists.sortDateAdded") },
    { value: "title", label: t("lists.sortTitle") },
    { value: "rating", label: t("lists.sortRating") },
    { value: "year", label: t("lists.sortYear") },
    { value: "runtime", label: t("lists.sortRuntime") },
  ];
}

export class ListDetailModal extends Modal {
  private storage: StorageService;
  private plugin: MediaVaultPlugin;
  private list: CustomList;
  private onChanged?: () => void;
  private dragMediaId: string | null = null;

  constructor(
    app: App,
    plugin: MediaVaultPlugin,
    list: CustomList,
    onChanged?: () => void,
  ) {
    super(app);
    this.plugin = plugin;
    this.storage = plugin.storage;
    this.list = list;
    this.onChanged = onChanged;
  }

  onOpen(): void {
    this.plugin.registerLocaleAwareModal(this);
    void this.render();
  }

  onClose(): void {
    this.plugin.unregisterLocaleAwareModal(this);
    this.contentEl.empty();
  }

  rerenderForLocaleChange(): void {
    void this.render();
  }

  private notifyChanged(): void {
    this.plugin.refreshLibraryViews();
    this.plugin.refreshListViews();
    this.onChanged?.();
  }

  private async render(): Promise<void> {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-list-detail-modal");

    if (!this.list.isSystem) {
      const fresh = await this.storage.customLists.findById(this.list.id);
      if (!fresh) {
        contentEl.createDiv({
          cls: "mediavault-empty-state mediavault-list-detail-gone",
          text: t("lists.noLongerExists"),
        });
        return;
      }
      this.list = fresh;
    } else {
      const allMediaForRefresh = await this.storage.media.getAll();
      const fresh = getSystemFavoriteLists(
        allMediaForRefresh,
        this.storage.settings.get(),
      ).find((l) => l.id === this.list.id);
      if (fresh) this.list = fresh;
    }
    const allMedia = await this.storage.media.getAll();

    const header = contentEl.createDiv({
      cls: "mediavault-list-detail-header",
    });

    const titleRow = header.createDiv({
      cls: "mediavault-list-detail-title-row",
    });
    renderInlineBackButton(this, titleRow);
    const titleEl = titleRow.createDiv({
      cls: "mediavault-list-detail-title-text",
      text: this.list.title,
    });
    if (this.list.isImported) {
      titleRow.createDiv({
        cls: "mediavault-list-imported-badge",
        text: t("lists.imported"),
      });
    }
    if (this.list.isSystem) {
      titleRow.createDiv({
        cls: "mediavault-list-imported-badge",
        text: t("lists.builtIn"),
      });
    }

    if (!this.list.isSystem) {
      const menuBtn = titleRow.createEl("button", {
        cls: "mediavault-list-detail-menu-btn clickable-icon",
        attr: { "aria-label": t("lists.listActions") },
      });
      menuBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
      menuBtn.addEventListener("click", (evt) =>
        this.openListMenu(evt, titleEl, descEl),
      );
    }

    const metaRow = header.createDiv({ cls: "mediavault-list-detail-meta" });
    const addMetaPill = (text: string) =>
      metaRow.createSpan({ cls: "mediavault-list-detail-meta-pill", text });
    addMetaPill(
      t("lists.itemCountN", {
        count: this.list.mediaIds.length,
        plural: this.list.mediaIds.length === 1 ? "" : "s",
      }),
    );
    addMetaPill(
      t("lists.updated", { date: formatRelativeDate(this.list.updatedAt) }),
    );
    addMetaPill(this.list.owner ?? t("common.you"));

    const descEl = header.createDiv({
      cls: "mediavault-list-detail-description",
    });
    if (this.list.description) {
      descEl.setText(this.list.description);
    } else {
      descEl.addClass("is-placeholder");
      descEl.setText(t("lists.noDescription"));
    }

    {
      const sortRow = contentEl.createDiv({ cls: "mediavault-list-sort-row" });
      sortRow.createSpan({
        cls: "mediavault-list-sort-label",
        text: t("lists.sortBy"),
      });
      const sortSelect = sortRow.createEl("select", {
        cls: "mediavault-list-sort-select",
      });
      getSortModeOptions().forEach((opt) =>
        sortSelect.createEl("option", { value: opt.value, text: opt.label }),
      );
      sortSelect.value = this.list.sortMode;
      sortSelect.addEventListener("change", async () => {
        const mode = sortSelect.value as ListSortMode;
        if (this.list.isSystem) {
          const key =
            this.list.id === SYSTEM_FAVORITE_MOVIES_ID ? "movies" : "tv";
          await this.storage.settings.update({
            favoriteListSortModes: {
              ...this.storage.settings.get().favoriteListSortModes,
              [key]: mode,
            },
          });
        } else {
          const updated = await this.storage.customLists.update(this.list.id, {
            sortMode: mode,
          });
          if (updated) this.list = updated;
        }
        this.notifyChanged();
        await this.render();
      });
    }

    const orderedMedia = sortListMedia(this.list, allMedia);

    if (orderedMedia.length === 0) {
      const empty = contentEl.createDiv({
        cls: "mediavault-list-detail-empty",
      });
      empty.createDiv({ cls: "mediavault-list-detail-empty-icon", text: "🎬" });
      empty.createDiv({
        cls: "mediavault-list-detail-empty-title",
        text: t("lists.isEmpty"),
      });
      empty.createDiv({
        cls: "mediavault-empty-state",
        text: this.list.isSystem
          ? t("lists.emptySystemHint")
          : t("lists.emptyCustomHint"),
      });
      return;
    }

    const grid = contentEl.createDiv({ cls: "mediavault-list-detail-grid" });

    const isManual = this.list.sortMode === "manual";

    const PAGE_SIZE = 60;
    let renderedCount = 0;

    const renderBatch = () => {
      const nextSlice = orderedMedia.slice(
        renderedCount,
        renderedCount + PAGE_SIZE,
      );
      nextSlice.forEach((media) =>
        this.renderListItemCard(grid, media, orderedMedia, isManual),
      );
      renderedCount += nextSlice.length;

      loadMoreBtn?.remove();
      if (renderedCount < orderedMedia.length) {
        loadMoreBtn = contentEl.createEl("button", {
          cls: "mediavault-list-load-more",
          text: t("common.loadMore", {
            count: orderedMedia.length - renderedCount,
          }),
        });
        loadMoreBtn.addEventListener("click", renderBatch);
      }
    };
    let loadMoreBtn: HTMLButtonElement | undefined;
    renderBatch();
  }

  private openListMenu(
    evt: MouseEvent,
    titleEl: HTMLElement,
    descEl: HTMLElement,
    confirmingDelete = false,
  ): void {
    const menu = new Menu();

    menu.addItem((item) => {
      item
        .setTitle(t("lists.editTitleDesc"))
        .setIcon("pencil")
        .onClick(() => this.enterEditMode(titleEl, descEl));
    });

    menu.addItem((item) => {
      item
        .setTitle(t("lists.addMedia"))
        .setIcon("plus")
        .onClick(() => this.addMedia());
    });

    menu.addItem((item) => {
      item
        .setTitle(t("lists.duplicateList"))
        .setIcon("copy")
        .onClick(() => this.duplicateList());
    });

    menu.addSeparator();

    addDestructiveMenuItem(menu, evt, {
      label: t("lists.deleteList"),
      confirming: confirmingDelete,
      rebuild: (_m, confirming) =>
        this.openListMenu(evt, titleEl, descEl, confirming),
      onConfirm: () => void this.deleteList(),
    });

    menu.showAtMouseEvent(evt);
  }

  private enterEditMode(titleEl: HTMLElement, descEl: HTMLElement): void {
    const titleInput = document.createElement("input");
    titleInput.type = "text";
    titleInput.value = this.list.title;
    titleInput.className = "mediavault-list-title-input";
    titleEl.replaceWith(titleInput);
    titleInput.focus();
    titleInput.select();

    const saveTitle = async () => {
      const title = titleInput.value.trim();
      if (title && title !== this.list.title) {
        const updated = await this.storage.customLists.update(this.list.id, {
          title,
        });
        if (updated) this.list = updated;
        this.notifyChanged();
      }
      await this.render();
    };
    titleInput.addEventListener("blur", saveTitle);
    titleInput.addEventListener("keydown", (e) => {
      if (e.key === "Enter") titleInput.blur();
    });

    const descInput = document.createElement("textarea");
    descInput.className = "mediavault-list-description-input";
    descInput.value = this.list.description ?? "";
    descInput.placeholder = t("lists.descPlaceholder");
    descEl.replaceWith(descInput);

    const saveDesc = async () => {
      const desc = descInput.value || null;
      if (desc !== (this.list.description ?? null)) {
        const updated = await this.storage.customLists.update(this.list.id, {
          description: desc,
        });
        if (updated) this.list = updated;
        this.notifyChanged();
      }
    };
    descInput.addEventListener("blur", saveDesc);
  }

  private async addMedia(): Promise<void> {
    const all = await this.storage.media.getAll();
    const candidates = all.filter((m) => !this.list.mediaIds.includes(m.id));
    if (candidates.length === 0) {
      new Notice(t("lists.everyItemAlreadyInList"));
      return;
    }
    new SelectMediaModal(this.app, candidates, async (media) => {
      const updated = await this.storage.customLists.addMedia(
        this.list.id,
        media.id,
      );
      if (updated) this.list = updated;
      this.notifyChanged();
      await this.render();
    }).open();
  }

  private async duplicateList(): Promise<void> {
    await this.storage.customLists.duplicate(this.list.id);
    this.notifyChanged();
    new Notice(t("lists.duplicatedNotice", { title: this.list.title }));
    this.close();
  }

  private async deleteList(): Promise<void> {
    await this.storage.customLists.delete(this.list.id);
    new Notice(t("lists.deletedNotice", { title: this.list.title }));
    this.notifyChanged();
    this.close();
  }

  private async reorderListManually(
    orderedMedia: MediaItem[],
    fromId: string,
    toId: string,
  ): Promise<void> {
    if (fromId === toId) return;
    const order = orderedMedia.map((m) => m.id);
    const fromIdx = order.indexOf(fromId);
    const toIdx = order.indexOf(toId);
    if (fromIdx === -1 || toIdx === -1) return;
    order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
    if (this.list.isSystem) {
      const key = this.list.id === SYSTEM_FAVORITE_MOVIES_ID ? "movies" : "tv";
      await this.storage.settings.update({
        favoriteListManualOrder: {
          ...this.storage.settings.get().favoriteListManualOrder,
          [key]: order,
        },
      });
    } else {
      await this.storage.customLists.reorder(this.list.id, order);
    }
    this.notifyChanged();
    await this.render();
  }

  private renderListItemCard(
    grid: HTMLElement,
    media: MediaItem,
    orderedMedia: MediaItem[],
    isManual: boolean,
  ): void {
    const card = grid.createDiv({ cls: "mediavault-list-detail-card" });
    card.setAttr("data-media-id", media.id);

    const useNativeDnd = isManual && !isAndroidDevice();
    const useTouchDrag = isManual && isAndroidDevice();
    card.setAttr("draggable", useNativeDnd ? "true" : "false");
    // Two distinct classes, not one shared "is-draggable" — the two paths
    // use fundamentally different gesture mechanisms (native HTML5 DnD vs.
    // JS-driven pointer capture) and need different touch-action handling;
    // a single shared class previously coupled Android's CSS needs to iOS
    // and vice versa (see styles.css).
    card.toggleClass("is-draggable", useNativeDnd);
    card.toggleClass("is-touch-draggable", useTouchDrag);

    if (useNativeDnd) {
      card.addEventListener("dragstart", () => {
        this.dragMediaId = media.id;
        card.addClass("is-dragging");
      });
      card.addEventListener("dragend", () => card.removeClass("is-dragging"));
      card.addEventListener("dragover", (evt) => evt.preventDefault());
      card.addEventListener("drop", async (evt) => {
        evt.preventDefault();
        if (!this.dragMediaId) return;
        const fromId = this.dragMediaId;
        this.dragMediaId = null;
        await this.reorderListManually(orderedMedia, fromId, media.id);
      });
    } else if (useTouchDrag) {
      this.setupAndroidManualDrag(card, grid, media, orderedMedia);
    }

    const poster = card.createDiv({ cls: "mediavault-list-detail-poster" });
    renderPoster(poster, media, "w200");
    void getMediaPercentWatched(this.storage, media).then((percent) => {
      if (percent === null) return;
      renderProgressOverlay(poster, percent, media.status);
    });

    let removeBtn: HTMLElement | null = null;
    if (!this.list.isSystem) {
      removeBtn = card.createEl("button", {
        cls: "mediavault-list-detail-remove",
        text: "\u2715",
      });
      removeBtn.setAttr("aria-label", t("lists.removeFromList"));
      removeBtn.addEventListener("click", async (evt) => {
        evt.stopPropagation();
        const confirmed = confirm(
          t("addToList.removeConfirm", {
            title: media.title,
            list: this.list.title,
          }),
        );
        if (!confirmed) return;
        const updated = await this.storage.customLists.removeMedia(
          this.list.id,
          media.id,
        );
        if (updated) this.list = updated;
        this.notifyChanged();
        await this.render();
      });
    }

    card.addEventListener("click", (evt) => {
      if (evt.target === removeBtn) return;
      if (card.dataset.justDragged) {
        delete card.dataset.justDragged;
        return;
      }
      this.plugin.openMediaDetail(media);
    });
  }

  private setupAndroidManualDrag(
    card: HTMLElement,
    grid: HTMLElement,
    media: MediaItem,
    orderedMedia: MediaItem[],
  ): void {
    const LONG_PRESS_MS = 350;
    const MOVE_CANCEL_PX = 10;

    let longPressTimer: number | null = null;
    let dragging = false;
    let startX = 0;
    let startY = 0;
    let activePointerId: number | null = null;
    let dropTargetId: string | null = null;
    let sessionController: AbortController | null = null;

    const endSession = () => {
      if (longPressTimer !== null) {
        window.clearTimeout(longPressTimer);
        longPressTimer = null;
      }
      sessionController?.abort();
      sessionController = null;
      if (activePointerId !== null) {
        try {
          card.releasePointerCapture(activePointerId);
        } catch {
          // Ignore
        }
      }
      if (dragging) {
        card.removeClass("is-dragging");
        card.style.touchAction = "";
        card.dataset.justDragged = "1";
      }
      dragging = false;
      activePointerId = null;
      dropTargetId = null;
      grid
        .querySelectorAll(".mediavault-list-detail-card.is-drop-target")
        .forEach((el) => el.removeClass("is-drop-target"));
    };

    card.addEventListener("pointerdown", (evt: PointerEvent) => {
      if (evt.pointerType === "mouse") return;

      endSession();

      startX = evt.clientX;
      startY = evt.clientY;
      const pointerId = evt.pointerId;
      activePointerId = pointerId;

      const controller = new AbortController();
      sessionController = controller;
      const { signal } = controller;

      card.addEventListener(
        "pointermove",
        (moveEvt: PointerEvent) => {
          if (moveEvt.pointerId !== pointerId) return;
          if (!dragging) {
            const dx = moveEvt.clientX - startX;
            const dy = moveEvt.clientY - startY;
            if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) endSession();
            return;
          }
          moveEvt.preventDefault();
          const el = document.elementFromPoint(
            moveEvt.clientX,
            moveEvt.clientY,
          );
          const targetCard = el?.closest<HTMLElement>(
            ".mediavault-list-detail-card",
          );
          grid
            .querySelectorAll(".mediavault-list-detail-card.is-drop-target")
            .forEach((n) => n.removeClass("is-drop-target"));
          if (targetCard && targetCard !== card && grid.contains(targetCard)) {
            dropTargetId = targetCard.dataset.mediaId ?? null;
            targetCard.addClass("is-drop-target");
          } else {
            dropTargetId = null;
          }
        },
        { signal },
      );

      const finish = async (upEvt: PointerEvent) => {
        if (upEvt.pointerId !== pointerId) return;
        const wasDragging = dragging;
        const targetId = dropTargetId;
        endSession();
        if (wasDragging && targetId) {
          await this.reorderListManually(orderedMedia, media.id, targetId);
        }
      };
      card.addEventListener(
        "pointerup",
        (upEvt) => void finish(upEvt as PointerEvent),
        { signal },
      );
      card.addEventListener("pointercancel", () => endSession(), { signal });
      card.addEventListener("lostpointercapture", () => endSession(), {
        signal,
      });
      // Android's native long-press (context menu / callout) can otherwise
      // fire mid-gesture and steal the touch before LONG_PRESS_MS elapses.
      card.addEventListener("contextmenu", (evt) => evt.preventDefault(), {
        signal,
      });

      longPressTimer = window.setTimeout(() => {
        longPressTimer = null;
        if (activePointerId !== pointerId) return;
        dragging = true;
        card.addClass("is-dragging");
        card.style.touchAction = "none";
        try {
          card.setPointerCapture(pointerId);
        } catch {
          // Ignore
        }
      }, LONG_PRESS_MS);
    });
  }
}

export function excludeMediaAlreadyInList(
  list: CustomList,
  allMedia: MediaItem[],
): MediaItem[] {
  return allMedia.filter((m) => !list.mediaIds.includes(m.id));
}
