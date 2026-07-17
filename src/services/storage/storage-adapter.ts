import type { Plugin } from "obsidian";
import { VaultData, createEmptyVaultData, CURRENT_SCHEMA_VERSION } from "./schema";
import { runMigrations } from "./migrations";

const SAVE_DEBOUNCE_MS = 400;

/**
 * Wraps Obsidian's Plugin#loadData / Plugin#saveData (backed by data.json)
 * behind an in-memory VaultData object with debounced writes, so
 * repositories can call `save()` freely (e.g. once per field edit) without
 * hammering disk I/O.
 */
export class StorageAdapter {
	private plugin: Plugin;
	private data: VaultData = createEmptyVaultData();
	private saveTimeout: ReturnType<typeof setTimeout> | null = null;
	private savePromise: Promise<void> | null = null;
	private resolveSavePromise: (() => void) | null = null;

	constructor(plugin: Plugin) {
		this.plugin = plugin;
	}

	/** Load data.json, run any pending migrations, and cache it in memory. */
	async initialize(): Promise<void> {
		const raw = await this.plugin.loadData();

		if (!raw) {
			this.data = createEmptyVaultData();
			await this.flush();
			return;
		}

		const migrated = runMigrations(raw as Record<string, unknown>);
		this.data = migrated;

		// If migrations changed anything, persist immediately.
		if (migrated.version !== (raw as Record<string, unknown>).version) {
			await this.flush();
		}
	}

	/** Returns the live in-memory data object. Callers must not hold long-lived references across await points that might race a reload. */
	getData(): VaultData {
		return this.data;
	}

	/** Schedules a debounced write of the full VaultData blob to disk. */
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

	/** Immediately writes the current in-memory data to disk, bypassing the debounce. */
	async flush(): Promise<void> {
		if (this.saveTimeout) {
			clearTimeout(this.saveTimeout);
			this.saveTimeout = null;
		}
		this.data.version = CURRENT_SCHEMA_VERSION;
		await this.plugin.saveData(this.data);
	}
}
