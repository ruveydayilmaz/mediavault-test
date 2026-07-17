import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import { CustomList, NewCustomListInput } from "../../models/list";
import { MediaVaultId } from "../../types/common";

export class CustomListRepository extends BaseRepository<CustomList> {
	constructor(adapter: StorageAdapter) {
		super(adapter, "customLists");
	}

	async create(input: NewCustomListInput): Promise<CustomList> {
		const now = new Date().toISOString();
		return this.save({
			id: generateId(),
			description: null,
			mediaIds: [],
			sortMode: "recent",
			owner: null,
			isImported: false,
			importSource: null,
			createdAt: now,
			updatedAt: now,
			...input,
		});
	}

	async update(id: MediaVaultId, patch: Partial<CustomList>): Promise<CustomList | null> {
		return super.update(id, { ...patch, updatedAt: new Date().toISOString() });
	}

	/** Copies title/description/contents into a new list, titled "<name> (Copy)". */
	async duplicate(id: MediaVaultId): Promise<CustomList | null> {
		const original = await this.findById(id);
		if (!original) return null;
		return this.create({
			title: `${original.title} (Copy)`,
			description: original.description,
			mediaIds: [...original.mediaIds],
			sortMode: original.sortMode,
		});
	}

	/** Adds a media item to the end of the list. A no-op (not an error) if it's already present. */
	async addMedia(id: MediaVaultId, mediaId: MediaVaultId): Promise<CustomList | null> {
		const list = await this.findById(id);
		if (!list) return null;
		if (list.mediaIds.includes(mediaId)) return list;
		return this.update(id, { mediaIds: [...list.mediaIds, mediaId] });
	}

	async removeMedia(id: MediaVaultId, mediaId: MediaVaultId): Promise<CustomList | null> {
		const list = await this.findById(id);
		if (!list) return null;
		return this.update(id, { mediaIds: list.mediaIds.filter((m) => m !== mediaId) });
	}

	/**
	 * Persists a caller-supplied order (drag-and-drop) as the new manual
	 * order. Validated to be a permutation of the list's current contents —
	 * if it isn't (stale UI state, concurrent edit), the list is left
	 * unchanged rather than silently losing or duplicating an item.
	 */
	async reorder(id: MediaVaultId, orderedMediaIds: MediaVaultId[]): Promise<CustomList | null> {
		const list = await this.findById(id);
		if (!list) return null;

		const current = new Set(list.mediaIds);
		const proposed = new Set(orderedMediaIds);
		const isValidPermutation =
			current.size === proposed.size && [...current].every((mediaId) => proposed.has(mediaId));

		if (!isValidPermutation) return list;

		return this.update(id, { mediaIds: orderedMediaIds, sortMode: "manual" });
	}

	/**
	 * Strips a mediaId out of every list's `mediaIds` that contains it —
	 * used when a MediaItem is deleted, so lists never keep a dangling
	 * reference. Only lists that actually contain the id are touched.
	 */
	async removeMediaEverywhere(mediaId: MediaVaultId): Promise<number> {
		const all = await this.getAll();
		const affected = all.filter((list) => list.mediaIds.includes(mediaId));
		for (const list of affected) {
			await this.update(list.id, { mediaIds: list.mediaIds.filter((m) => m !== mediaId) });
		}
		return affected.length;
	}
}
