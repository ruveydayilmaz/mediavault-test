import { App, Platform } from "obsidian";

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
//    to exclude system chrome).
//
// 2. Obsidian's own mobile bottom toolbar. This is an ordinary DOM element
//    Obsidian mounts *inside* the page itself, not OS chrome — so it never
//    produces any layout-vs-visual-viewport delta at all (both viewports
//    already exclude it, since it's just page content sitting on top of
//    everything). No CSS safe-area mechanism can see it because it isn't a
//    safe-area at the OS level; it has to be measured directly from the
//    DOM.
//
// Because #2 is ordinary page content, `visualViewport`'s height already
// excludes #1 by the time we measure #2's geometry against it — so summing
// the two measured insets does *not* double-count the region where the
// toolbar sits directly above the system nav bar (see
// `getAndroidBottomObstruction()` below).
//
// Critically, #2's actual element is NOT assumed to be `.mobile-toolbar` or
// any other guessed class name: Obsidian's mobile chrome markup has shifted
// across versions, and different builds/skins produce different structures.
// Instead, the bottom of the viewport is scanned geometrically for whatever
// is actually docked there right now (see `findBottomDockedObstructions()`),
// and only real measured geometry (`rect.top`, `rect.bottom`) is used to
// compute the obstruction — never an assumed selector match or an assumed
// `rect.bottom === viewport.bottom` equality.

const ANDROID_DEBUG = true;

function debugLog(...args: unknown[]): void {
  if (!ANDROID_DEBUG) return;
  // eslint-disable-next-line no-console
  console.debug("[MediaVault][android-insets]", ...args);
}

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

// Any real bottom toolbar/navbar is well under this height on a phone
// screen; used as a sanity cap so a large overlay (a modal backdrop, a
// full-height panel, etc.) that happens to be bottom-docked can never be
// mistaken for a slim toolbar.
const MAX_OBSTRUCTION_CANDIDATE_HEIGHT = 160;
// Slack for "is this element's bottom edge actually at the viewport's
// bottom edge right now" — generous enough to tolerate sub-pixel layout
// rounding and a barely-off-screen translate during a mount/dismiss
// animation frame, but nowhere near loose enough to match content that
// merely happens to be near the bottom.
const BOTTOM_DOCK_TOLERANCE = 6;

function isPluginOwnElement(el: HTMLElement): boolean {
  return !!el.closest(
    [
      ".mediavault-library-root",
      ".mediavault-modal-shell",
      ".modal-content",
      ".mediavault-detail-modal",
    ].join(","),
  );
}

function isVisible(el: HTMLElement): boolean {
  const style = window.getComputedStyle(el);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (parseFloat(style.opacity || "1") === 0) return false;
  return true;
}

/**
 * Scans a bounded, shallow set of candidate elements — direct children of
 * `<body>`, plus one level into each of those (where Obsidian's mobile
 * chrome, like the bottom toolbar, is actually mounted) — for whatever is
 * currently docked to the bottom edge of the viewport. Deliberately does
 * not assume any class name: a candidate qualifies purely by its measured
 * `getBoundingClientRect()` sitting flush against the bottom of the
 * viewport, being reasonably toolbar-sized, actually visible, and not
 * being part of MediaVault's own UI (which would otherwise self-match once
 * MediaVault's own bottom-anchored content, like pagination, is itself
 * flush against the bottom edge).
 */
function findBottomDockedObstructions(): HTMLElement[] {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const candidates = new Set<HTMLElement>();

  for (const child of Array.from(document.body.children)) {
    const el = child as HTMLElement;
    candidates.add(el);
    for (const grandchild of Array.from(el.children)) {
      candidates.add(grandchild as HTMLElement);
    }
  }

  const results: HTMLElement[] = [];
  for (const el of candidates) {
    if (isPluginOwnElement(el)) continue;
    if (!isVisible(el)) continue;

    const rect = el.getBoundingClientRect();
    if (rect.width <= 0 || rect.height <= 0) continue;
    if (rect.height > MAX_OBSTRUCTION_CANDIDATE_HEIGHT) continue;
    if (rect.top <= 0) continue;
    if (Math.abs(viewportHeight - rect.bottom) > BOTTOM_DOCK_TOLERANCE)
      continue;

    results.push(el);
  }

  return results;
}

interface ToolbarObstructionResult {
  el: HTMLElement | null;
  rect: DOMRect | null;
  obstruction: number;
}

/**
 * Determines the real obstruction Obsidian's mobile toolbar (or whatever
 * else is genuinely docked to the bottom edge right now) imposes over
 * MediaVault's own bottom-anchored content. The measurement is the gap
 * between the viewport's bottom edge and the obstructing element's *top*
 * edge (not its height, and not an assumed equality with the viewport
 * bottom) — matching the actual overlap MediaVault's content needs to clear,
 * using `getBoundingClientRect()` values that are already viewport-relative
 * regardless of how many wrapper containers Obsidian nests the toolbar in.
 */
function measureObsidianToolbarObstruction(): ToolbarObstructionResult {
  const viewportHeight = window.visualViewport?.height ?? window.innerHeight;
  const obstructions = findBottomDockedObstructions();
  if (obstructions.length === 0) {
    return { el: null, rect: null, obstruction: 0 };
  }

  // If more than one bottom-docked element is found (e.g. a toolbar plus a
  // thin decorative strip beneath it), the true obstruction is measured
  // from the topmost edge among them, since that's the actual highest
  // point MediaVault's content needs to clear.
  let winner = obstructions[0];
  let winnerRect = winner.getBoundingClientRect();
  for (const el of obstructions.slice(1)) {
    const rect = el.getBoundingClientRect();
    if (rect.top < winnerRect.top) {
      winner = el;
      winnerRect = rect;
    }
  }

  const obstruction = Math.max(0, Math.round(viewportHeight - winnerRect.top));
  return { el: winner, rect: winnerRect, obstruction };
}

