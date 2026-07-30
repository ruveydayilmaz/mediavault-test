import { Platform } from "obsidian";

export function isAndroidDevice(): boolean {
  return Platform.isAndroidApp;
}

export function applyAndroidBodyClass(): void {
  document.body.classList.toggle("mediavault-android", isAndroidDevice());
}
