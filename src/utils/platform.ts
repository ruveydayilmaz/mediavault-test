import { Platform } from "obsidian";

export function isAndroidDevice(): boolean {
  return Platform.isAndroidApp;
}

export function applyAndroidBodyClass(): void {
  document.body.classList.toggle("mediavault-android", isAndroidDevice());
}

// --- Android bottom-obstruction detection --------------------------------
//
// Two independent things can eat into the bottom of the screen on Android,
// and neither is reliably reported by `env(safe-area-inset-bottom)` there
// (that mechanism works on iOS but Android's WebView does not populate it
// consistently with the actual on-screen system-bar/gesture-pill height):
//
// 1. The Android *system* navigation bar — 3-button nav, the gesture pill,
//    or nothing at all if the user has it set to auto-hide. This lives
//    outside the WebView's layout viewport entirely, so the only reliable
//    signal for it is the live gap between the layout viewport
//    (`window.innerHeight`, which doesn't shrink for system bars) and the
//    visual viewport (`window.visualViewport`, which Android does shrink
//    to exclude system chrome). This was already implemented below.
//
// 2. Obsidian's own mobile bottom toolbar/floatbar. This is an ordinary DOM
//    element that Obsidian mounts *inside* the page itself, not OS chrome —
//    so it never produces any layout-vs-visual-viewport delta at all (both
//    viewports already exclude it, since it's just page content). No CSS
//    safe-area mechanism can see it because it isn't a safe-area at the OS
//    level; it has to be measured directly from the DOM. This is the part
//    that was previously missing, which is exactly why the existing
//    `env(safe-area-inset-bottom)` rule didn't fix the pagination overlap:
//    it was correctly compensating for #1 but had nothing accounting
//    for #2.
//
// These are intentionally kept as two separate CSS custom properties
// (`--mediavault-android-bottom-inset` for #1,
// `--mediavault-android-toolbar-inset` for #2) rather than summed into one,
// so a call site that only cares about one of them doesn't have to guess
// how much of a combined value came from which source, and so a change in
// one doesn't need to be re-derived from the other.

let androidSafeAreaCleanup: (() => void) | null = null;

function measureAndroidSystemInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const layoutHeight = window.innerHeight;
  const rawInset = layoutHeight - vv.height - vv.offsetTop;
  const inset = Math.max(0, Math.round(rawInset));
  // The on-screen keyboard also shrinks `visualViewport`, by far more than
  // any nav bar/gesture pill ever does (typically 200px+ vs. well under
  // 64px for real system-bar insets across current Android devices). Cap
  // the result so a transient keyboard can't get baked in as permanent
  // bottom padding — this is specifically a *navigation bar* inset, not a
  // "whatever is currently obscuring the viewport" inset.
  return Math.min(inset, 64);
}

// Obsidian doesn't expose a documented API for the mobile toolbar's
// geometry, so it's located directly in the DOM. `.mobile-toolbar` is
// Obsidian's own class for it; the other selectors are defensive fallbacks
// in case a future/older Obsidian build names it differently — all are
// verified against actual measured geometry below rather than trusted
// blindly, so a wrong match just measures as "not an obstruction" instead
// of corrupting the inset.
function findObsidianMobileToolbar(): HTMLElement | null {
  return (
    document.querySelector<HTMLElement>(".mobile-toolbar") ??
    document.querySelector<HTMLElement>(".mobile-navbar") ??
    document.querySelector<HTMLElement>('[class*="mobile"][class*="toolbar"]')
  );
}

function measureObsidianToolbarInset(el: HTMLElement | null): number {
  if (!el) return 0;
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return 0;
  const rect = el.getBoundingClientRect();
  if (rect.height <= 0 || rect.width <= 0) return 0;
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  // Only counts as an obstruction over MediaVault's own bottom-anchored
  // content (e.g. pagination) when it's actually docked at the bottom edge
  // of the viewport right now. If a future Obsidian layout renders it
  // elsewhere (or it's mid-animation off-screen), don't pad for it.
  if (Math.abs(viewportHeight - rect.bottom) > 4) return 0;
  return Math.round(rect.height);
}

export function setupAndroidSafeArea(): void {
  if (!isAndroidDevice() || androidSafeAreaCleanup) return;

  let toolbarEl: HTMLElement | null = null;
  let toolbarResizeObserver: ResizeObserver | null = null;
  let rafHandle: number | null = null;

  const updateSystemInset = (): void => {
    document.body.style.setProperty(
      "--mediavault-android-bottom-inset",
      `${measureAndroidSystemInset()}px`,
    );
  };

  const updateToolbarInset = (): void => {
    document.body.style.setProperty(
      "--mediavault-android-toolbar-inset",
      `${measureObsidianToolbarInset(toolbarEl)}px`,
    );
  };

  const attachToolbarObserver = (el: HTMLElement): void => {
    toolbarResizeObserver?.disconnect();
    toolbarResizeObserver = new ResizeObserver(() => updateToolbarInset());
    toolbarResizeObserver.observe(el);
  };

  // Re-locate the toolbar (not just re-measure it) on every update pass:
  // Obsidian can mount/unmount it (e.g. certain full-screen views hide it)
  // well after this plugin has already initialized, so a one-time lookup
  // isn't sufficient — see the MutationObserver below, which is what
  // actually triggers this on Obsidian UI changes rather than polling.
  const findAndAttachToolbar = (): void => {
    const el = findObsidianMobileToolbar();
    if (el !== toolbarEl) {
      toolbarEl = el;
      if (el) attachToolbarObserver(el);
      else toolbarResizeObserver?.disconnect();
    }
    updateToolbarInset();
  };

  const updateAll = (): void => {
    updateSystemInset();
    findAndAttachToolbar();
  };

  // Mutations anywhere in Obsidian's DOM are extremely frequent (editor
  // typing, live preview, etc.), so this observer intentionally only
  // watches `document.body`'s direct children (`subtree: false`) — where
  // Obsidian mounts/unmounts top-level chrome like the mobile toolbar —
  // rather than the whole subtree, and coalesces bursts with
  // requestAnimationFrame rather than recalculating synchronously on every
  // mutation record.
  const scheduleUpdate = (): void => {
    if (rafHandle !== null) return;
    rafHandle = window.requestAnimationFrame(() => {
      rafHandle = null;
      updateAll();
    });
  };

  const bodyObserver = new MutationObserver(scheduleUpdate);
  bodyObserver.observe(document.body, { childList: true, subtree: false });

  updateAll();

  const vv = window.visualViewport;
  vv?.addEventListener("resize", scheduleUpdate);
  window.addEventListener("orientationchange", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);

  androidSafeAreaCleanup = () => {
    if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
    vv?.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("orientationchange", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    bodyObserver.disconnect();
    toolbarResizeObserver?.disconnect();
    document.body.style.removeProperty("--mediavault-android-bottom-inset");
    document.body.style.removeProperty("--mediavault-android-toolbar-inset");
  };
}

export function teardownAndroidSafeArea(): void {
  androidSafeAreaCleanup?.();
  androidSafeAreaCleanup = null;
}
