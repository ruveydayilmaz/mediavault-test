import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { Episode, EpisodeProgress } from "../../models/episode";
import { ComfortProfile, ComfortPreset } from "../../models/comfort";
import { CustomList } from "../../models/list";
import { MediaVaultNotification } from "../../models/notification";
import { MediaVaultSettings, DEFAULT_SETTINGS } from "../../settings/settings";
import { DEFAULT_DATA_VERSION } from "../../constants";

/**
 * The single root object persisted via Obsidian's Plugin#saveData /
 * Plugin#loadData (backed by data.json in the plugin folder).
 *
 * Obsidian only gives a plugin one JSON blob to work with, so every
 * collection lives here as a flat array. Repositories (see
 * base-repository.ts) provide indexed, typed CRUD access on top of these
 * arrays — callers should never touch `VaultData` arrays directly outside
 * the storage layer.
 */
export interface VaultData {
	/** Schema version, used to decide which migrations to run on load. */
	version: number;

	settings: MediaVaultSettings;

	media: MediaItem[];
	watchSessions: WatchSession[];
	episodes: Episode[];
	episodeProgress: EpisodeProgress[];
	comfortProfiles: ComfortProfile[];
	comfortPresets: ComfortPreset[];
	customLists: CustomList[];
	notifications: MediaVaultNotification[];
}

/** The current schema version. Bump this and add a migration whenever the shape of VaultData changes. */
export const CURRENT_SCHEMA_VERSION = DEFAULT_DATA_VERSION;

export function createEmptyVaultData(): VaultData {
	return {
		version: CURRENT_SCHEMA_VERSION,
		settings: { ...DEFAULT_SETTINGS },
		media: [],
		watchSessions: [],
		episodes: [],
		episodeProgress: [],
		comfortProfiles: [],
		comfortPresets: [],
		customLists: [],
		notifications: [],
	};
}
