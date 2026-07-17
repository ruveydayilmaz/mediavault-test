import { App, Modal, Notice } from "obsidian";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { runImport, ImportManagerResult } from "../../services/importer/tvtime/manager";
import { previewBundle, ImportPreviewSummary } from "../../services/importer/tvtime/preview";
import { commitBundle, ImportReport } from "../../services/importer/tvtime/commit";

/**
 * File → detect format/category → dry-run preview → confirm → commit.
 * Delegates entirely to ImportManager (runImport) — this modal never knows
 * or cares whether the selected file is TV Time JSON, a CSV of comments, a
 * ratings export, etc. Always additive: existing reviews/ratings/likes are
 * never silently overwritten (see commit.ts), and there's no destructive
 * "replace" mode.
 */
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

	constructor(app: App, storage: StorageService, tmdb: TMDBService, onImported?: () => void) {
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

		contentEl.createEl("h2", { text: "Import from TV Time" });

		if (this.importing) {
			this.renderProgress(contentEl);
			return;
		}

		if (this.report) {
			this.renderReport(contentEl, this.report);
			return;
		}

		contentEl.createEl("p", {
			text: "Select any TV Time JSON or CSV export. The format and category are detected automatically. Nothing is written until you confirm.",
			cls: "mediavault-import-hint",
		});

		const fileInput = contentEl.createEl("input", {
			type: "file",
			attr: { accept: ".json,.csv,text/csv,application/json" },
		});
		fileInput.addEventListener("change", async () => {
			const file = fileInput.files?.[0];
			if (!file) return;
			this.fileName = file.name;
			await this.runDetectionAndPreview(await file.text());
		});

		if (this.result && this.preview) {
			this.renderDetection(contentEl, this.result);
			this.renderPreview(contentEl, this.result, this.preview);
		}
	}

	private renderProgress(container: HTMLElement): void {
		container.createEl("p", { text: "Importing — this may take a moment for large files...", cls: "mediavault-import-hint" });

		const track = container.createDiv({ cls: "mediavault-import-progress-track" });
		this.progressBarEl = track.createDiv({ cls: "mediavault-import-progress-bar" });
		this.progressBarEl.style.width = "0%";

		this.progressTextEl = container.createDiv({ cls: "mediavault-import-progress-text", text: "Starting..." });
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
			this.report = null;
			this.render();
		} catch (err) {
			new Notice(`MediaVault: could not parse "${this.fileName}" — ${(err as Error).message}`);
		}
	}

	private renderDetection(container: HTMLElement, result: ImportManagerResult): void {
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

	private renderPreview(container: HTMLElement, result: ImportManagerResult, preview: ImportPreviewSummary): void {
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
			preview.warningCount > 0 ? `${preview.warningCount} row(s) will be skipped (see report after import)` : null,
		].filter((l): l is string => l !== null);

		if (lines.length === 0) {
			summary.createDiv({ cls: "mediavault-import-empty", text: "Nothing importable was found in this file." });
			return;
		}

		lines.forEach((l) => summary.createDiv({ text: `• ${l}` }));

		summary.createDiv({
			cls: "mediavault-import-hint",
			text: "Existing reviews, ratings, and likes are never overwritten — only filled in where missing.",
		});

		if (result.unsupported) return;

		const actions = container.createDiv({ cls: "mediavault-import-actions" });
		const commitBtn = actions.createEl("button", {
			text: this.importing ? "Importing..." : "Confirm import",
			cls: "mod-cta",
		});
		commitBtn.disabled = this.importing;
		commitBtn.addEventListener("click", () => void this.runCommit());
	}

	private renderReport(container: HTMLElement, report: ImportReport): void {
		container.createEl("h3", { text: "Import complete" });
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
			["Errors", report.errors.length],
		];
		rows.forEach(([label, value]) => {
			box.createDiv({ cls: "mediavault-import-report-row", text: `${label}: ${value}` });
		});

		if (report.errors.length > 0) {
			const errBox = container.createDiv({ cls: "mediavault-import-errors" });
			errBox.createEl("h4", { text: "Errors" });
			report.errors.slice(0, 20).forEach((e) => errBox.createDiv({ text: `• ${e.reason}` }));
			if (report.errors.length > 20) {
				errBox.createDiv({ text: `...and ${report.errors.length - 20} more (see console).` });
				console.warn("MediaVault import errors:", report.errors);
			}
		}

		const doneBtn = container.createEl("button", { text: "Done", cls: "mod-cta" });
		doneBtn.addEventListener("click", () => this.close());
	}

	private async runCommit(): Promise<void> {
		if (!this.result) return;

		this.importing = true;
		this.render();

		try {
			this.report = await commitBundle(this.storage, this.tmdb, this.result.bundle, (done, total, stage) => {
				this.updateProgress(done, total, stage);
			});
			new Notice(
				`MediaVault: import complete — ${this.report.moviesImported + this.report.showsImported} title(s) imported, ${this.report.duplicatesMerged} merged.`
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

