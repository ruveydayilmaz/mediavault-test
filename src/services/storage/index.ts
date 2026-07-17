import type { Plugin } from "obsidian";
import { StorageAdapter } from "./storage-adapter";
import { MediaRepository } from "./media-repository";
import { WatchSessionRepository } from "./watch-session-repository";
import { EpisodeRepository, EpisodeProgressRepository } from "./episode-repository";
import { ComfortRepository, ComfortPresetRepository } from "./comfort-repository";
import { SettingsRepository } from "./settings-repository";
import { CustomListRepository } from "./list-repository";
import { NotificationRepository } from "./notification-repository";

export * from "./schema";
export * from "./storage-adapter";
export * from "./base-repository";
export * from "./media-repository";
export * from "./watch-session-repository";
export * from "./episode-repository";
export * from "./comfort-repository";
export * from "./settings-repository";
export * from "./list-repository";
export * from "./notification-repository";

/**
 * Single entry point for all persistence. Instantiated once in main.ts and
 * passed down to views/services that need data access.
 *
 * Usage:
 *   const storage = new StorageService(plugin);
 *   await storage.initialize();
 *   const items = await storage.media.getAll();
 */
export class StorageService {
	readonly adapter: StorageAdapter;

	readonly media: MediaRepository;
	readonly watchSessions: WatchSessionRepository;
	readonly episodes: EpisodeRepository;
	readonly episodeProgress: EpisodeProgressRepository;
	readonly comfortProfiles: ComfortRepository;
	readonly comfortPresets: ComfortPresetRepository;
	readonly settings: SettingsRepository;
	readonly customLists: CustomListRepository;
	readonly notifications: NotificationRepository;

	constructor(plugin: Plugin) {
		this.adapter = new StorageAdapter(plugin);

		this.media = new MediaRepository(this.adapter);
		this.watchSessions = new WatchSessionRepository(this.adapter);
		this.episodes = new EpisodeRepository(this.adapter);
		this.episodeProgress = new EpisodeProgressRepository(this.adapter);
		this.comfortProfiles = new ComfortRepository(this.adapter);
		this.comfortPresets = new ComfortPresetRepository(this.adapter);
		this.settings = new SettingsRepository(this.adapter);
		this.customLists = new CustomListRepository(this.adapter);
		this.notifications = new NotificationRepository(this.adapter);
	}

	async initialize(): Promise<void> {
		await this.adapter.initialize();
	}

	/** Forces an immediate write, bypassing the debounce — call before unload. */
	async flush(): Promise<void> {
		await this.adapter.flush();
	}

	/**
	 * A cheap combined "has anything changed" signature across the
	 * collections that feed analytics/derived views. Callers that cache an
	 * expensive computation (e.g. computeAnalytics over 10,000+ items) can
	 * key their cache on this string and skip recomputation when it's
	 * unchanged, without needing to deep-compare any actual data.
	 */
	getDataVersion(): string {
		return [
			this.media.getVersion(),
			this.watchSessions.getVersion(),
			this.episodes.getVersion(),
			this.episodeProgress.getVersion(),
			this.comfortProfiles.getVersion(),
			this.customLists.getVersion(),
		].join(":");
	}
}
