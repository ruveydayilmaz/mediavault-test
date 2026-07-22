import { Modal, setIcon } from "obsidian";

/**
 * Renders a circular "Back" button in a modal's top-left corner (Milestone
 * 1: Mobile Modal Navigation & Safe Area Support), styled to match
 * Obsidian's own mobile back-chevron convention. Desktop is untouched via
 * CSS (`.mediavault-modal-back` is hidden outside `.is-phone`); on mobile
 * it replaces Obsidian's default top-right close-only "X" for every
 * MediaVault modal (that native button is hidden on mobile via CSS
 * alongside this).
 *
 * Tapping it just calls `modal.close()`. MediaVault modals that open
 * "on top of" another (e.g. Actor Details from a Media Detail modal's Cast
 * tab, or Image Picker from its three-dot menu) never close their parent
 * first — the parent stays open underneath the whole time. So closing only
 * the top modal is already exactly "return to the previous MediaVault
 * screen": whatever was open below reappears untouched. If this was the
 * only MediaVault modal open, closing it is indistinguishable from "simply
 * closing the modal", which is the spec'd fallback — no separate
 * previous-screen bookkeeping needed.
 */
export function renderMobileBackButton(modal: Modal, container: HTMLElement): void {
	const btn = container.createDiv({ cls: "mediavault-modal-back" });
	setIcon(btn, "arrow-left");
	btn.setAttribute("aria-label", "Back");
	btn.setAttribute("role", "button");
	btn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		modal.close();
	});
}
