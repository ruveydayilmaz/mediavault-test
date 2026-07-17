import { StorageAdapter } from "./storage-adapter";
import { MediaVaultSettings } from "../../settings/settings";

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
		return this.adapter.getData().settings;
	}

	async update(patch: Partial<MediaVaultSettings>): Promise<MediaVaultSettings> {
		const data = this.adapter.getData();
		data.settings = { ...data.settings, ...patch };
		await this.adapter.requestSave();
		return data.settings;
	}
}
