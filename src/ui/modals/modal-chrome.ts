import { Modal, Platform, setIcon } from "obsidian";

function removeNativeCloseButton(modal: Modal): void {
  const scope: ParentNode =
    modal.modalEl.closest(".modal-container") ??
    modal.modalEl.parentElement ??
    modal.modalEl;

  const removeAll = (): void => {
    scope
      .querySelectorAll<HTMLElement>(".modal-close-button")
      .forEach((btn) => btn.remove());
  };

  removeAll();

  if (modal.modalEl.dataset.mediavaultCloseObserved === "1") return;
  modal.modalEl.dataset.mediavaultCloseObserved = "1";

  // Obsidian's Android build sometimes appends the close button to the
  // modal shell asynchronously (after onOpen runs), so keep watching for
  // as long as the modal is open rather than relying on a single retry.
  const observer = new MutationObserver(removeAll);
  observer.observe(scope, { childList: true, subtree: true });

  const originalOnClose = modal.onClose?.bind(modal);
  modal.onClose = (): void => {
    observer.disconnect();
    originalOnClose?.();
  };
}

function markMediaVaultModalShell(modal: Modal): void {
  modal.modalEl.addClass("mediavault-modal-shell");
  if (Platform.isMobile) {
    removeNativeCloseButton(modal);
  }
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
