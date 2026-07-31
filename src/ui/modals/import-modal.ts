import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import {
  runImport,
  ImportManagerResult,
} from "../../services/importer/tvtime/manager";
import {
  runZipImport,
  ZipImportResult,
} from "../../services/importer/tvtime/zip-importer";
import {
  previewBundle,
  ImportPreviewSummary,
} from "../../services/importer/tvtime/preview";
import {
  commitBundle,
  ImportReport,
  UnmatchedItem,
} from "../../services/importer/tvtime/commit";
import { NormalizedImportBundle } from "../../services/importer/tvtime/types";
import { ImportTimer } from "../../services/importer/import-timer";

export class ImportModal extends Modal {
  private storage: StorageService;
  private tmdb: TMDBService;
  private onImported?: () => void;

  private fileName = "";
  private result: ImportManagerResult | null = null;
  private preview: ImportPreviewSummary | null = null;
  private report: ImportReport | null = null;
  private importing = false;
  private progressBarEl: HTMLElement | null = null;
  private progressTextEl: HTMLElement | null = null;

  private zip: ZipImportResult | null = null;
  private zipPreview: ImportPreviewSummary | null = null;
  private detecting = false;
  private zipTiming: { stage: string; ms: number; calls: number }[] = [];

  constructor(
    app: App,
    storage: StorageService,
    tmdb: TMDBService,
    onImported?: () => void,
  ) {
    super(app);
    this.storage = storage;
    this.tmdb = tmdb;
    this.onImported = onImported;
  }

  onOpen(): void {
    this.render();
  }

  private render(): void {
    const { contentEl } = this;
    contentEl.empty();
    contentEl.addClass("mediavault-import-modal");
    renderModalHeader(this, contentEl, "Import from TV Time");

    if (this.importing) {
      this.renderProgress(contentEl);
      return;
    }

    if (this.report) {
      this.renderReport(contentEl, this.report);
      return;
    }

    if (this.detecting) {
      this.renderProgress(
        contentEl,
        `Reading "${this.fileName}" — this may take a moment for large exports...`,
      );
      return;
    }

    contentEl.createEl("p", {
      text: "Select a TV Time JSON or CSV export, or a complete GDPR ZIP export. The format and category are detected automatically. Nothing is written until you confirm.",
      cls: "mediavault-import-hint",
    });

    const fileInput = contentEl.createEl("input", {
      type: "file",
      attr: {
        accept: ".json,.csv,.zip,text/csv,application/json,application/zip",
      },
    });
    fileInput.addEventListener("change", async () => {
      const file = fileInput.files?.[0];
      if (!file) return;
      this.fileName = file.name;

      if (/\.zip$/i.test(file.name)) {
        await this.runZipDetectionAndPreview(await file.arrayBuffer());
      } else {
        await this.runDetectionAndPreview(await file.text());
      }
    });

    if (this.zip && this.zipPreview) {
      this.renderZipDetection(contentEl, this.zip);
      this.renderPreview(
        contentEl,
        this.zip.bundle,
        this.zipPreview,
        this.zip.supportedCount > 0,
      );
      return;
    }

    if (this.result && this.preview) {
      this.renderDetection(contentEl, this.result);
      this.renderPreview(
        contentEl,
        this.result.bundle,
        this.preview,
        !this.result.unsupported,
      );
    }
  }

  private renderProgress(
    container: HTMLElement,
    label = "Importing — this may take a moment for large files...",
  ): void {
    container.createEl("p", { text: label, cls: "mediavault-import-hint" });

    const track = container.createDiv({
      cls: "mediavault-import-progress-track",
    });
    this.progressBarEl = track.createDiv({
      cls: "mediavault-import-progress-bar",
    });
    this.progressBarEl.style.width = "0%";

    this.progressTextEl = container.createDiv({
      cls: "mediavault-import-progress-text",
      text: "Starting...",
    });
  }

  private updateProgress(done: number, total: number, stage: string): void {
    if (!this.progressBarEl || !this.progressTextEl) return;
    const percent = total > 0 ? Math.round((done / total) * 100) : 0;
    this.progressBarEl.style.width = `${percent}%`;
    this.progressTextEl.setText(`${stage}: ${done} / ${total}`);
  }

  private async runDetectionAndPreview(fileContent: string): Promise<void> {
    try {
      this.result = runImport(fileContent);
      this.preview = await previewBundle(this.storage, this.result.bundle);
      this.zip = null;
      this.zipPreview = null;
      this.report = null;
      this.render();
    } catch (err) {
      new Notice(
        `MediaVault: could not parse "${this.fileName}" — ${(err as Error).message}`,
      );
    }
  }

  private async runZipDetectionAndPreview(zipData: ArrayBuffer): Promise<void> {
    this.detecting = true;
    this.render();
    try {
      this.zip = await runZipImport(zipData, (done, total) => {
        this.updateProgress(done, total, "Scanning files");
      });
      this.zipTiming = this.zip.timing;
      this.zipPreview = await previewBundle(this.storage, this.zip.bundle);
      this.result = null;
      this.preview = null;
      this.report = null;
    } catch (err) {
      new Notice(
        `MediaVault: could not read "${this.fileName}" — ${(err as Error).message}`,
      );
    } finally {
      this.detecting = false;
      this.render();
    }
  }

