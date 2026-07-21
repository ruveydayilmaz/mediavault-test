import type { Plugin } from "obsidian";
import { VaultData, createEmptyVaultData, CURRENT_SCHEMA_VERSION } from "./schema";
import { runMigrations } from "./migrations";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Storage & Performance Optimization: `VaultData` is split across several
 * small files instead of one single-file `data.json` blob, so:
 *   - editing an episode review only rewrites `episodes.json`, not the
 *     media list, custom lists, notifications, etc.
 *   - loading is a handful of small parallel reads instead of one big
 *     sequential read + JSON.parse.
 *
 * Grouped by what's typically touched together — episode-related
 * collections share a file since nothing reads one without the others,
 * while `media` and `settings` are split apart from everything else (and
 * from each other) since they change far more often than watch history,
 * lists, or notifications do.
 */
type StorageGroup =
	| "media"
	| "settings"
	| "watchHistory"
	| "episodes"
	| "movieProgress"
	| "lists"
	| "comfort"
	| "notifications";

const GROUP_KEYS: Record<StorageGroup, (keyof VaultData)[]> = {
	media: ["media"],
	settings: ["settings"],
	watchHistory: ["watchSessions"],
	episodes: ["episodes", "episodeProgress", "episodeWatches"],
	movieProgress: ["movieProgress"],
	lists: ["customLists"],
	comfort: ["comfortProfiles", "comfortPresets"],
	notifications: ["notifications"],
};

const ALL_GROUPS = Object.keys(GROUP_KEYS) as StorageGroup[];

function fileNameForGroup(group: StorageGroup): string {
	// camelCase -> kebab-case, e.g. "watchHistory" -> "watch-history.json"
	return group.replace(/[A-Z]/g, (c) => `-${c.toLowerCase()}`) + ".json";
}

/**
 * Wraps Obsidian's vault adapter (rather than Plugin#loadData/#saveData,
 * which only ever gives a plugin one JSON blob) behind the same in-memory
 * `VaultData` shape every repository already expects — so nothing outside
 * this file needs to change. `getData()` still returns one merged object
 * synchronously; the multi-file split and dirty-group tracking are
 * entirely internal to this adapter.
 */
export class StorageAdapter {
	private plugin: Plugin;
	private data: VaultData = createEmptyVaultData();
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private savePromise: Promise<void> | null = null;
	private resolveSavePromise: (() => void) | null = null;

	/** Last-written JSON for each group, to detect which groups actually changed since the last save (no per-repository change tracking needed). */
	private lastWrittenJson = new Map<StorageGroup, string>();

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	private get storageDir(): string {
		return `${this.plugin.manifest.dir ?? `.obsidian/plugins/${this.plugin.manifest.id}`}/storage`;
	}

	private groupPath(group: StorageGroup): string {
		return `${this.storageDir}/${fileNameForGroup(group)}`;
	}

	private get metaPath(): string {
		return `${this.storageDir}/meta.json`;
	}

	private get adapter() {
		return this.plugin.app.vault.adapter;
	}

	/** Load the split storage files, migrating once from a legacy single-file data.json if needed, and re-running schema migrations against the merged split data on every load thereafter. */
	async initialize(): Promise<void> {
		const meta = await this.readJson<{ migrated?: boolean; version?: number }>(this.metaPath);

		if (meta?.migrated) {
			await this.loadFromSplitFiles(meta.version ?? 0);
			return;
		}

		// Not migrated yet — check for legacy single-file data.json (Plugin#loadData).
		const legacy = await this.plugin.loadData();
		if (!legacy) {
			this.data = createEmptyVaultData();
			await this.writeAllGroups(); // first-ever run — nothing to roll back to, safe to write fresh
			await this.writeMeta({ migrated: true, version: this.data.version });
			return;
		}

		const migratedData = runMigrations(legacy as Record<string, unknown>);
		this.data = migratedData;

		// One-time split migration. The legacy data.json is deliberately
		// left untouched on disk — if anything below throws, this run
		// falls back to serving data straight from the already-migrated
		// in-memory copy for this session, meta.json never gets written,
		// and the next launch just retries the same split from the same
		// intact legacy file. No partial/rolled-back state is possible
		// since nothing is deleted until the split is fully written.
		try {
			await this.writeAllGroups();
			await this.writeMeta({ migrated: true, version: this.data.version });
		} catch (err) {
			console.error("MediaVault: storage split migration failed, will retry next launch.", err);
		}
	}