/**
 * The single number MediaVault actually needs: total required bottom
 * clearance on Android, combining the Android system-navigation inset and
 * the Obsidian toolbar obstruction. These are safe to sum without
 * double-counting — see the module-level comment above for why the
 * toolbar's measured obstruction (against `visualViewport`, which already
 * excludes the system nav bar) never includes the system-nav region twice.
 */
export function getAndroidBottomObstruction(): number {
  const systemInset = measureAndroidSystemInset();
  const { obstruction: toolbarInset } = measureObsidianToolbarObstruction();
  return systemInset + toolbarInset;
}

export function setupAndroidSafeArea(app?: App): void {
  if (!isAndroidDevice() || androidSafeAreaCleanup) return;

  let toolbarEl: HTMLElement | null = null;
  let toolbarResizeObserver: ResizeObserver | null = null;
  let rafHandle: number | null = null;

  const updateSystemInset = (): number => {
    const inset = measureAndroidSystemInset();
    document.body.style.setProperty(
      "--mediavault-android-bottom-inset",
      `${inset}px`,
    );
    return inset;
  };

  const updateToolbarInset = (): ToolbarObstructionResult => {
    const result = measureObsidianToolbarObstruction();
    document.body.style.setProperty(
      "--mediavault-android-toolbar-inset",
      `${result.obstruction}px`,
    );
    return result;
  };

  const attachToolbarObserver = (el: HTMLElement): void => {
    toolbarResizeObserver?.disconnect();
    toolbarResizeObserver = new ResizeObserver(() => updateAll());
    toolbarResizeObserver.observe(el);
  };

  const updateAll = (): void => {
    const systemInset = updateSystemInset();
    const toolbarResult = updateToolbarInset();

    if (toolbarResult.el !== toolbarEl) {
      toolbarEl = toolbarResult.el;
      if (toolbarEl) attachToolbarObserver(toolbarEl);
      else toolbarResizeObserver?.disconnect();
    }

    if (ANDROID_DEBUG) {
      const vv = window.visualViewport;
      const pagination = document.querySelector<HTMLElement>(
        ".mediavault-pagination",
      );
      const paginationRect = pagination?.getBoundingClientRect() ?? null;
      debugLog({
        innerHeight: window.innerHeight,
        visualViewportHeight: vv?.height ?? null,
        systemInset,
        toolbarElFound: toolbarResult.el
          ? `${toolbarResult.el.tagName.toLowerCase()}.${Array.from(toolbarResult.el.classList).join(".")}`
          : null,
        toolbarRectTop: toolbarResult.rect?.top ?? null,
        toolbarRectBottom: toolbarResult.rect?.bottom ?? null,
        toolbarRectHeight: toolbarResult.rect?.height ?? null,
        toolbarObstruction: toolbarResult.obstruction,
        finalBottomInset: systemInset + toolbarResult.obstruction,
        paginationRectTop: paginationRect?.top ?? null,
        paginationRectBottom: paginationRect?.bottom ?? null,
      });
    }
  };

  // Mutations anywhere in Obsidian's DOM are extremely frequent (editor
  // typing, live preview, etc.), so this observer intentionally only
  // watches `document.body`'s direct children and their immediate children
  // (where Obsidian mounts/unmounts top-level chrome like the mobile
  // toolbar), rather than the whole subtree, and coalesces bursts with
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

  // Also watch two levels deep so a toolbar mounted/unmounted inside an
  // existing top-level container (rather than body itself gaining/losing a
  // child) still triggers a re-scan.
  const childObservers: MutationObserver[] = [];
  for (const child of Array.from(document.body.children)) {
    const obs = new MutationObserver(scheduleUpdate);
    obs.observe(child, { childList: true, subtree: false });
    childObservers.push(obs);
  }

  updateAll();

  const vv = window.visualViewport;
  vv?.addEventListener("resize", scheduleUpdate);
  window.addEventListener("orientationchange", scheduleUpdate);
  window.addEventListener("resize", scheduleUpdate);

  const workspace = app?.workspace;
  workspace?.on("layout-change", scheduleUpdate);
  workspace?.on("active-leaf-change", scheduleUpdate);
  workspace?.on("resize", scheduleUpdate);

  androidSafeAreaCleanup = () => {
    if (rafHandle !== null) window.cancelAnimationFrame(rafHandle);
    vv?.removeEventListener("resize", scheduleUpdate);
    window.removeEventListener("orientationchange", scheduleUpdate);
    window.removeEventListener("resize", scheduleUpdate);
    workspace?.off("layout-change", scheduleUpdate);
    workspace?.off("active-leaf-change", scheduleUpdate);
    workspace?.off("resize", scheduleUpdate);
    bodyObserver.disconnect();
    for (const obs of childObservers) obs.disconnect();
    toolbarResizeObserver?.disconnect();
    document.body.style.removeProperty("--mediavault-android-bottom-inset");
    document.body.style.removeProperty("--mediavault-android-toolbar-inset");
  };
}

export function teardownAndroidSafeArea(): void {
  androidSafeAreaCleanup?.();
  androidSafeAreaCleanup = null;
}
