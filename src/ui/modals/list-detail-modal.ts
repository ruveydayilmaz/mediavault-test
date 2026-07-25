import { App, Modal, Notice, Menu } from "obsidian";
import { renderInlineBackButton } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type MediaVaultPlugin from "../../main";
import { CustomList, ListSortMode } from "../../models/list";
import { MediaItem } from "../../models/media";
import { sortListMedia, formatRelativeDate } from "../../services/list-service";
import { renderPoster, getMediaPercentWatched, renderProgressOverlay } from "../components/media-render";
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

	/**
	 * Single fan-out for "this list changed": drives every view that can
	 * show list data (Lists page + the Home dashboard's Lists carousel)
	 * through the plugin's own leaf-iterating refresh methods. Callers
	 * used to *also* pass their own view's `refresh()` as `onChanged` —
	 * since `refreshListViews()`/`refreshLibraryViews()` already find and
	 * refresh that exact same leaf, that fired two overlapping, unguarded
	 * `refresh()` calls on one view. Each does `empty()` then an async
	 * re-render; interleaved, the second call's `empty()` could run after
	 * the first had already started appending cards, leaving both sets of
	 * cards in the DOM. That race — not anything in list creation or
	 * storage — was the source of "lists appear twice."
	 */
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
		}
		const allMedia = await this.storage.media.getAll();

		// --- Header: read-only title + hamburger menu ---
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
				text: `Imported${this.list.importSource ? ` — ${this.list.importSource}` : ""}`,
			});
		}
		if (this.list.isSystem) {
			titleRow.createDiv({ cls: "mediavault-list-imported-badge", text: "Built-in" });
		}

		// Hamburger menu button — system lists (Favorite Movies/TV Series)
		// have no menu: they can't be renamed, added to manually, duplicated,
		// or deleted, since they're computed live from favorite status.
		if (!this.list.isSystem) {
			const menuBtn = titleRow.createEl("button", {
				cls: "mediavault-list-detail-menu-btn clickable-icon",
				attr: { "aria-label": "List actions" },
			});
			menuBtn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="5" r="1"/><circle cx="12" cy="12" r="1"/><circle cx="12" cy="19" r="1"/></svg>`;
			menuBtn.addEventListener("click", (evt) => {
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

				menu.addItem((item) => {
					item.setTitle("Delete list")
						.setIcon("trash")
						.onClick(() => this.deleteList());
				});

				menu.showAtMouseEvent(evt);
			});
		}

		// Meta pills
		const metaRow = header.createDiv({ cls: "mediavault-list-detail-meta" });
		const addMetaPill = (text: string) => metaRow.createSpan({ cls: "mediavault-list-detail-meta-pill", text });
		addMetaPill(`${this.list.mediaIds.length} item${this.list.mediaIds.length === 1 ? "" : "s"}`);
		addMetaPill(`Updated ${formatRelativeDate(this.list.updatedAt)}`);
		addMetaPill(this.list.owner ?? "You");

		// Description (read-only)
		const descEl = header.createDiv({ cls: "mediavault-list-detail-description" });
		if (this.list.description) {
			descEl.setText(this.list.description);
		} else {
			descEl.addClass("is-placeholder");
			descEl.setText("No description");
		}

		// --- Sort row (system lists always sort by Recent, no picker) ---
		if (!this.list.isSystem) {
			const sortRow = contentEl.createDiv({ cls: "mediavault-list-sort-row" });
			sortRow.createSpan({ cls: "mediavault-list-sort-label", text: "Sort by" });
			const sortSelect = sortRow.createEl("select", { cls: "mediavault-list-sort-select" });
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
		}

		// --- Contents grid ---
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

		const isManual = !this.list.isSystem && this.list.sortMode === "manual";

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

	// --- Actions (invoked from hamburger menu) ---

	private enterEditMode(titleEl: HTMLElement, descEl: HTMLElement): void {
		// Replace title text with input
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

		// Replace description text with textarea
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
		const confirmed = confirm(
			`Delete "${this.list.title}"?\n\nThis will permanently delete this list.\nMedia, watch history, and favorites are not affected.\n\nThis action cannot be undone.`
		);
		if (!confirmed) return;
		await this.storage.customLists.delete(this.list.id);
		new Notice(`MediaVault: "${this.list.title}" deleted.`);
		this.notifyChanged();
		this.close();
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
				const updated = await this.storage.customLists.removeMedia(this.list.id, media.id);
				if (updated) this.list = updated;
				this.notifyChanged();
				await this.render();
			});
		}

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
