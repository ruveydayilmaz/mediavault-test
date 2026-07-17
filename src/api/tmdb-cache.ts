/**
 * In-memory TTL cache for TMDB API responses, keyed by request signature.
 * Intentionally not persisted to disk — it's a per-session performance
 * optimization to avoid re-fetching the same search/details repeatedly,
 * not a source of truth (that's VaultData, populated on explicit import).
 */
export class TTLCache<T = unknown> {
	private store = new Map<string, { value: T; expiresAt: number }>();

	constructor(private getTtlMs: () => number) {}

	get(key: string): T | undefined {
		const entry = this.store.get(key);
		if (!entry) return undefined;
		if (Date.now() > entry.expiresAt) {
			this.store.delete(key);
			return undefined;
		}
		return entry.value;
	}

	set(key: string, value: T): void {
		const ttl = this.getTtlMs();
		if (ttl <= 0) return; // caching disabled
		this.store.set(key, { value, expiresAt: Date.now() + ttl });
	}

	clear(): void {
		this.store.clear();
	}

	delete(key: string): void {
		this.store.delete(key);
	}

	get size(): number {
		return this.store.size;
	}
}
