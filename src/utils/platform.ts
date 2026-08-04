import { Platform } from "obsidian";

export function isAndroidDevice(): boolean {
  return Platform.isAndroidApp;
}

export function applyAndroidBodyClass(): void {
  document.body.classList.toggle("mediavault-android", isAndroidDevice());
}

// Android's WebView does not reliably report on-screen navigation bar /
// gesture pill height through the CSS `env(safe-area-inset-bottom)`
// mechanism the way iOS does, so a CSS-only safe-area rule silently
// no-ops there. Instead we measure the live gap between the layout
// viewport and the visual viewport (which on Android shrinks to exclude
// system bars) and expose it as a CSS custom property that Android-only
// rules can consume.
let androidSafeAreaCleanup: (() => void) | null = null;

function measureAndroidBottomInset(): number {
  const vv = window.visualViewport;
  if (!vv) return 0;
  const layoutHeight = window.innerHeight;
  const inset = layoutHeight - vv.height - vv.offsetTop;
  return Math.max(0, Math.round(inset));
}

export function setupAndroidSafeArea(): void {
  if (!isAndroidDevice() || androidSafeAreaCleanup) return;

  const update = () => {
    const inset = measureAndroidBottomInset();
    document.body.style.setProperty(
      "--mediavault-android-bottom-inset",
      `${inset}px`,
    );
  };

  update();

  const vv = window.visualViewport;
  vv?.addEventListener("resize", update);
  window.addEventListener("orientationchange", update);
  window.addEventListener("resize", update);

  androidSafeAreaCleanup = () => {
    vv?.removeEventListener("resize", update);
    window.removeEventListener("orientationchange", update);
    window.removeEventListener("resize", update);
    document.body.style.removeProperty("--mediavault-android-bottom-inset");
  };
}

export function teardownAndroidSafeArea(): void {
  androidSafeAreaCleanup?.();
  androidSafeAreaCleanup = null;
}
