import { App, Modal, Notice, Menu } from "obsidian";
import { renderInlineBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type MediaVaultPlugin from "../../main";
import { CustomList, ListSortMode } from "../../models/list";
import { MediaItem } from "../../models/media";
import { sortListMedia, formatRelativeDate, getSystemFavoriteLists, SYSTEM_FAVORITE_MOVIES_ID } from "../../services/list-service";
import { renderPoster, getMediaPercentWatched, renderProgressOverlay } from "../components/media-render";
import { SelectMediaModal } from "./select-media-modal";
import { addDestructiveMenuItem } from "../components/destructive-menu-item";
import { isAndroidDevice } from "../../utils/platform";

const SORT_MODE_OPTIONS: { value: ListSortMode; label: string }[] = [
	{ value: "recent", label: "Recent" },
	{ value: "manual", label: "Manual (drag to reorder)" },
	{ value: "dateAdded", label: "Date Added" },
	{ value: "title", label: "Title" },
	{ value: "rating", label: "Rating" },
	{ value: "year", label: "Year" },
	{ value: "runtime", label: "Runtime" },
];

export class ListDetailModal extends Modal {
	private storage: StorageService;
	private plugin: MediaVaultPlugin;
	private list: CustomList;
	private onChanged?: () => void;
	private dragMediaId: string | null = null;

	constructor(app: App, plugin: MediaVaultPlugin, list: CustomList, onChanged?: () => void) {
		super(app);
		this.plugin = plugin;
		this.storage = plugin.storage;
		this.list = list;
		this.onChanged = onChanged;
	}

	onOpen(): void {
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
					text: "This list no longer exists.",
				});
				return;
			}
			this.list = fresh;
		} else {
			const allMediaForRefresh = await this.storage.media.getAll();
			const fresh = getSystemFavoriteLists(allMediaForRefresh, this.storage.settings.get()).find((l) => l.id === this.list.id);
			if (fresh) this.list = fresh;
		}
		const allMedia = await this.storage.media.getAll();

		const header = contentEl.createDiv({ cls: "mediavault-list-detail-header" });

		const titleRow = header.createDiv({ cls: "mediavault-list-detail-title-row" });
		renderInlineBackButton(this, titleRow);
		const titleEl = titleRow.createDiv({
			cls: "mediavault-list-detail-title-text",
			text: this.list.title,
		});
		if (this.list.isImported) {
			titleRow.createDiv({
				cls: "mediavault-list-imported-badge",
				text: "Imported",
			});
		}
		if (this.list.isSystem) {
			titleRow.createDiv({ cls: "mediavault-list-imported-badge", text: "Built-in" });
		}

		if (!this.list.isSystem) {
			const menuBtn = titleRow.createEl("button", {
				cls: "mediavault-list-detail-menu-btn clickable-icon",
				attr: { "aria-label": "List actions" },
			});
			menuBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
			menuBtn.addEventListener("click", (evt) => this.openListMenu(evt, titleEl, descEl));
		}

		const metaRow = header.createDiv({ cls: "mediavault-list-detail-meta" });
		const addMetaPill = (text: string) => metaRow.createSpan({ cls: "mediavault-list-detail-meta-pill", text });
		addMetaPill(`${this.list.mediaIds.length} item${this.list.mediaIds.length === 1 ? "" : "s"}`);
		addMetaPill(`Updated ${formatRelativeDate(this.list.updatedAt)}`);
		addMetaPill(this.list.owner ?? "You");

		const descEl = header.createDiv({ cls: "mediavault-list-detail-description" });
		if (this.list.description) {
			descEl.setText(this.list.description);
		} else {
			descEl.addClass("is-placeholder");
			descEl.setText("No description");
		}

		{
			const sortRow = contentEl.createDiv({ cls: "mediavault-list-sort-row" });
			sortRow.createSpan({ cls: "mediavault-list-sort-label", text: "Sort by" });
			const sortSelect = sortRow.createEl("select", { cls: "mediavault-list-sort-select" });
			SORT_MODE_OPTIONS.forEach((opt) => sortSelect.createEl("option", { value: opt.value, text: opt.label }));
			sortSelect.value = this.list.sortMode;
			sortSelect.addEventListener("change", async () => {
				const mode = sortSelect.value as ListSortMode;
				if (this.list.isSystem) {
					const key = this.list.id === SYSTEM_FAVORITE_MOVIES_ID ? "movies" : "tv";
					await this.storage.settings.update({
						favoriteListSortModes: { ...this.storage.settings.get().favoriteListSortModes, [key]: mode },
					});
				} else {
					const updated = await this.storage.customLists.update(this.list.id, { sortMode: mode });
					if (updated) this.list = updated;
				}
				this.notifyChanged();
				await this.render();
			});
		}

		const orderedMedia = sortListMedia(this.list, allMedia);

		if (orderedMedia.length === 0) {
			const empty = contentEl.createDiv({ cls: "mediavault-list-detail-empty" });
			empty.createDiv({ cls: "mediavault-list-detail-empty-icon", text: "🎬" });
			empty.createDiv({ cls: "mediavault-list-detail-empty-title", text: "This list is empty" });
			empty.createDiv({
				cls: "mediavault-empty-state",
				text: this.list.isSystem ? "Mark movies or TV series as favorites to see them here." : "Use the ⋮ menu above to add media.",
			});
			return;
		}

		const grid = contentEl.createDiv({ cls: "mediavault-list-detail-grid" });

		const isManual = this.list.sortMode === "manual";

		const PAGE_SIZE = 60;
		let renderedCount = 0;

		const renderBatch = () => {
			const nextSlice = orderedMedia.slice(renderedCount, renderedCount + PAGE_SIZE);
			nextSlice.forEach((media) => this.renderListItemCard(grid, media, orderedMedia, isManual));
			renderedCount += nextSlice.length;

			loadMoreBtn?.remove();
			if (renderedCount < orderedMedia.length) {
				loadMoreBtn = contentEl.createEl("button", {
					cls: "mediavault-list-load-more",
					text: `Load more (${orderedMedia.length - renderedCount} remaining)`,
				});
				loadMoreBtn.addEventListener("click", renderBatch);
			}
		};
		let loadMoreBtn: HTMLButtonElement | undefined;
		renderBatch();
	}

	private openListMenu(evt: MouseEvent, titleEl: HTMLElement, descEl: HTMLElement, confirmingDelete = false): void {
		const menu = new Menu();

		menu.addItem((item) => {
			item.setTitle("Edit title & description")
				.setIcon("pencil")
				.onClick(() => this.enterEditMode(titleEl, descEl));
		});

		menu.addItem((item) => {
			item.setTitle("Add media")
				.setIcon("plus")
				.onClick(() => this.addMedia());
		});

		menu.addItem((item) => {
			item.setTitle("Duplicate list")
				.setIcon("copy")
				.onClick(() => this.duplicateList());
		});

		menu.addSeparator();

		addDestructiveMenuItem(menu, evt, {
			label: "Delete list",
			confirming: confirmingDelete,
			rebuild: (_m, confirming) => this.openListMenu(evt, titleEl, descEl, confirming),
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
				const updated = await this.storage.customLists.update(this.list.id, { title });
				if (updated) this.list = updated;
				this.notifyChanged();
			}
			await this.render();
		};
		titleInput.addEventListener("blur", saveTitle);
		titleInput.addEventListener("keydown", (e) => { if (e.key === "Enter") titleInput.blur(); });

		const descInput = document.createElement("textarea");
		descInput.className = "mediavault-list-description-input";
		descInput.value = this.list.description ?? "";
		descInput.placeholder = "Add a description...";
		descEl.replaceWith(descInput);

		const saveDesc = async () => {
			const desc = descInput.value || null;
			if (desc !== (this.list.description ?? null)) {
				const updated = await this.storage.customLists.update(this.list.id, { description: desc });
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
			new Notice("MediaVault: every item in your library is already in this list.");
			return;
		}
		new SelectMediaModal(this.app, candidates, async (media) => {
			const updated = await this.storage.customLists.addMedia(this.list.id, media.id);
			if (updated) this.list = updated;
			this.notifyChanged();
			await this.render();
		}).open();
	}

	private async duplicateList(): Promise<void> {
		await this.storage.customLists.duplicate(this.list.id);
		this.notifyChanged();
		new Notice(`MediaVault: duplicated "${this.list.title}".`);
		this.close();
	}

	private async deleteList(): Promise<void> {
		await this.storage.customLists.delete(this.list.id);
		new Notice(`MediaVault: "${this.list.title}" deleted.`);
		this.notifyChanged();
		this.close();
	}

	private async reorderListManually(orderedMedia: MediaItem[], fromId: string, toId: string): Promise<void> {
		if (fromId === toId) return;
		const order = orderedMedia.map((m) => m.id);
		const fromIdx = order.indexOf(fromId);
		const toIdx = order.indexOf(toId);
		if (fromIdx === -1 || toIdx === -1) return;
		order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
		if (this.list.isSystem) {
			const key = this.list.id === SYSTEM_FAVORITE_MOVIES_ID ? "movies" : "tv";
			await this.storage.settings.update({
				favoriteListManualOrder: { ...this.storage.settings.get().favoriteListManualOrder, [key]: order },
			});
		} else {
			await this.storage.customLists.reorder(this.list.id, order);
		}
		this.notifyChanged();
		await this.render();
	}

	private renderListItemCard(grid: HTMLElement, media: MediaItem, orderedMedia: MediaItem[], isManual: boolean): void {
		const card = grid.createDiv({ cls: "mediavault-list-detail-card" });
		card.setAttr("data-media-id", media.id);

		// Android WebView's long-press on a draggable=true element kicks off
		// its own native HTML5 drag gesture (that's the "pressed state" the
		// user sees) but the dragover/drop events it depends on don't fire
		// reliably against Obsidian's own touch/scroll handling, leaving the
		// gesture stuck and the app unresponsive. Android gets a manual
		// Pointer Events long-press drag instead; desktop/iOS keep the
		// existing native HTML5 DnD path untouched.
		const useNativeDnd = isManual && !isAndroidDevice();
		card.setAttr("draggable", useNativeDnd ? "true" : "false");
		card.toggleClass("is-draggable", isManual);

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
		} else if (isManual && isAndroidDevice()) {
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
			removeBtn = card.createEl("button", { cls: "mediavault-list-detail-remove", text: "✕" });
			removeBtn.setAttr("aria-label", "Remove from list");
			removeBtn.addEventListener("click", async (evt) => {
				evt.stopPropagation();
				const confirmed = confirm(
					`Remove "${media.title}" from "${this.list.title}"?\n\nThis only removes it from this list — the item stays in your library, and your watch history/favorites are not affected.`
				);
				if (!confirmed) return;
				const updated = await this.storage.customLists.removeMedia(this.list.id, media.id);
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
			this.close();
			this.plugin.openMediaDetail(media);
		});
	}

	/**
	 * Manual long-press drag reorder for Android (see renderListItemCard).
	 * Uses Pointer Events end-to-end instead of the HTML5 DnD API: a
	 * long-press arms drag mode, pointermove hit-tests the element under
	 * the finger against sibling cards in the same grid to track the
	 * current drop target, and pointerup/pointercancel finalizes exactly
	 * once via the same `reorderListManually` the native path uses.
	 */
	private setupAndroidManualDrag(card: HTMLElement, grid: HTMLElement, media: MediaItem, orderedMedia: MediaItem[]): void {
		const LONG_PRESS_MS = 350;
		const MOVE_CANCEL_PX = 10;

		let longPressTimer: number | null = null;
		let dragging = false;
		let startX = 0;
		let startY = 0;
		let activePointerId: number | null = null;
		let dropTargetId: string | null = null;

		const clearTimer = () => {
			if (longPressTimer !== null) {
				window.clearTimeout(longPressTimer);
				longPressTimer = null;
			}
		};

		const endDrag = () => {
			clearTimer();
			if (dragging) {
				card.removeClass("is-dragging");
				card.style.touchAction = "";
				if (activePointerId !== null && card.hasPointerCapture(activePointerId)) {
					card.releasePointerCapture(activePointerId);
				}
				card.dataset.justDragged = "1";
			}
			dragging = false;
			activePointerId = null;
			grid.querySelectorAll(".mediavault-list-detail-card.is-drop-target").forEach((el) => el.removeClass("is-drop-target"));
		};

		card.addEventListener("pointerdown", (evt: PointerEvent) => {
			if (evt.pointerType === "mouse") return;
			startX = evt.clientX;
			startY = evt.clientY;
			activePointerId = evt.pointerId;
			dropTargetId = null;
			clearTimer();
			longPressTimer = window.setTimeout(() => {
				dragging = true;
				card.addClass("is-dragging");
				card.style.touchAction = "none";
				if (activePointerId !== null) card.setPointerCapture(activePointerId);
			}, LONG_PRESS_MS);
		});

		card.addEventListener("pointermove", (evt: PointerEvent) => {
			if (activePointerId === null || evt.pointerId !== activePointerId) return;
			const dx = evt.clientX - startX;
			const dy = evt.clientY - startY;
			if (!dragging) {
				if (Math.hypot(dx, dy) > MOVE_CANCEL_PX) clearTimer();
				return;
			}
			evt.preventDefault();
			const el = document.elementFromPoint(evt.clientX, evt.clientY);
			const targetCard = el?.closest<HTMLElement>(".mediavault-list-detail-card");
			grid.querySelectorAll(".mediavault-list-detail-card.is-drop-target").forEach((n) => n.removeClass("is-drop-target"));
			if (targetCard && targetCard !== card && grid.contains(targetCard)) {
				dropTargetId = targetCard.dataset.mediaId ?? null;
				targetCard.addClass("is-drop-target");
			} else {
				dropTargetId = null;
			}
		});

		const finish = async (evt: PointerEvent) => {
			if (activePointerId === null || evt.pointerId !== activePointerId) return;
			const wasDragging = dragging;
			const targetId = dropTargetId;
			endDrag();
			if (wasDragging && targetId) {
				await this.reorderListManually(orderedMedia, media.id, targetId);
			}
		};

		card.addEventListener("pointerup", (evt) => void finish(evt));
		card.addEventListener("pointercancel", () => endDrag());
	}
}

export function excludeMediaAlreadyInList(list: CustomList, allMedia: MediaItem[]): MediaItem[] {
	return allMedia.filter((m) => !list.mediaIds.includes(m.id));
}
