import { Platform } from "obsidian";

/**
 * True only on Android (phone or tablet). Used to scope fixes that must not
 * affect iOS or desktop — CSS is gated behind the `mediavault-android` body
 * class this drives (see `applyAndroidBodyClass`), and any JS-side checks
 * should use this helper rather than `Platform.isMobile`, which is also
 * true on iOS.
 */
export function isAndroidDevice(): boolean {
	return Platform.isAndroidApp;
}

/**
 * Adds/removes a `mediavault-android` class on `document.body` so CSS can
 * scope Android-only fixes (safe-area insets, rerender/repaint containment)
 * without affecting iPhone or desktop. Safe to call multiple times.
 */
export function applyAndroidBodyClass(): void {
	document.body.classList.toggle("mediavault-android", isAndroidDevice());
}
