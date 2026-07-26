import { App, Notice, PluginSettingTab, Setting, Platform } from "obsidian";
import type MediaVaultPlugin from "../main";
import { RatingScale } from "../types/enums";
import type { MediaVaultSettings } from "./settings";
import { TraktAuthModal } from "../ui/modals/trakt-auth-modal";
import { NotificationHistoryModal } from "../ui/modals/notification-history-modal";
import { disconnectTrakt } from "../services/trakt-token";

export class MediaVaultSettingTab extends PluginSettingTab {
	plugin: MediaVaultPlugin;

	constructor(app: App, plugin: MediaVaultPlugin) {
		super(app, plugin);
		this.plugin = plugin;
	}

	display(): void {
		const { containerEl } = this;
		containerEl.empty();

		const settings = this.plugin.storage.settings;

		containerEl.createEl("h2", { text: "MediaVault Settings" });

		containerEl.createEl("h3", { text: "TMDB" });

		new Setting(containerEl)
			.setName("TMDB API key")
			.setDesc("Required to search and import movie/TV metadata.")
			.addText((text) =>
				text
					.setPlaceholder("Enter your TMDB API key")
					.setValue(settings.get().tmdbApiKey)
					.onChange(async (value) => {
						await settings.update({ tmdbApiKey: value.trim() });
						this.plugin.tmdb.clearCache();
					})
			);

		new Setting(containerEl)
			.setName("Cache duration (minutes)")
			.setDesc("How long to cache TMDB API responses before refetching.")
			.addText((text) =>
				text
					.setPlaceholder("1440")
					.setValue(String(settings.get().cacheDurationMinutes))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed >= 0) {
							await settings.update({ cacheDurationMinutes: parsed });
						}
					})
			);

		new Setting(containerEl)
			.setName("Episode sync interval (hours)")
			.setDesc(
				"How often a Currently Watching show's episodes auto-refresh from TMDB. Shows with no episodes imported yet always sync on first open; Finished/Dropped/Plan to Watch shows never auto-refresh."
			)
			.addText((text) =>
				text
					.setPlaceholder("24")
					.setValue(String(settings.get().episodeSyncIntervalHours))
					.onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed >= 0) {
							await settings.update({ episodeSyncIntervalHours: parsed });
						}
					})
			);

		new Setting(containerEl)
			.setName("Show Adult (+18) Content")
			.setDesc(
				"When off (default), adult movies/TV are excluded from Search, Explore, Recommendations, Similar items, Discovery, and all other TMDB-backed results."
			)
			.addToggle((toggle) =>
				toggle.setValue(settings.get().showAdultContent).onChange(async (value) => {
					await settings.update({ showAdultContent: value });
				})
			);

		containerEl.createEl("h3", { text: "Trakt" });

		new Setting(containerEl)
			.setName("Trakt client ID")
			.addText((text) =>
				text.setValue(settings.get().traktClientId).onChange(async (value) => {
					await settings.update({ traktClientId: value.trim() });
				})
			);

		new Setting(containerEl)
			.setName("Trakt client secret")
			.addText((text) =>
				text.setValue(settings.get().traktClientSecret).onChange(async (value) => {
					await settings.update({ traktClientSecret: value.trim() });
				})
			);

		new Setting(containerEl)
			.setName("Connect Trakt account")
			.setDesc(settings.get().traktAccessToken ? "Connected." : "Not connected.")
			.addButton((btn) => {
				if (settings.get().traktAccessToken) {
					btn.setButtonText("Disconnect").onClick(async () => {
						await disconnectTrakt(this.plugin.storage);
						new Notice("MediaVault: Trakt disconnected.");
						this.display();
					});
				} else {
					btn
						.setButtonText("Connect")
						.setCta()
						.onClick(() => {
							new TraktAuthModal(this.app, this.plugin.storage, () => this.display()).open();
						});
				}
			});

		if (settings.get().traktAccessToken) {
			new Setting(containerEl)
				.setName("Auto-sync")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions({ manual: "Manual only", on_startup: "On startup", interval: "Every X minutes" })
						.setValue(settings.get().traktAutoSync)
						.onChange(async (value) => {
							await settings.update({ traktAutoSync: value as MediaVaultSettings["traktAutoSync"] });
						})
				);

			new Setting(containerEl)
				.setName("Sync interval (minutes)")
				.setDesc("Only used when auto-sync is set to 'Every X minutes'.")
				.addText((text) =>
					text.setValue(String(settings.get().traktSyncIntervalMinutes)).onChange(async (value) => {
						const parsed = parseInt(value, 10);
						if (!isNaN(parsed) && parsed > 0) {
							await settings.update({ traktSyncIntervalMinutes: parsed });
						}
					})
				);

			new Setting(containerEl)
				.setName("History note path")
				.setDesc("Where the generated Trakt Rating History note is written.")
				.addText((text) =>
					text.setValue(settings.get().traktHistoryNotePath).onChange(async (value) => {
						await settings.update({ traktHistoryNotePath: value.trim() || "MediaVault/Trakt Rating History.md" });
					})
				);

			new Setting(containerEl)
				.setName("Sync now")
				.setDesc(
					settings.get().traktLastSyncedAt
						? `Last synced: ${new Date(settings.get().traktLastSyncedAt as string).toLocaleString()}`
						: "Never synced yet."
				)
				.addButton((btn) =>
					btn.setButtonText("Sync now").onClick(async () => {
						await this.plugin.runTraktSync();
						this.display();
					})
				);
		}

		containerEl.createEl("h3", { text: "Comments Languages" });
		containerEl.createEl("p", {
			cls: "setting-item-description",
			text: "Trakt comments are shown in these languages only, in priority order. Use ISO 639-1 codes (e.g. en, ja, de).",
		});

		new Setting(containerEl)
			.setName("Primary language")
			.addText((text) =>
				text
					.setPlaceholder("en")
					.setValue(settings.get().commentsPrimaryLanguage)
					.onChange(async (value) => {
						await settings.update({ commentsPrimaryLanguage: value.trim().toLowerCase() || "en" });
					})
			);

		new Setting(containerEl)
			.setName("Additional languages")
			.setDesc("Comma-separated, in priority order (e.g. ja, de).")
			.addText((text) =>
				text
					.setPlaceholder("ja, de")
					.setValue(settings.get().commentsAdditionalLanguages.join(", "))
					.onChange(async (value) => {
						const langs = value
							.split(",")
							.map((l) => l.trim().toLowerCase())
							.filter((l) => l.length > 0);
						await settings.update({ commentsAdditionalLanguages: langs });
					})
			);

		containerEl.createEl("h3", { text: "Vault Integration" });

		new Setting(containerEl)
			.setName("Media folder path")
			.setDesc("Folder where generated media notes will be stored.")
			.addText((text) =>
				text
					.setPlaceholder("MediaVault")
					.setValue(settings.get().mediaFolderPath)
					.onChange(async (value) => {
						await settings.update({ mediaFolderPath: value.trim() || "MediaVault" });
					})
			);

		new Setting(containerEl)
			.setName("Auto-create notes")
			.setDesc("Automatically generate a markdown note when media is added to your library.")
			.addToggle((toggle) =>
				toggle.setValue(settings.get().autoCreateNotes).onChange(async (value) => {
					await settings.update({ autoCreateNotes: value });
				})
			);

		containerEl.createEl("h3", { text: "Display" });

		if (!Platform.isMobileApp) {
			new Setting(containerEl)
				.setName("Default view")
				.addDropdown((dropdown) =>
					dropdown
						.addOptions({ grid: "Grid", list: "List", table: "Table" })
						.setValue(settings.get().defaultView)
						.onChange(async (value) => {
							await settings.update({
								defaultView: value as MediaVaultSettings["defaultView"],
							});
						})
				);
		}

		new Setting(containerEl)
			.setName("Rating scale")
			.addDropdown((dropdown) =>
				dropdown
					.addOptions({
						[RatingScale.FiveStar]: "5 star",
						[RatingScale.TenPoint]: "10 point",
						[RatingScale.HundredPoint]: "100 point",
					})
					.setValue(settings.get().ratingScale)
					.onChange(async (value) => {
						await settings.update({ ratingScale: value as RatingScale });
					})
			);

		containerEl.createEl("h3", { text: "Notifications" });

		const notifTypeLabels: { key: keyof MediaVaultSettings["notificationsEnabled"]; name: string; desc: string }[] = [
			{ key: "newEpisode", name: "New episode", desc: "A show you're watching has a new episode out." },
			{ key: "newSeason", name: "New season", desc: "A show you're watching has a new season announced." },
			{ key: "movieReleased", name: "Movie released", desc: "A movie on your watchlist has been released." },
			{ key: "seriesReturned", name: "Series returned", desc: "An ended show has come back for more episodes." },
			{ key: "watchlistReminder", name: "Watchlist reminder", desc: "Nudge about titles that have sat on your watchlist a while." },
			{
				key: "continueWatchingReminder",
				name: "Continue watching reminder",
				desc: "Nudge about shows you've stopped partway through.",
			},
		];

		notifTypeLabels.forEach(({ key, name, desc }) => {
			new Setting(containerEl)
				.setName(name)
				.setDesc(desc)
				.addToggle((toggle) =>
					toggle.setValue(settings.get().notificationsEnabled[key]).onChange(async (value) => {
						await settings.update({
							notificationsEnabled: { ...settings.get().notificationsEnabled, [key]: value },
						});
					})
				);
		});

		new Setting(containerEl)
			.setName("Notification time")
			.setDesc("The daily check runs once per day, at or after this local time (24h, HH:mm).")
			.addText((text) =>
				text
					.setPlaceholder("09:00")
					.setValue(settings.get().notificationTime)
					.onChange(async (value) => {
						if (/^\d{1,2}:\d{2}$/.test(value.trim())) {
							await settings.update({ notificationTime: value.trim() });
						}
					})
			);

		new Setting(containerEl)
			.setName("Timezone")
			.setDesc("IANA timezone name (e.g. America/New_York). Leave blank to use this device's local time.")
			.addText((text) =>
				text
					.setPlaceholder("System local time")
					.setValue(settings.get().notificationTimezone)
					.onChange(async (value) => {
						await settings.update({ notificationTimezone: value.trim() });
					})
			);

		new Setting(containerEl)
			.setName("Silent mode")
			.setDesc("Still record notifications to history, but don't show a toast for each one.")
			.addToggle((toggle) =>
				toggle.setValue(settings.get().notificationSilent).onChange(async (value) => {
					await settings.update({ notificationSilent: value });
				})
			);

		new Setting(containerEl)
			.setName("Check now")
			.setDesc(
				settings.get().notificationLastCheckedDate
					? `Last checked: ${settings.get().notificationLastCheckedDate}`
					: "Never checked yet."
			)
			.addButton((btn) =>
				btn.setButtonText("Check now").onClick(async () => {
					await this.plugin.runNotificationCheckNow();
					new Notice("MediaVault: notification check complete.");
					this.display();
				})
			)
			.addButton((btn) =>
				btn.setButtonText("View history").onClick(() => {
					new NotificationHistoryModal(this.app, this.plugin).open();
				})
			);
	}
}
