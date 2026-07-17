/**
 * Minimal mock of the "obsidian" module for tests. The real module is only
 * available inside the Obsidian app at runtime; tests run in plain Node via
 * Vitest, so anything imported from "obsidian" needs a stand-in here.
 *
 * Only implements what MediaVault's services/pure-logic layers actually
 * touch. UI classes (Modal, ItemView, etc.) are given no-op bases since
 * this suite deliberately tests services/logic, not DOM rendering.
 */
import { vi } from "vitest";

export async function requestUrl(_opts: unknown): Promise<{ status: number; json: unknown; text: string; headers: Record<string, string> }> {
	return { status: 200, json: {}, text: "{}", headers: {} };
}

export class Notice {
	constructor(_message?: string) {}
}

export class Modal {
	app: unknown;
	contentEl: HTMLElement = document.createElement("div");
	constructor(app: unknown) {
		this.app = app;
	}
	open = vi.fn();
	close = vi.fn();
}

export class Setting {
	constructor(_containerEl: HTMLElement) {}
	setName() {
		return this;
	}
	setDesc() {
		return this;
	}
	addText() {
		return this;
	}
	addToggle() {
		return this;
	}
	addDropdown() {
		return this;
	}
	addSlider() {
		return this;
	}
	addButton() {
		return this;
	}
	get controlEl() {
		return document.createElement("div");
	}
}

export class App {}

export class FuzzySuggestModal<T> extends Modal {}
export class SuggestModal<T> extends Modal {}

export class ItemView {
	app: unknown;
	containerEl: HTMLElement = document.createElement("div");
	constructor(leaf: unknown) {
		this.app = leaf;
	}
}

export class PluginSettingTab {
	constructor(_app: unknown, _plugin: unknown) {}
}

export class Plugin {
	app: unknown;
	constructor(app: unknown, _manifest?: unknown) {
		this.app = app;
	}
	addCommand = vi.fn();
	addRibbonIcon = vi.fn();
	addSettingTab = vi.fn();
	registerView = vi.fn();
	registerInterval = vi.fn();
	loadData = vi.fn(async () => ({}));
	saveData = vi.fn(async () => {});
}
