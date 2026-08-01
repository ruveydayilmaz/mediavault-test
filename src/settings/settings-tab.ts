import { App, Notice, PluginSettingTab, Setting, Platform } from "obsidian";
import type MediaVaultPlugin from "../main";
import { RatingScale } from "../types/enums";
import type { MediaVaultSettings } from "./settings";
import { TraktAuthModal } from "../ui/modals/trakt-auth-modal";
import { NotificationHistoryModal } from "../ui/modals/notification-history-modal";
import { disconnectTrakt } from "../services/trakt-token";
import { i18n, t } from "../i18n";
import { SUPPORTED_LOCALES } from "../i18n/types";
import { makeClearable } from "../ui/components/clearable-input";

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

    containerEl.createEl("h2", { text: t("settings.title") });

    new Setting(containerEl)
      .setName(t("settings.language"))
      .setDesc(t("settings.languageDesc"))
      .addDropdown((dropdown) => {
        const options: Record<string, string> = {};
        for (const loc of SUPPORTED_LOCALES) options[loc.code] = loc.label;
        dropdown
          .addOptions(options)
          .setValue(settings.get().language)
          .onChange(async (value) => {
            await this.plugin.setLanguage(value as "en" | "tr");
            this.display();
          });
      });

    containerEl.createEl("h3", { text: t("settings.tmdbSection") });

    new Setting(containerEl)
      .setName(t("settings.tmdbApiKey"))
      .setDesc(t("settings.tmdbApiKeyDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("settings.tmdbApiKeyPlaceholder"))
          .setValue(settings.get().tmdbApiKey)
          .onChange(async (value) => {
            await settings.update({ tmdbApiKey: value.trim() });
            this.plugin.tmdb.clearCache();
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.cacheDuration"))
      .setDesc(t("settings.cacheDurationDesc"))
      .addText((text) =>
        text
          .setPlaceholder("1440")
          .setValue(String(settings.get().cacheDurationMinutes))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              await settings.update({ cacheDurationMinutes: parsed });
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.episodeSyncInterval"))
      .setDesc(t("settings.episodeSyncIntervalDesc"))
      .addText((text) =>
        text
          .setPlaceholder("24")
          .setValue(String(settings.get().episodeSyncIntervalHours))
          .onChange(async (value) => {
            const parsed = parseInt(value, 10);
            if (!isNaN(parsed) && parsed >= 0) {
              await settings.update({ episodeSyncIntervalHours: parsed });
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.showAdultContent"))
      .setDesc(t("settings.showAdultContentDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(settings.get().showAdultContent)
          .onChange(async (value) => {
            await settings.update({ showAdultContent: value });
          }),
      );

    containerEl.createEl("h3", { text: t("settings.traktSection") });

    new Setting(containerEl).setName(t("settings.traktClientId")).addText((text) =>
      text.setValue(settings.get().traktClientId).onChange(async (value) => {
        await settings.update({ traktClientId: value.trim() });
      }),
    );

    new Setting(containerEl).setName(t("settings.traktClientSecret")).addText((text) =>
      text
        .setValue(settings.get().traktClientSecret)
        .onChange(async (value) => {
          await settings.update({ traktClientSecret: value.trim() });
        }),
    );

    new Setting(containerEl)
      .setName(t("settings.connectTraktAccount"))
      .setDesc(
        settings.get().traktAccessToken
          ? t("settings.connected")
          : t("settings.notConnected"),
      )
      .addButton((btn) => {
        if (settings.get().traktAccessToken) {
          btn.setButtonText(t("settings.traktDisconnect")).onClick(async () => {
            await disconnectTrakt(this.plugin.storage);
            new Notice(t("settings.traktDisconnected"));
            this.display();
          });
        } else {
          btn
            .setButtonText(t("settings.traktConnect"))
            .setCta()
            .onClick(() => {
              new TraktAuthModal(this.app, this.plugin.storage, () =>
                this.display(),
              ).open();
            });
        }
      });

    if (settings.get().traktAccessToken) {
      new Setting(containerEl)
        .setName(t("settings.traktAutoSync"))
        .addDropdown((dropdown) =>
          dropdown
            .addOptions({
              manual: t("settings.autoSyncManual"),
              on_startup: t("settings.autoSyncOnStartup"),
              interval: t("settings.autoSyncInterval"),
            })
            .setValue(settings.get().traktAutoSync)
            .onChange(async (value) => {
              await settings.update({
                traktAutoSync: value as MediaVaultSettings["traktAutoSync"],
              });
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.syncIntervalMinutes"))
        .setDesc(t("settings.syncIntervalMinutesDesc"))
        .addText((text) =>
          text
            .setValue(String(settings.get().traktSyncIntervalMinutes))
            .onChange(async (value) => {
              const parsed = parseInt(value, 10);
              if (!isNaN(parsed) && parsed > 0) {
                await settings.update({ traktSyncIntervalMinutes: parsed });
              }
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.historyNotePath"))
        .setDesc(t("settings.historyNotePathDesc"))
        .addText((text) =>
          text
            .setValue(settings.get().traktHistoryNotePath)
            .onChange(async (value) => {
              await settings.update({
                traktHistoryNotePath:
                  value.trim() || "MediaVault/Trakt Rating History.md",
              });
            }),
        );

      new Setting(containerEl)
        .setName(t("settings.syncNow"))
        .setDesc(
          settings.get().traktLastSyncedAt
            ? t("settings.lastSynced", {
                date: i18n.formatDate(
                  settings.get().traktLastSyncedAt as string,
                  {
                    dateStyle: "medium",
                    timeStyle: "short",
                  } as Intl.DateTimeFormatOptions,
                ),
              })
            : t("settings.neverSyncedYet"),
        )
        .addButton((btn) =>
          btn.setButtonText(t("settings.syncNow")).onClick(async () => {
            await this.plugin.runTraktSync();
            this.display();
          }),
        );
    }

    containerEl.createEl("h3", {
      text: t("settings.commentsLanguagesSection"),
    });
    containerEl.createEl("p", {
      cls: "setting-item-description",
      text: t("settings.commentsLanguagesDesc"),
    });

    new Setting(containerEl).setName(t("settings.primaryLanguage")).addText((text) =>
      text
        .setPlaceholder("en")
        .setValue(settings.get().commentsPrimaryLanguage)
        .onChange(async (value) => {
          await settings.update({
            commentsPrimaryLanguage: value.trim().toLowerCase() || "en",
          });
        }),
    );

    new Setting(containerEl)
      .setName(t("settings.additionalLanguages"))
      .setDesc(t("settings.additionalLanguagesDesc"))
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
          }),
      );

    containerEl.createEl("h3", {
      text: t("settings.vaultIntegrationSection"),
    });

    new Setting(containerEl)
      .setName(t("settings.mediaFolderPath"))
      .setDesc(t("settings.mediaFolderPathDesc"))
      .addText((text) =>
        text
          .setPlaceholder("MediaVault")
          .setValue(settings.get().mediaFolderPath)
          .onChange(async (value) => {
            await settings.update({
              mediaFolderPath: value.trim() || "MediaVault",
            });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.autoCreateNotes"))
      .setDesc(t("settings.autoCreateNotesDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(settings.get().autoCreateNotes)
          .onChange(async (value) => {
            await settings.update({ autoCreateNotes: value });
          }),
      );

    containerEl.createEl("h3", { text: t("settings.displaySection") });

    if (!Platform.isMobileApp) {
      new Setting(containerEl)
        .setName(t("settings.defaultView"))
        .addDropdown((dropdown) =>
          dropdown
            .addOptions({
              grid: t("settings.defaultViewGrid"),
              list: t("settings.defaultViewList"),
              table: t("settings.defaultViewTable"),
            })
            .setValue(settings.get().defaultView)
            .onChange(async (value) => {
              await settings.update({
                defaultView: value as MediaVaultSettings["defaultView"],
              });
            }),
        );
    }

    new Setting(containerEl)
      .setName(t("settings.ratingScale"))
      .addDropdown((dropdown) =>
        dropdown
          .addOptions({
            [RatingScale.FiveStar]: t("settings.ratingScaleFiveStar"),
            [RatingScale.TenPoint]: t("settings.ratingScaleTenPoint"),
            [RatingScale.HundredPoint]: t("settings.ratingScaleHundredPoint"),
          })
          .setValue(settings.get().ratingScale)
          .onChange(async (value) => {
            await settings.update({ ratingScale: value as RatingScale });
          }),
      );

    containerEl.createEl("h3", { text: t("settings.notificationsSection") });

    const notifTypeLabels: {
      key: keyof MediaVaultSettings["notificationsEnabled"];
      name: string;
      desc: string;
    }[] = [
      {
        key: "newEpisode",
        name: t("settings.notifNewEpisode"),
        desc: t("settings.notifNewEpisodeDesc"),
      },
      {
        key: "newSeason",
        name: t("settings.notifNewSeason"),
        desc: t("settings.notifNewSeasonDesc"),
      },
      {
        key: "movieReleased",
        name: t("settings.notifMovieReleased"),
        desc: t("settings.notifMovieReleasedDesc"),
      },
      {
        key: "seriesReturned",
        name: t("settings.notifSeriesReturned"),
        desc: t("settings.notifSeriesReturnedDesc"),
      },
      {
        key: "watchlistReminder",
        name: t("settings.notifWatchlistReminder"),
        desc: t("settings.notifWatchlistReminderDesc"),
      },
      {
        key: "continueWatchingReminder",
        name: t("settings.notifContinueWatching"),
        desc: t("settings.notifContinueWatchingDesc"),
      },
    ];

    notifTypeLabels.forEach(({ key, name, desc }) => {
      new Setting(containerEl)
        .setName(name)
        .setDesc(desc)
        .addToggle((toggle) =>
          toggle
            .setValue(settings.get().notificationsEnabled[key])
            .onChange(async (value) => {
              await settings.update({
                notificationsEnabled: {
                  ...settings.get().notificationsEnabled,
                  [key]: value,
                },
              });
            }),
        );
    });

    new Setting(containerEl)
      .setName(t("settings.notificationTime"))
      .setDesc(t("settings.notificationTimeDesc"))
      .addText((text) =>
        text
          .setPlaceholder("09:00")
          .setValue(settings.get().notificationTime)
          .onChange(async (value) => {
            if (/^\d{1,2}:\d{2}$/.test(value.trim())) {
              await settings.update({ notificationTime: value.trim() });
            }
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.notificationTimezone"))
      .setDesc(t("settings.notificationTimezoneDesc"))
      .addText((text) =>
        text
          .setPlaceholder(t("common.unknown"))
          .setValue(settings.get().notificationTimezone)
          .onChange(async (value) => {
            await settings.update({ notificationTimezone: value.trim() });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.notificationSilent"))
      .setDesc(t("settings.notificationSilentDesc"))
      .addToggle((toggle) =>
        toggle
          .setValue(settings.get().notificationSilent)
          .onChange(async (value) => {
            await settings.update({ notificationSilent: value });
          }),
      );

    new Setting(containerEl)
      .setName(t("settings.checkNow"))
      .setDesc(
        settings.get().notificationLastCheckedDate
          ? t("settings.lastChecked", {
              date: settings.get().notificationLastCheckedDate as string,
            })
          : t("settings.neverCheckedYet"),
      )
      .addButton((btn) =>
        btn.setButtonText(t("settings.checkNow")).onClick(async () => {
          await this.plugin.runNotificationCheckNow();
          new Notice(t("settings.checkNowComplete"));
          this.display();
        }),
      )
      .addButton((btn) =>
        btn.setButtonText(t("settings.viewHistory")).onClick(() => {
          new NotificationHistoryModal(this.app, this.plugin).open();
        }),
      );

    containerEl
      .querySelectorAll<HTMLInputElement>('input[type="text"]')
      .forEach((input) => makeClearable(input));
  }
}
