import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import { MediaVaultNotification, NotificationType } from "../../models/notification";
import { MediaVaultId } from "../../types/common";

export class NotificationRepository extends BaseRepository<MediaVaultNotification> {
	constructor(adapter: StorageAdapter) {
		super(adapter, "notifications");
	}

	async record(
		type: NotificationType,
		mediaId: MediaVaultId,
		title: string,
		message: string
	): Promise<MediaVaultNotification> {
		return this.save({
			id: generateId(),
			type,
			mediaId,
			title,
			message,
			createdAt: new Date().toISOString(),
			read: false,
		});
	}

	/** Has this exact (type, media) event already fired? The core of "notify only once". */
	async alreadyNotified(type: NotificationType, mediaId: MediaVaultId): Promise<boolean> {
		const all = await this.getAll();
		return all.some((n) => n.type === type && n.mediaId === mediaId);
	}

	/**
	 * For recurring reminder types (Watchlist / Continue Watching) rather
	 * than genuinely one-time events: has this (type, media) fired since the
	 * given ISO timestamp? Lets reminders repeat on a cooldown instead of
	 * being suppressed forever after the first nudge.
	 */
	async notifiedSince(type: NotificationType, mediaId: MediaVaultId, sinceISO: string): Promise<boolean> {
		const all = await this.getAll();
		return all.some((n) => n.type === type && n.mediaId === mediaId && n.createdAt >= sinceISO);
	}

	async unreadCount(): Promise<number> {
		const all = await this.getAll();
		return all.filter((n) => !n.read).length;
	}

	async markAllRead(): Promise<void> {
		const all = await this.getAll();
		await Promise.all(all.filter((n) => !n.read).map((n) => this.update(n.id, { read: true })));
	}

	/** Most recent first. */
	async recent(limit = 30): Promise<MediaVaultNotification[]> {
		const all = await this.getAll();
		return [...all].sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, limit);
	}

	/** Deletes every notification referencing a media item — used when a MediaItem is deleted. */
	async deleteByMediaId(mediaId: MediaVaultId): Promise<number> {
		const matches = await this.findWhere((n) => n.mediaId === mediaId);
		for (const n of matches) {
			await this.delete(n.id);
		}
		return matches.length;
	}
}
