import { Modal, setIcon } from "obsidian";

// --- Investigation -------------------------------------------------------
// Older MediaVault versions never showed Obsidian's default close button
// because every modal's header was rendered with a custom back arrow and
// nothing ever called `Modal.setTitle()` — early Obsidian only injects
// `.modal-close-button` once a modal has title-bar-style chrome. Later
// milestones added `renderModalHeader()`/`renderMobileBackButton()` for a
// consistent in-app header, and around the same time the mobile UI polish
// work (v4.33+) started giving modals a proper `.modal-content` shape.
// That's the point Obsidian's own chrome began rendering its default close
// button on these modals - it isn't tied to a single bad line ever
// reverted, it's a side effect of the modal now looking like a normal
// titled dialog to Obsidian. There's no old code path to simply restore;
// every fix since (CSS selectors, body-level observers, container-shape
// checks) tried to compensate after the fact instead of removing the
// button at the source, which is what's done here.
//
// Fix: explicitly remove `.modal-close-button` from each MediaVault
// modal's own `modalEl` right after it's created, and keep removing it
// on every subsequent re-render via a MutationObserver scoped to that
// modal's `modalEl` only (not the whole document) - so this can never
// touch a native Obsidian modal or another plugin's modal, regardless of
// how many times our own modal clears and re-renders its content.
function removeCloseButton(modal: Modal): void {
  modal.modalEl.querySelector(".modal-close-button")?.remove();
}

function markMediaVaultModalShell(modal: Modal): void {
  modal.modalEl.addClass("mediavault-modal-shell");

  removeCloseButton(modal);

  if (modal.modalEl.dataset.mediavaultCloseObserved === "1") return;
  modal.modalEl.dataset.mediavaultCloseObserved = "1";

  const observer = new MutationObserver(() => removeCloseButton(modal));
  observer.observe(modal.modalEl, { childList: true, subtree: true });

  const originalOnClose = modal.onClose?.bind(modal);
  modal.onClose = (): void => {
    observer.disconnect();
    originalOnClose?.();
  };
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
