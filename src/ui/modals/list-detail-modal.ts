import { App, Modal, Notice } from "obsidian";
import type { StorageService } from "../../services/storage";
import type MediaVaultPlugin from "../../main";
import { CustomList, ListSortMode } from "../../models/list";
import { MediaItem } from "../../models/media";
import { sortListMedia, formatRelativeDate } from "../../services/list-service";
import { renderPoster } from "../components/media-render";
import { SelectMediaModal } from "./select-media-modal";

const SORT_MODE_OPTIONS: { value: ListSortMode; label: string }[] = [
	{ value: "recent", label: "Recent" },
	{ value: "manual", label: "Manual (drag to reorder)" },
	{ value: "dateAdded", label: "Date Added" },
	{ value: "title", label: "Title" },
	{ value: "rating", label: "Rating" },
	{ value: "year", label: "Year" },
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
		this.onChanged?.();
		this.plugin.refreshListViews();
	}

	private async render(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-list-detail-modal");

		const fresh = await this.storage.customLists.findById(this.list.id);
		if (!fresh) {
			contentEl.createEl("p", { text: "This list no longer exists." });
			return;
		}
		this.list = fresh;
		const allMedia = await this.storage.media.getAll();

		// --- Header: title / description / metadata (banner collage removed — Milestone 7: it now lives only in the library overview) ---
		const header = contentEl.createDiv({ cls: "mediavault-list-detail-header" });

		const metaRow = header.createDiv({ cls: "mediavault-list-detail-meta" });
		metaRow.createSpan({ text: `${this.list.mediaIds.length} item${this.list.mediaIds.length === 1 ? "" : "s"}` });
		metaRow.createSpan({ text: `Updated ${formatRelativeDate(this.list.updatedAt)}` });
		metaRow.createSpan({ text: this.list.owner ?? "You" });

		const titleInput = header.createEl("input", { type: "text", cls: "mediavault-list-title-input" });
		titleInput.value = this.list.title;
		titleInput.addEventListener("change", async () => {
			const title = titleInput.value.trim();
			if (!title) {
				titleInput.value = this.list.title;
				return;
			}
			const updated = await this.storage.customLists.update(this.list.id, { title });
			if (updated) this.list = updated;
			this.notifyChanged();
		});

		const descInput = header.createEl("textarea", {
			cls: "mediavault-list-description-input",
			attr: { placeholder: "Description..." },
		});
		descInput.value = this.list.description ?? "";
		descInput.addEventListener("change", async () => {
			const updated = await this.storage.customLists.update(this.list.id, { description: descInput.value || null });
			if (updated) this.list = updated;
			this.notifyChanged();
		});

		if (this.list.isImported) {
			header.createDiv({
				cls: "mediavault-list-imported-badge",
				text: `Imported${this.list.importSource ? ` — ${this.list.importSource}` : ""}`,
			});
		}

		// --- Action row: sort mode, duplicate, delete ---
		const actionsRow = contentEl.createDiv({ cls: "mediavault-list-actions-row" });

		const sortSelect = actionsRow.createEl("select");
		SORT_MODE_OPTIONS.forEach((opt) => sortSelect.createEl("option", { value: opt.value, text: opt.label }));
		sortSelect.value = this.list.sortMode;
		sortSelect.addEventListener("change", async () => {
			const updated = await this.storage.customLists.update(this.list.id, {
				sortMode: sortSelect.value as ListSortMode,
			});
			if (updated) this.list = updated;
			this.notifyChanged();
			await this.render();
		});

		const addBtn = actionsRow.createEl("button", { text: "+ Add media", cls: "mod-cta" });
		addBtn.addEventListener("click", async () => {
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
		});

		const duplicateBtn = actionsRow.createEl("button", { text: "Duplicate" });
		duplicateBtn.addEventListener("click", async () => {
			await this.storage.customLists.duplicate(this.list.id);
			this.notifyChanged();
			new Notice(`MediaVault: duplicated "${this.list.title}".`);
			this.close();
		});

		const deleteBtn = actionsRow.createEl("button", { text: "Delete list", cls: "mod-warning" });
		deleteBtn.addEventListener("click", async () => {
			const confirmed = confirm(
				`Delete "${this.list.title}"?\n\nThis will permanently delete this list.\nMedia, watch history, and favorites are not affected.\n\nThis action cannot be undone.`
			);
			if (!confirmed) return;
			await this.storage.customLists.delete(this.list.id);
			new Notice(`MediaVault: "${this.list.title}" deleted.`);
			this.notifyChanged();
			this.close();
		});

		// --- Contents grid ---
		const orderedMedia = sortListMedia(this.list, allMedia);

		const gridSection = contentEl.createDiv({ cls: "mediavault-list-detail-grid-section" });
		const grid = gridSection.createDiv({ cls: "mediavault-list-detail-grid" });
		if (orderedMedia.length === 0) {
			grid.createEl("p", { cls: "mediavault-empty-state", text: "This list is empty — add something above." });
		}

		const isManual = this.list.sortMode === "manual";

		/**
		 * Renders in batches instead of all at once (Milestone 7: List
		 * Details Layout) — a list with hundreds/thousands of items would
		 * otherwise mount that many poster cards in one go. Each "Load
		 * more" click only appends the next batch; nothing already
		 * rendered is touched, so scroll position and drag state are
		 * preserved.
		 */
		const PAGE_SIZE = 60;
		let renderedCount = 0;

		const renderBatch = () => {
			const nextSlice = orderedMedia.slice(renderedCount, renderedCount + PAGE_SIZE);
			nextSlice.forEach((media) => this.renderListItemCard(grid, media, orderedMedia, isManual));
			renderedCount += nextSlice.length;

			loadMoreBtn?.remove();
			if (renderedCount < orderedMedia.length) {
				loadMoreBtn = gridSection.createEl("button", {
					cls: "mediavault-list-load-more",
					text: `Load more (${orderedMedia.length - renderedCount} remaining)`,
				});
				loadMoreBtn.addEventListener("click", renderBatch);
			}
		};
		let loadMoreBtn: HTMLButtonElement | undefined;
		renderBatch();
	}

	private renderListItemCard(grid: HTMLElement, media: MediaItem, orderedMedia: MediaItem[], isManual: boolean): void {
		const card = grid.createDiv({ cls: "mediavault-list-detail-card" });
		card.setAttr("draggable", isManual ? "true" : "false");
		card.toggleClass("is-draggable", isManual);

		if (isManual) {
			card.addEventListener("dragstart", () => {
				this.dragMediaId = media.id;
				card.addClass("is-dragging");
			});
			card.addEventListener("dragend", () => card.removeClass("is-dragging"));
			card.addEventListener("dragover", (evt) => evt.preventDefault());
			card.addEventListener("drop", async (evt) => {
				evt.preventDefault();
				if (!this.dragMediaId || this.dragMediaId === media.id) return;
				const order = orderedMedia.map((m) => m.id);
				const fromIdx = order.indexOf(this.dragMediaId);
				const toIdx = order.indexOf(media.id);
				if (fromIdx === -1 || toIdx === -1) return;
				order.splice(toIdx, 0, order.splice(fromIdx, 1)[0]);
				await this.storage.customLists.reorder(this.list.id, order);
				this.dragMediaId = null;
				this.notifyChanged();
				await this.render();
			});
		}

		const poster = card.createDiv({ cls: "mediavault-list-detail-poster" });
		renderPoster(poster, media, "w200");
		card.createDiv({ cls: "mediavault-list-detail-title", text: media.title });

		const removeBtn = card.createEl("button", { cls: "mediavault-list-detail-remove", text: "Remove" });
		removeBtn.addEventListener("click", async (evt) => {
			evt.stopPropagation();
			const updated = await this.storage.customLists.removeMedia(this.list.id, media.id);
			if (updated) this.list = updated;
			this.notifyChanged();
			await this.render();
		});

		card.addEventListener("click", (evt) => {
			if (evt.target === removeBtn) return;
			this.close();
			this.plugin.openMediaDetail(media);
		});
	}
}

/** Small helper so callers (e.g. the Lists view) don't have to reach into MediaItem[] filtering themselves. */
export function excludeMediaAlreadyInList(list: CustomList, allMedia: MediaItem[]): MediaItem[] {
	return allMedia.filter((m) => !list.mediaIds.includes(m.id));
}
