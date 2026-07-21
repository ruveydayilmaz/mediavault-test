import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { Episode, EpisodeProgress, EpisodeWatch } from "../../models/episode";
import { MovieProgress } from "../../models/movie-progress";
import { ComfortProfile, ComfortPreset } from "../../models/comfort";
import { CustomList } from "../../models/list";
import { MediaVaultNotification } from "../../models/notification";
import { MediaVaultSettings, DEFAULT_SETTINGS } from "../../settings/settings";
import { DEFAULT_DATA_VERSION } from "../../constants";

/**
 * The in-memory shape every repository reads/writes, kept identical to
 * the original single-blob design so no repository code needed to
 * change. Storage & Performance Optimization split the actual on-disk
 * persistence across several small files (see `storage-adapter.ts`)
 * instead of one `data.json` — `StorageAdapter` transparently merges them
 * back into this same `VaultData` shape on load and only rewrites the
 * files whose data actually changed on save. A legacy single-file
 * `data.json` (via Plugin#loadData/#saveData) is still read once, for a
 * one-time automatic migration into the split files.
 */
export interface VaultData {
	/** Schema version, used to decide which migrations to run on load. */
	version: number;

	settings: MediaVaultSettings;

	media: MediaItem[];
	watchSessions: WatchSession[];
	episodes: Episode[];
	episodeProgress: EpisodeProgress[];
	episodeWatches: EpisodeWatch[];
	movieProgress: MovieProgress[];
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
		episodeWatches: [],
		movieProgress: [],
		comfortProfiles: [],
		comfortPresets: [],
		customLists: [],
		notifications: [],
	};
}
