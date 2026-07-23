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

/**
 * Universal modal header (Milestone 1: Universal Back Button): a single
 * row containing the Back button plus the modal's title, used by every
 * MediaVault modal except Movie/Series/Episode Details (that modal keeps
 * its existing hero-banner header, which already has its own layout).
 *
 * "Back" always just closes the current modal. Every MediaVault modal that
 * stacks on top of another (Actor Details from a Cast tab, Image Picker
 * from the three-dot menu, etc.) leaves its parent open underneath rather
 * than closing it first, so closing only the top modal already *is*
 * "return to the previous MediaVault screen" — there's no separate
 * previous-screen stack to maintain. If nothing was open underneath,
 * closing is indistinguishable from "simply closing the modal", which is
 * the spec'd fallback.
 *
 * This one row replaces the old pattern of a fixed, mobile-only back
 * button floating over separately-rendered title text: the same element
 * now renders identically on desktop and mobile, with the title
 * immediately to the right of the button.
 */
/**
 * Same Back affordance as `renderModalHeader`, but as a bare icon button
 * with no title of its own — for modals (List Details) that already build
 * their own rich title row (editable title, badges, menu button) and just
 * need the Back button prepended to it rather than a whole new row.
 */
export function renderInlineBackButton(modal: Modal, container: HTMLElement): HTMLElement {
	const btn = container.createDiv({ cls: "mediavault-modal-back mediavault-modal-back-inline" });
	setIcon(btn, "arrow-left");
	btn.setAttribute("aria-label", "Back");
	btn.setAttribute("role", "button");
	btn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		modal.close();
	});
	return btn;
}

export function renderModalHeader(modal: Modal, container: HTMLElement, title: string, headingLevel: "h2" | "h3" = "h2"): HTMLElement {
	const row = container.createDiv({ cls: "mediavault-modal-header-row" });
	const btn = row.createDiv({ cls: "mediavault-modal-back" });
	setIcon(btn, "arrow-left");
	btn.setAttribute("aria-label", "Back");
	btn.setAttribute("role", "button");
	btn.addEventListener("click", (evt) => {
		evt.stopPropagation();
		modal.close();
	});
	row.createEl(headingLevel, { cls: "mediavault-modal-header-title", text: title });
	return row;
}