  private renderDetection(
    container: HTMLElement,
    result: ImportManagerResult,
  ): void {
    const box = container.createDiv({ cls: "mediavault-import-detection" });
    box.createDiv({ text: "Detected:" });
    box.createDiv({
      cls: "mediavault-import-detection-line",
      text: `${result.detection.format.toUpperCase()} → ${result.detection.label}`,
    });

    if (result.unsupported) {
      box.createDiv({
        cls: "mediavault-import-warning",
        text:
          result.detection.category === "json_list"
            ? "Custom lists are recognized but not importable yet — this is coming in a future update. No data from this file will be imported."
            : `MediaVault doesn't recognize this file's structure yet. Nothing will be imported.`,
      });
    }
  }

  private renderZipDetection(
    container: HTMLElement,
    zip: ZipImportResult,
  ): void {
    const box = container.createDiv({ cls: "mediavault-import-detection" });
    box.createDiv({ text: "TV Time GDPR Export" });

    const list = box.createDiv({ cls: "mediavault-import-zip-files" });
    zip.files.forEach((f) => {
      list.createDiv({
        cls: f.unsupported
          ? "mediavault-import-zip-file is-unsupported"
          : "mediavault-import-zip-file",
        text: f.unsupported
          ? `✕ ${f.filename} — ${f.detection.label}`
          : `✓ ${f.filename} — ${f.detection.label} (${f.rowCount})`,
      });
    });

    box.createDiv({
      cls: "mediavault-import-detection-line",
      text: `${zip.supportedCount} file(s) recognized, ${zip.unsupportedCount} unsupported.`,
    });
  }

  private renderPreview(
    container: HTMLElement,
    bundle: NormalizedImportBundle,
    preview: ImportPreviewSummary,
    canImport: boolean,
  ): void {
    const summary = container.createDiv({ cls: "mediavault-import-summary" });
    summary.createEl("h3", { text: "Preview" });

    const lines = [
      preview.watchCount > 0 ? `${preview.watchCount} watch event(s)` : null,
      preview.reviewCount > 0 ? `${preview.reviewCount} comment(s)` : null,
      preview.likeCount > 0 ? `${preview.likeCount} like(s)` : null,
      preview.ratingCount > 0 ? `${preview.ratingCount} rating(s)` : null,
      preview.favoriteCount > 0 ? `${preview.favoriteCount} favorite(s)` : null,
      preview.listCount > 0 ? `${preview.listCount} custom list(s)` : null,
      `${preview.existingTitles} title(s) already in your library`,
      `${preview.newTitles} new title(s) to look up on TMDB`,
      preview.warningCount > 0
        ? `${preview.warningCount} row(s) will be skipped (see report after import)`
        : null,
    ].filter((l): l is string => l !== null);

    if (lines.length === 0) {
      summary.createDiv({
        cls: "mediavault-import-empty",
        text: "Nothing importable was found.",
      });
      return;
    }

    lines.forEach((l) => summary.createDiv({ text: `• ${l}` }));

    summary.createDiv({
      cls: "mediavault-import-hint",
      text: "Existing reviews, ratings, and likes are never overwritten — only filled in where missing.",
    });

    if (!canImport) return;

    const actions = container.createDiv({ cls: "mediavault-import-actions" });
    const commitBtn = actions.createEl("button", {
      text: this.importing ? "Importing..." : "Confirm import",
      cls: "mod-cta",
    });
    commitBtn.disabled = this.importing;
    commitBtn.addEventListener("click", () => void this.runCommit(bundle));
  }