	private async loadFromSplitFiles(storedVersion: number): Promise<void> {
		const empty = createEmptyVaultData();
		const results = await Promise.all(
			ALL_GROUPS.map(async (group) => {
				const partial = await this.readJson<Partial<VaultData>>(this.groupPath(group));
				return { group, partial };
			})
		);

		const merged: VaultData = { ...empty };
		for (const { group, partial } of results) {
			if (!partial) continue;
			for (const key of GROUP_KEYS[group]) {
				if (partial[key] !== undefined) {
					(merged as unknown as Record<string, unknown>)[key] = (partial as Record<string, unknown>)[key];
				}
			}
		}
		merged.version = storedVersion;

		// Schema migrations (new fields, new collections) must keep running
		// against the merged split data exactly as they did against the old
		// single-file blob — the split only changes *where* data lives on
		// disk, not whether it still needs migrating forward over time.
		const needsMigration = storedVersion < CURRENT_SCHEMA_VERSION;
		this.data = needsMigration ? runMigrations(merged as unknown as Record<string, unknown>) : merged;

		for (const group of ALL_GROUPS) {
			this.lastWrittenJson.set(group, JSON.stringify(this.dataForGroup(group)));
		}

		if (needsMigration) {
			// Persist the migrated shape immediately, same as the legacy
			// single-file adapter always did right after a version bump.
			await this.writeAllGroups();
			await this.writeMeta({ migrated: true, version: this.data.version });
		}
	}

	private dataForGroup(group: StorageGroup): Partial<VaultData> {
		const out: Partial<VaultData> = {};
		for (const key of GROUP_KEYS[group]) {
			(out as Record<string, unknown>)[key] = (this.data as unknown as Record<string, unknown>)[key];
		}
		return out;
	}

	private async readJson<T>(path: string): Promise<T | null> {
		try {
			if (!(await this.adapter.exists(path))) return null;
			const raw = await this.adapter.read(path);
			return JSON.parse(raw) as T;
		} catch {
			return null;
		}
	}

	private async ensureDir(): Promise<void> {
		if (!(await this.adapter.exists(this.storageDir))) {
			await this.adapter.mkdir(this.storageDir);
		}
	}

	private async writeGroup(group: StorageGroup): Promise<void> {
		await this.ensureDir();
		const json = JSON.stringify(this.dataForGroup(group));
		await this.adapter.write(this.groupPath(group), json);
		this.lastWrittenJson.set(group, json);
	}

	private async writeAllGroups(): Promise<void> {
		await this.ensureDir();
		await Promise.all(ALL_GROUPS.map((g) => this.writeGroup(g)));
	}

	private async writeMeta(meta: { migrated: boolean; version: number }): Promise<void> {
		await this.ensureDir();
		await this.adapter.write(this.metaPath, JSON.stringify(meta));
	}

	/** Returns the live in-memory data object. Callers must not hold long-lived references across await points that might race a reload. */
	getData(): VaultData {
		return this.data;
	}

	/** Schedules a debounced write of only the groups that actually changed since the last save. */
	requestSave(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
		}

		if (!this.savePromise) {
			this.savePromise = new Promise((resolve) => {
				this.resolveSavePromise = resolve;
			});
		}

		this.saveTimeout = setTimeout(() => {
			void this.flush().then(() => {
				this.resolveSavePromise?.();
				this.savePromise = null;
				this.resolveSavePromise = null;
			});
		}, SAVE_DEBOUNCE_MS);

		return this.savePromise;
	}

	/** Immediately writes only the changed groups to disk, bypassing the debounce. */
	async flush(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		this.data.version = CURRENT_SCHEMA_VERSION;

		const candidates = ALL_GROUPS.map((group) => ({ group, json: JSON.stringify(this.dataForGroup(group)) }));
		const dirty = candidates.filter(({ group, json }) => json !== this.lastWrittenJson.get(group));

		if (dirty.length === 0) return;
		await this.ensureDir();
		await Promise.all(
			dirty.map(async ({ group, json }) => {
				await this.adapter.write(this.groupPath(group), json);
				this.lastWrittenJson.set(group, json);
			})
		);
	}
}
