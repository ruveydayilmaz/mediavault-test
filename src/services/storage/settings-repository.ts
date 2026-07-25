import { StorageAdapter } from "./storage-adapter";
import { MediaVaultSettings, DEFAULT_SETTINGS } from "../../settings/settings";

/**
 * Thin repository over the `settings` slice of VaultData. Kept separate
 * from BaseRepository since settings are a single object, not a
 * collection of id-keyed records.
 */
export class SettingsRepository {
	private adapter: StorageAdapter;

	constructor(adapter: StorageAdapter) {
		this.adapter = adapter;
	}

	get(): MediaVaultSettings {
		const data = this.adapter.getData();
		// Backfill any settings field added after this vault's data was last
		// saved — a version-bump migration only runs once, so a vault
		// already on the current schema version would otherwise load
		// settings.json exactly as stored, missing newer optional fields
		// entirely (not even `undefined`-safe access, just absent keys).
		const merged: MediaVaultSettings = { ...DEFAULT_SETTINGS, ...data.settings };
		data.settings = merged;
		return merged;
	}

	async update(patch: Partial<MediaVaultSettings>): Promise<MediaVaultSettings> {
		const data = this.adapter.getData();
		data.settings = { ...DEFAULT_SETTINGS, ...data.settings, ...patch };
		await this.adapter.requestSave();
		return data.settings;
	}
}