  private renderReport(container: HTMLElement, report: ImportReport): void {
    container.createEl("h3", { text: "Import complete" });

    if (report.timing.length > 0) {
      const timingBox = container.createDiv({
        cls: "mediavault-import-timing",
      });
      timingBox.createEl("h4", { text: "Time breakdown" });
      report.timing.forEach(({ stage, ms }) => {
        timingBox.createDiv({
          cls:
            stage === "Total"
              ? "mediavault-import-report-row is-total"
              : "mediavault-import-report-row",
          text: `${stage}: ${ImportTimer.formatMs(ms)}`,
        });
      });
    }

    const box = container.createDiv({ cls: "mediavault-import-report" });

    const rows: [string, number][] = [
      ["Movies imported", report.moviesImported],
      ["Shows imported", report.showsImported],
      ["Episodes updated", report.episodesUpdated],
      ["Comments imported", report.commentsImported],
      ["Likes imported", report.likesImported],
      ["Favorites imported", report.favoritesImported],
      ["Ratings imported", report.ratingsImported],
      ["Lists imported", report.listsImported],
      ["Duplicates merged", report.duplicatesMerged],
      ["Skipped", report.skipped],
    ];
    rows.forEach(([label, value]) => {
      box.createDiv({
        cls: "mediavault-import-report-row",
        text: `${label}: ${value}`,
      });
    });

    const diagBox = container.createDiv({
      cls: "mediavault-import-diagnostics",
    });
    diagBox.createEl("h4", { text: "Diagnostics" });
    const totalHours = report.totalImportedRuntimeSeconds / 3600;
    const diagRows: [string, string][] = [
      ["Total records parsed", String(report.totalRecordsParsed)],
      ["Media matched", String(report.matchedMediaCount)],
      ["Media unmatched", String(report.unmatchedMediaCount)],
      ["Episodes matched", String(report.matchedEpisodes)],
      ["Episodes unmatched", String(report.unmatchedEpisodes)],
      ["Total imported watch time", `${totalHours.toFixed(1)} hours`],
    ];
    diagRows.forEach(([label, value]) => {
      diagBox.createDiv({
        cls: "mediavault-import-report-row",
        text: `${label}: ${value}`,
      });
    });

    const skipReasons = Object.entries(report.skippedByReason).sort(
      (a, b) => b[1] - a[1],
    );
    if (skipReasons.length > 0) {
      diagBox.createDiv({
        cls: "mediavault-import-unmatched-group-label",
        text: "Why records were skipped",
      });
      skipReasons.forEach(([reason, count]) => {
        diagBox.createDiv({
          cls: "mediavault-import-report-row",
          text: `${reason}: ${count}`,
        });
      });
    }

    if (report.unmatched.length > 0) {
      const unmatchedBox = container.createDiv({
        cls: "mediavault-import-unmatched",
      });
      unmatchedBox.createEl("h4", {
        text: `Unmatched (${report.unmatched.length})`,
      });

      const movies = report.unmatched.filter((u) => u.kind === "movie");
      const series = report.unmatched.filter((u) => u.kind === "series");

      const renderGroup = (label: string, items: UnmatchedItem[]) => {
        if (items.length === 0) return;
        unmatchedBox.createDiv({
          cls: "mediavault-import-unmatched-group-label",
          text: label,
        });
        items.slice(0, 25).forEach((u) => {
          unmatchedBox.createDiv({
            cls: "mediavault-import-unmatched-item",
            text: `${u.title}${u.year ? ` (${u.year})` : ""} — ${u.reason}`,
          });
        });
        if (items.length > 25) {
          unmatchedBox.createDiv({
            cls: "mediavault-import-hint",
            text: `...and ${items.length - 25} more.`,
          });
        }
      };

      renderGroup("Movies", movies);
      renderGroup("Series", series);
    }

    if (report.matchLog.length > 0) {
      console.info("MediaVault import match log:", report.matchLog);
    }

    if (report.errors.length > 0) {
      const errBox = container.createDiv({ cls: "mediavault-import-errors" });
      errBox.createEl("h4", { text: "Other errors" });
      report.errors
        .slice(0, 20)
        .forEach((e) => errBox.createDiv({ text: `• ${e.reason}` }));
      if (report.errors.length > 20) {
        errBox.createDiv({
          text: `...and ${report.errors.length - 20} more (see console).`,
        });
      }
      console.warn("MediaVault import errors:", report.errors);
    }

    const doneBtn = container.createEl("button", {
      text: "Done",
      cls: "mod-cta",
    });
    doneBtn.addEventListener("click", () => this.close());
  }

  private async runCommit(bundle: NormalizedImportBundle): Promise<void> {
    this.importing = true;
    this.render();

    try {
      this.report = await commitBundle(
        this.storage,
        this.tmdb,
        bundle,
        (done, total, stage) => {
          this.updateProgress(done, total, stage);
        },
      );
      if (this.zipTiming.length > 0) {
        const merged = new Map<string, { ms: number; calls: number }>();
        for (const { stage, ms, calls } of [
          ...this.zipTiming,
          ...this.report.timing,
        ]) {
          if (stage === "Total") continue;
          const existing = merged.get(stage);
          merged.set(stage, {
            ms: (existing?.ms ?? 0) + ms,
            calls: (existing?.calls ?? 0) + calls,
          });
        }
        const totalMs =
          (this.zipTiming.find((t) => t.stage === "Total")?.ms ?? 0) +
          (this.report.timing.find((t) => t.stage === "Total")?.ms ?? 0);
        this.report.timing = [
          ...[...merged.entries()]
            .map(([stage, v]) => ({ stage, ms: v.ms, calls: v.calls }))
            .sort((a, b) => b.ms - a.ms),
          { stage: "Total", ms: totalMs, calls: 0 },
        ];
      }
      new Notice(
        `MediaVault: import complete — ${this.report.moviesImported + this.report.showsImported} title(s) imported, ${this.report.duplicatesMerged} merged.`,
      );
      this.onImported?.();
    } catch (err) {
      new Notice(`MediaVault: import failed — ${(err as Error).message}`);
    } finally {
      this.importing = false;
      this.render();
    }
  }

  onClose(): void {
    this.contentEl.empty();
  }
}
