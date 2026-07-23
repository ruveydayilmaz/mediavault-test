import { App, Modal, Notice, Setting } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import { MediaItem } from "../../models/media";
import { ComfortProfile, ComfortFlags } from "../../models/comfort";
import { Season, TriggerWarning } from "../../types/enums";

const FLAG_LABELS: Record<keyof ComfortFlags, string> = {
	safeWhenAnxious: "Safe when anxious",
	safeWhenDepressed: "Safe when depressed",
	goodForBackgroundNoise: "Good for background noise",
	goodWhileCleaning: "Good while cleaning",
	goodBeforeSleep: "Good before sleep",
	cozy: "Cozy",
	funny: "Funny",
	noMajorCharacterDeath: "No major character death",
	lowConflict: "Low conflict",
	familiarFavorite: "Familiar favorite",
};

function labelizeEnum(value: string): string {
	return value.replace(/_/g, " ").replace(/^\w/, (c) => c.toUpperCase());
}

/**
 * Editor for a single media item's ComfortProfile: 1-10 sliders for the
 * core scores, toggles for the boolean flags, and multi-select-style
 * checkboxes for seasonal tags and trigger warnings. Creates the profile
 * (with defaults) on first open if one doesn't exist yet.
 */
export class ComfortProfileModal extends Modal {
	private storage: StorageService;
	private media: MediaItem;
	private onSaved?: () => void;
	private profile!: ComfortProfile;

	constructor(app: App, storage: StorageService, media: MediaItem, onSaved?: () => void) {
		super(app);
		this.storage = storage;
		this.media = media;
		this.onSaved = onSaved;
	}

	async onOpen(): Promise<void> {
		this.profile = await this.storage.comfortProfiles.getOrCreate(this.media.id);
		this.render();
	}

	private render(): void {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-comfort-modal");
		renderModalHeader(this, contentEl, `Comfort profile — ${this.media.title}`);

		this.renderSlider(contentEl, "Comfort score", "comfortScore");
		this.renderSlider(contentEl, "Energy level", "energyLevel");
		this.renderSlider(contentEl, "Attention required", "attentionLevel");
		this.renderSlider(contentEl, "Emotional heaviness", "emotionalHeaviness");
		this.renderSlider(contentEl, "Plot complexity", "plotComplexity");
		this.renderSlider(contentEl, "Rewatchability", "rewatchability");

		contentEl.createEl("h3", { text: "Tags" });
		const flagsGrid = contentEl.createDiv({ cls: "mediavault-comfort-flags" });
		(Object.keys(FLAG_LABELS) as (keyof ComfortFlags)[]).forEach((flag) => {
			new Setting(flagsGrid).setName(FLAG_LABELS[flag]).addToggle((toggle) =>
				toggle.setValue(this.profile.flags[flag]).onChange(async (value) => {
					await this.updateProfile({ flags: { ...this.profile.flags, [flag]: value } });
				})
			);
		});

		contentEl.createEl("h3", { text: "Seasonal associations" });
		this.renderMultiToggle(contentEl, Object.values(Season), this.profile.seasonalTags, (tags) =>
			this.updateProfile({ seasonalTags: tags as Season[] })
		);

		contentEl.createEl("h3", { text: "Trigger warnings" });
		this.renderMultiToggle(contentEl, Object.values(TriggerWarning), this.profile.triggerWarnings, (tags) =>
			this.updateProfile({ triggerWarnings: tags as TriggerWarning[] })
		);
	}

	private renderSlider(
		container: HTMLElement,
		label: string,
		field: "comfortScore" | "energyLevel" | "attentionLevel" | "emotionalHeaviness" | "plotComplexity" | "rewatchability"
	): void {
		const setting = new Setting(container).setName(label);
		const valueLabel = setting.controlEl.createSpan({ cls: "mediavault-comfort-slider-value", text: String(this.profile[field]) });
		setting.addSlider((slider) =>
			slider
				.setLimits(1, 10, 1)
				.setValue(this.profile[field])
				.onChange(async (value) => {
					valueLabel.setText(String(value));
					await this.updateProfile({ [field]: value } as Partial<ComfortProfile>);
				})
		);
	}

	private renderMultiToggle(
		container: HTMLElement,
		options: string[],
		selected: string[],
		onChange: (newSelected: string[]) => Promise<void>
	): void {
		const wrap = container.createDiv({ cls: "mediavault-comfort-multitoggle" });
		options.forEach((option) => {
			const pill = wrap.createEl("button", {
				cls: `mediavault-comfort-pill ${selected.includes(option) ? "is-active" : ""}`,
				text: labelizeEnum(option),
			});
			pill.addEventListener("click", async () => {
				const isActive = pill.hasClass("is-active");
				const current = new Set(selected);
				if (isActive) {
					current.delete(option);
					pill.removeClass("is-active");
				} else {
					current.add(option);
					pill.addClass("is-active");
				}
				const updated = [...current];
				// keep `selected` in sync for subsequent clicks within the same render pass
				selected.length = 0;
				selected.push(...updated);
				await onChange(updated);
			});
		});
	}

	private async updateProfile(patch: Partial<ComfortProfile>): Promise<void> {
		try {
			const updated = await this.storage.comfortProfiles.update(this.profile.id, patch);
			if (updated) this.profile = updated;
			this.onSaved?.();
		} catch (err) {
			new Notice(`MediaVault: failed to save comfort profile — ${(err as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
