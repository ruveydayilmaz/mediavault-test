import { Modal, setIcon } from "obsidian";

// --- Root cause -----------------------------------------------------------
// Every previous attempt at this (CSS descendant selector, then a
// container-scoped MutationObserver, then a body-level MutationObserver)
// assumed `.modal-close-button` is a *descendant* of the `.modal` element
// (`modalEl`), matching desktop's DOM shape. On Obsidian's mobile shell the
// close button is not nested inside `.modal` at all - it's rendered as a
// separate, absolutely-positioned element inside the surrounding
// `.modal-container`, as a *sibling* of `.modal`, so it sits outside the
// area any of those "hide things inside modalEl" checks ever looked at.
// That's why marking `modalEl` with `mediavault-modal-shell` and then
// searching *inside* it (`.modal.mediavault-modal-shell .modal-close-button`,
// via CSS or via querySelectorAll) never matched on mobile: the button
// genuinely isn't inside that subtree.
//
// The fix is structural, not another nesting guess: for any
// `.modal-close-button` found anywhere in the document, walk up to its
// enclosing `.modal-container` and check whether *that* container also
// contains a MediaVault modal shell anywhere within it (parent, sibling, or
// otherwise) - rather than assuming a specific parent/child relationship
// between the two. This only ever touches close buttons that share a modal
// container with one of our own modals, so it can't affect Obsidian's
// native modals or other plugins' modals, and it works regardless of
// whether Obsidian nests the button inside `.modal` (desktop) or beside it
// (mobile).
let globalCloseButtonObserver: MutationObserver | null = null;

function removeMediaVaultCloseButtons(): void {
  document
    .querySelectorAll<HTMLElement>(".modal-close-button")
    .forEach((btn) => {
      const container =
        btn.closest(".modal-container") ?? btn.parentElement ?? btn;
      if (container.querySelector(".mediavault-modal-shell")) {
        btn.remove();
      }
    });
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
