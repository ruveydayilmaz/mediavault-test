import { VaultData, createEmptyVaultData, CURRENT_SCHEMA_VERSION } from "./schema";

/**
 * A migration takes the data at version N and returns it upgraded to
 * version N+1. Keep these small and additive — never delete a migration
 * once it has shipped, since users may be upgrading from any prior version.
 */
type Migration = (data: Record<string, unknown>) => Record<string, unknown>;

/**
 * Keyed by the version being migrated FROM. E.g. migrations[1] takes a v1
 * blob and returns a v2 blob.
 */
const migrations: Record<number, Migration> = {
	// v1 -> v2: WatchSession gains externalSource/externalRef, used to dedupe
	// Trakt-synced watches on repeat syncs without touching manually-logged ones.
	1: (data) => ({
		...data,
		watchSessions: Array.isArray(data.watchSessions)
			? (data.watchSessions as Record<string, unknown>[]).map((s) => ({
					externalSource: null,
					externalRef: null,
					...s,
			  }))
			: [],
	}),

	// v2 -> v3: EpisodeProgress gains `emotion` (Milestone 1: Episode Details
	// Experience) — additive-optional, backfilled null for every existing record.
	2: (data) => ({
		...data,
		episodeProgress: Array.isArray(data.episodeProgress)
			? (data.episodeProgress as Record<string, unknown>[]).map((p) => ({
					emotion: null,
					...p,
			}))
			: [],
	}),
};

/**
 * Fills in any top-level collections that are missing (e.g. from a
 * partially-written or hand-edited data.json) without requiring a version
 * bump. This runs after versioned migrations, on every load.
 */
function withDefaultsApplied(data: Record<string, unknown>): VaultData {
	const empty = createEmptyVaultData();
	return {
		version: typeof data.version === "number" ? data.version : empty.version,
		settings: { ...empty.settings, ...(data.settings as object) },
		media: Array.isArray(data.media) ? (data.media as VaultData["media"]) : empty.media,
		watchSessions: Array.isArray(data.watchSessions)
			? (data.watchSessions as VaultData["watchSessions"])
			: empty.watchSessions,
		episodes: Array.isArray(data.episodes) ? (data.episodes as VaultData["episodes"]) : empty.episodes,
		episodeProgress: Array.isArray(data.episodeProgress)
			? (data.episodeProgress as VaultData["episodeProgress"])
			: empty.episodeProgress,
		comfortProfiles: Array.isArray(data.comfortProfiles)
			? (data.comfortProfiles as VaultData["comfortProfiles"])
			: empty.comfortProfiles,
		comfortPresets: Array.isArray(data.comfortPresets)
			? (data.comfortPresets as VaultData["comfortPresets"])
			: empty.comfortPresets,
		customLists: Array.isArray(data.customLists) ? (data.customLists as VaultData["customLists"]) : empty.customLists,
		notifications: Array.isArray(data.notifications) ? (data.notifications as VaultData["notifications"]) : empty.notifications,
	};
}

/**
 * Runs all applicable migrations in order and returns fully-populated,
 * current-schema VaultData. Safe to call on data of any prior version,
 * including empty/malformed objects.
 */
export function runMigrations(raw: Record<string, unknown> | null | undefined): VaultData {
	let data: Record<string, unknown> = raw ?? {};
	let version = typeof data.version === "number" ? data.version : 0;

	while (version < CURRENT_SCHEMA_VERSION) {
		const migrate = migrations[version];
		if (!migrate) {
			// No migration registered for this version — stop stepping and
			// let withDefaultsApplied backfill any missing fields directly.
			break;
		}
		data = migrate(data);
		version += 1;
		data.version = version;
	}

	return withDefaultsApplied(data);
}
