import { Modal, setIcon } from "obsidian";

// Root cause: Obsidian's own close button (`.modal-close-button`) isn't
// always a stable descendant of `modal.modalEl` — on some mobile builds the
// element gets appended asynchronously, and the surrounding
// `.modal-container` can be torn down and recreated (e.g. during the
// mobile sheet-open animation) rather than just having children added to
// it. A MutationObserver scoped to a single per-modal container node can
// end up watching a node that's since been detached from the tree, so it
// silently stops firing - which is what caused the close button to
// reappear on Android/iOS after the previous, per-modal-scoped fix.
//
// Instead of scoping (and re-scoping) an observer per modal, we keep a
// single observer on `document.body` for the lifetime of the app. It only
// ever touches elements that live inside a `.modal.mediavault-modal-shell`
// (i.e. our own modals), so it never affects Obsidian's native modals or
// other plugins' modals. Because it watches `document.body` rather than a
// container reference captured at open-time, it survives any re-parenting
// Obsidian does internally, and it applies uniformly on desktop, Android
// and iOS instead of being gated by a platform check.
let globalCloseButtonObserver: MutationObserver | null = null;

function removeMediaVaultCloseButtons(): void {
  document
    .querySelectorAll<HTMLElement>(
      ".modal.mediavault-modal-shell .modal-close-button",
    )
    .forEach((btn) => btn.remove());
}

function ensureGlobalCloseButtonObserver(): void {
  if (globalCloseButtonObserver) return;
  globalCloseButtonObserver = new MutationObserver(() => {
    removeMediaVaultCloseButtons();
  });
  globalCloseButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function markMediaVaultModalShell(modal: Modal): void {
  modal.modalEl.addClass("mediavault-modal-shell");
  ensureGlobalCloseButtonObserver();
  removeMediaVaultCloseButtons();
}

export function renderMobileBackButton(
  modal: Modal,
  container: HTMLElement,
  onBack?: () => void,
): void {
  markMediaVaultModalShell(modal);
  const btn = container.createDiv({ cls: "mediavault-modal-back" });
  setIcon(btn, "arrow-left");
  btn.setAttribute("aria-label", "Back");
  btn.setAttribute("role", "button");
  btn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    if (onBack) {
      onBack();
    } else {
      modal.close();
    }
  });
}

export function renderInlineBackButton(
  modal: Modal,
  container: HTMLElement,
): HTMLElement {
  markMediaVaultModalShell(modal);
  const btn = container.createDiv({
    cls: "mediavault-modal-back mediavault-modal-back-inline",
  });
  setIcon(btn, "arrow-left");
  btn.setAttribute("aria-label", "Back");
  btn.setAttribute("role", "button");
  btn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    modal.close();
  });
  return btn;
}

export function renderModalHeader(
  modal: Modal,
  container: HTMLElement,
  title: string,
  headingLevel: "h2" | "h3" = "h2",
): HTMLElement {
  markMediaVaultModalShell(modal);
  const row = container.createDiv({ cls: "mediavault-modal-header-row" });
  const btn = row.createDiv({ cls: "mediavault-modal-back" });
  setIcon(btn, "arrow-left");
  btn.setAttribute("aria-label", "Back");
  btn.setAttribute("role", "button");
  btn.addEventListener("click", (evt) => {
    evt.stopPropagation();
    modal.close();
  });
  row.createEl(headingLevel, {
    cls: "mediavault-modal-header-title",
    text: title,
  });
  return row;
}
