import { App, Modal } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type MediaVaultPlugin from "../../main";
import { MediaVaultNotification } from "../../models/notification";

export class NotificationHistoryModal extends Modal {
	private plugin: MediaVaultPlugin;
	private listEl!: HTMLElement;

	constructor(app: App, plugin: MediaVaultPlugin) {
		super(app);
		this.plugin = plugin;
	}

	/**
	 * Milestone 2 (Notification List Refresh Bug): the root cause was
	 * `onOpen` doing double duty as both one-time modal setup and the
	 * "refresh" handler — re-invoking it on "Mark all read" rebuilt the
	 * title, button, and list on top of what was already there instead of
	 * replacing it, since nothing ever cleared `contentEl` first.
	 *
	 * Setup (title, button, list container) now happens exactly once here.
	 * "Mark all read" only re-renders the list itself via `renderList()`,
	 * which empties `listEl` before repopulating it — so repeated clicks
	 * update the same DOM nodes instead of duplicating them.
	 */
	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.addClass("mediavault-notification-history-modal");
		renderModalHeader(this, contentEl, "Notifications", "h3");

		const markAllBtn = contentEl.createEl("button", { text: "Mark all read" });
		markAllBtn.addEventListener("click", async () => {
			await this.plugin.storage.notifications.markAllRead();
			await this.renderList();
		});

		this.listEl = contentEl.createDiv({ cls: "mediavault-notification-list" });
		await this.renderList();
	}

	private async renderList(): Promise<void> {
		const notifications = await this.plugin.storage.notifications.recent(50);

		this.listEl.empty();

		if (notifications.length === 0) {
			this.listEl.createEl("p", { cls: "mediavault-empty-state", text: "No notifications yet." });
			return;
		}

		notifications.forEach((n) => this.renderRow(this.listEl, n));
	}

	private renderRow(list: HTMLElement, n: MediaVaultNotification): void {
		const row = list.createDiv({ cls: "mediavault-notification-row" + (n.read ? "" : " is-unread") });
		row.createDiv({ cls: "mediavault-notification-message", text: n.message });
		row.createDiv({ cls: "mediavault-notification-date", text: new Date(n.createdAt).toLocaleString() });

		row.addEventListener("click", async () => {
			const media = await this.plugin.storage.media.findById(n.mediaId);
			if (media) {
				this.close();
				this.plugin.openMediaDetail(media);
			}
		});
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
