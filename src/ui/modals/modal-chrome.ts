import { Modal, setIcon } from "obsidian";

// --- Root cause -------------------------------------------------------
// Every previous attempt here (CSS descendant selector, per-modal
// MutationObserver, body-level MutationObserver keyed off a container
// relationship) made an assumption about *where* Obsidian places
// `.modal-close-button` relative to our modal's DOM (inside `.modal`,
// beside it, inside `.modal-container`, etc.). Each of those assumptions
// turned out to be wrong for at least one platform/version, which is why
// the button kept reappearing after each "fix" - we were chasing DOM
// shape instead of the one fact we actually know for certain: whether one
// of *our own* modals is currently open.
//
// Obsidian only ever shows one modal on top at a time, and MediaVault
// never opens a native Obsidian modal from within one of its own modals.
// So instead of guessing the close button's position in the tree, we
// track our own modals' open/close lifecycle directly (a modal is added
// to `openMediaVaultModals` in `markMediaVaultModalShell` and removed in
// its `onClose`), and only while that set is non-empty do we suppress
// `.modal-close-button` anywhere in the document. This can't affect a
// native Obsidian modal or another plugin's modal, because those never
// cause `openMediaVaultModals` to become non-empty in the first place -
// it's gated on our own lifecycle, not on inferred markup structure.
//
// The suppression itself is applied as a direct inline style
// (`!important`) rather than a stylesheet rule, so it can't lose a CSS
// specificity/ordering fight with Obsidian's own core styles - which is
// the other way this kept silently failing.
const openMediaVaultModals = new Set<Modal>();
let closeButtonObserver: MutationObserver | null = null;

function suppressCloseButtonsForOpenMediaVaultModals(): void {
  if (openMediaVaultModals.size === 0) return;
  document
    .querySelectorAll<HTMLElement>(".modal-close-button")
    .forEach((btn) => {
      btn.style.setProperty("display", "none", "important");
    });
}

function ensureCloseButtonObserver(): void {
  if (closeButtonObserver) return;
  closeButtonObserver = new MutationObserver(() => {
    suppressCloseButtonsForOpenMediaVaultModals();
  });
  closeButtonObserver.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function markMediaVaultModalShell(modal: Modal): void {
  modal.modalEl.addClass("mediavault-modal-shell");

  if (!openMediaVaultModals.has(modal)) {
    openMediaVaultModals.add(modal);
    const originalOnClose = modal.onClose?.bind(modal);
    modal.onClose = (): void => {
      openMediaVaultModals.delete(modal);
      originalOnClose?.();
    };
  }

  ensureCloseButtonObserver();
  suppressCloseButtonsForOpenMediaVaultModals();
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
