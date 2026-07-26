import { Menu } from "obsidian";

/**
 * Adds a destructive menu item that requires a second click to confirm
 * (Milestone: Two-Step Delete Confirmation in Hamburger Menus). The item's
 * label/styling flips to the confirm state on the first click; a second
 * click actually performs the action. Obsidian's Menu closes on any item
 * click, so "staying open" is simulated by immediately reopening an
 * identical menu — the caller passes `rebuild` to reconstruct every item
 * (not just this one) so the whole menu comes back intact, now with this
 * item in its confirming state. Closing the menu or clicking elsewhere
 * discards the confirming state naturally, since it only ever exists for
 * the lifetime of that reopened menu instance.
 */
export function addDestructiveMenuItem(
	menu: Menu,
	evt: MouseEvent,
	options: {
		label: string;
		confirmLabel?: string;
		icon?: string;
		confirmIcon?: string;
		confirming: boolean;
		rebuild: (menu: Menu, confirming: boolean) => void;
		onConfirm: () => void;
	}
): void {
	menu.addItem((item) => {
		item.setTitle(options.confirming ? options.confirmLabel ?? `Confirm ${options.label}` : options.label);
		item.setIcon(options.confirming ? options.confirmIcon ?? "alert-triangle" : options.icon ?? "trash");

		const dom = (item as unknown as { dom?: HTMLElement }).dom;
		dom?.addClass("mediavault-menu-item-destructive");
		if (options.confirming) dom?.addClass("is-confirming");

		item.onClick(() => {
			if (options.confirming) {
				options.onConfirm();
			} else {
				const reopened = new Menu();
				options.rebuild(reopened, true);
				reopened.showAtMouseEvent(evt);
			}
		});
	});
}
