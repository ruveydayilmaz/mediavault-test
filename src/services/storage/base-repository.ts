import { MediaVaultId } from "../../types/common";
import { StorageAdapter } from "./storage-adapter";
import { VaultData } from "./schema";

/** Any record type a repository can manage must at least have an id. */
interface HasId {
	id: MediaVaultId;
}

/** Simple monotonic-ish unique id generator (uuid v4-ish, no external deps). */
export function generateId(): MediaVaultId {
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = (Math.random() * 16) | 0;
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}

/**
 * Generic CRUD repository over a single collection within VaultData.
 * Concrete repositories (MediaRepository, WatchSessionRepository, etc.)
 * extend this to add domain-specific query methods.
 *
 * All mutating methods schedule a debounced save via the StorageAdapter;
 * callers that need a guaranteed-flushed write (e.g. before closing
 * Obsidian) should await `adapter.flush()` explicitly.
 *
 * PERFORMANCE: findById is backed by a lazily-built id -> record Map so
 * lookups are O(1) instead of a linear scan, which matters once a
 * collection (e.g. watch sessions) reaches tens of thousands of records.
 * The index is invalidated via a monotonic version counter bumped on every
 * save/update/delete, rather than being kept perfectly in sync on every
 * mutation — a full rebuild off a 100k-record array is still sub-
 * millisecond, so simplicity here beats micro-optimizing the invalidation.
 * Subclasses needing a grouped lookup (e.g. "all sessions for this media
 * id") should use `buildIndex()` for the same O(1)-after-first-build
 * behavior instead of calling findWhere in a loop.
 */
export abstract class BaseRepository<T extends HasId> {
	protected adapter: StorageAdapter;
	private collectionKey: keyof VaultData;

	private version = 0;
	private idIndexVersion = -1;
	private idIndex: Map<MediaVaultId, T> = new Map();

	constructor(adapter: StorageAdapter, collectionKey: keyof VaultData) {
		this.adapter = adapter;
		this.collectionKey = collectionKey;
	}

	protected getCollection(): T[] {
		return this.adapter.getData()[this.collectionKey] as unknown as T[];
	}

	/** Bumped on every mutation; used to invalidate this repository's own and subclasses' caches, and exposed publicly so callers (e.g. memoized analytics) can cheaply detect "has anything changed". */
	getVersion(): number {
		return this.version;
	}

	private ensureIdIndex(): Map<MediaVaultId, T> {
		if (this.idIndexVersion !== this.version) {
			this.idIndex = new Map(this.getCollection().map((item) => [item.id, item]));
			this.idIndexVersion = this.version;
		}
		return this.idIndex;
	}

	/**
	 * Builds (or reuses, if still current) a grouped index over the
	 * collection keyed by `keyFn(item)`. Intended for subclass query
	 * methods that would otherwise re-scan the full collection on every
	 * call (e.g. "all watch sessions for media X") — call this once per
	 * query instead of filtering in a loop over many ids.
	 */
	protected buildIndex<K>(keyFn: (item: T) => K, cache: { version: number; map: Map<K, T[]> }): Map<K, T[]> {
		if (cache.version !== this.version) {
			const map = new Map<K, T[]>();
			for (const item of this.getCollection()) {
				const key = keyFn(item);
				const bucket = map.get(key);
				if (bucket) bucket.push(item);
				else map.set(key, [item]);
			}
			cache.map = map;
			cache.version = this.version;
		}
		return cache.map;
	}

	async getAll(): Promise<T[]> {
		return [...this.getCollection()];
	}

	async findById(id: MediaVaultId): Promise<T | null> {
		return this.ensureIdIndex().get(id) ?? null;
	}

	async findWhere(predicate: (item: T) => boolean): Promise<T[]> {
		return this.getCollection().filter(predicate);
	}

	/** Inserts a new record. Callers pass a fully-formed record (id included). */
	async save(record: T): Promise<T> {
		this.getCollection().push(record);
		this.version++;
		// Fire-and-forget: the in-memory mutation above is already complete;
		// only the disk write is debounced. Awaiting it here would force
		// every call in a sequential loop (bulk import, batch season-mark)
		// to block for the full debounce window each time, serializing what
		// should be one coalesced disk write into hundreds. Callers that
		// need a guaranteed-flushed write (e.g. before unload) call
		// `storage.flush()` explicitly instead.
		void this.adapter.requestSave();
		return record;
	}

	/** Partially updates an existing record by id. Returns null if not found. */
	async update(id: MediaVaultId, patch: Partial<T>): Promise<T | null> {
		const collection = this.getCollection();
		const index = collection.findIndex((item) => item.id === id);
		if (index === -1) return null;

		const updated = { ...collection[index], ...patch, id };
		collection[index] = updated;
		this.version++;
		void this.adapter.requestSave();
		return updated;
	}

	async delete(id: MediaVaultId): Promise<boolean> {
		const collection = this.getCollection();
		const index = collection.findIndex((item) => item.id === id);
		if (index === -1) return false;

		collection.splice(index, 1);
		this.version++;
		void this.adapter.requestSave();
		return true;
	}

	async count(): Promise<number> {
		return this.getCollection().length;
	}
}
