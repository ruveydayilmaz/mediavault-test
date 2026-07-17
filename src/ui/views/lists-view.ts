import { ItemView, WorkspaceLeaf } from "obsidian";
import type MediaVaultPlugin from "../../main";
import { VIEW_TYPE_LISTS } from "../../constants";
import { CustomList } from "../../models/list";
import { MediaItem } from "../../models/media";
import { getListBannerPosters, formatRelativeDate } from "../../services/list-service";
import { renderPoster } from "../components/media-render";
import { CreateListModal } from "../modals/create-list-modal";
import { ListDetailModal } from "../modals/list-detail-modal";

export class ListsView extends ItemView {
	private plugin: MediaVaultPlugin;
	private gridEl!: HTMLElement;

	constructor(leaf: WorkspaceLeaf, plugin: MediaVaultPlugin) {
		super(leaf);
		this.plugin = plugin;
	}

	getViewType(): string {
		return VIEW_TYPE_LISTS;
	}

	getDisplayText(): string {
		return "MediaVault Lists";
	}

	getIcon(): string {
		return "list";
	}

	async onOpen(): Promise<void> {
		const root = this.containerEl.children[1] as HTMLElement;
		root.empty();
		root.addClass("mediavault-lists-root");

		const toolbar = root.createDiv({ cls: "mediavault-lists-toolbar" });
		toolbar.createEl("h2", { text: "Custom Lists" });
		const newBtn = toolbar.createEl("button", { text: "+ New List", cls: "mod-cta" });
		newBtn.addEventListener("click", () => {
			new CreateListModal(this.app, this.plugin.storage, () => void this.refresh()).open();
		});

		this.gridEl = root.createDiv({ cls: "mediavault-lists-grid" });

		await this.refresh();
	}

	async onClose(): Promise<void> {
		// Nothing to tear down — repositories are owned by the plugin.
	}

	async refresh(): Promise<void> {
		this.gridEl.empty();

		const [lists, allMedia] = await Promise.all([this.plugin.storage.customLists.getAll(), this.plugin.storage.media.getAll()]);

		if (lists.length === 0) {
			this.gridEl.createEl("p", {
				cls: "mediavault-empty-state",
				text: "No lists yet — create one, or import TV Time custom lists.",
			});
			return;
		}

		lists.forEach((list) => this.renderListCard(list, allMedia));
	}

	/**
	 * TV Time-style card (roadmap Milestone 7): the four-poster banner
	 * fills the whole card as a wide strip, with title, description, and
	 * meta (item count · last updated · owner) overlaid at the bottom
	 * behind a gradient scrim, rather than sitting in a separate info
	 * block below the banner. Reference image used for the overlay
	 * treatment only — markup/CSS here is original, not copied.
	 */
	private renderListCard(list: CustomList, allMedia: MediaItem[]): void {
		const card = this.gridEl.createDiv({ cls: "mediavault-list-card" });

		const bannerPosters = getListBannerPosters(list, allMedia);
		const banner = card.createDiv({ cls: "mediavault-list-banner" });
		for (let i = 0; i < 4; i++) {
			const cell = banner.createDiv({ cls: "mediavault-list-banner-cell" });
			const media = bannerPosters[i];
			if (media) {
				renderPoster(cell, media, "w200");
			} else {
				cell.addClass("is-empty");
			}
		}

		const scrim = banner.createDiv({ cls: "mediavault-list-card-scrim" });
		scrim.createDiv({ cls: "mediavault-list-card-title", text: list.title });
		if (list.description) {
			scrim.createDiv({ cls: "mediavault-list-card-description", text: list.description });
		}
		const meta = scrim.createDiv({ cls: "mediavault-list-card-meta" });
		meta.createSpan({ text: `${list.mediaIds.length} item${list.mediaIds.length === 1 ? "" : "s"}` });
		meta.createSpan({ text: `Updated ${formatRelativeDate(list.updatedAt)}` });
		meta.createSpan({ text: list.owner ?? "You" });
		if (list.isImported) {
			meta.createSpan({ cls: "mediavault-list-card-imported", text: "Imported" });
		}

		card.addEventListener("click", () => {
			new ListDetailModal(this.app, this.plugin, list, () => void this.refresh()).open();
		});
	}
}
