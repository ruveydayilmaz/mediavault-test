import { computeVisibleRange } from "./virtual-scroll";

export interface VirtualListOptions<T> {
	container: HTMLElement;
	items: T[];
	rowHeight: number;
	renderRow: (item: T, index: number) => HTMLElement;
	/** Rows beyond this count trigger virtualization; below it, everything just renders normally (not worth the complexity/overhead). */
	threshold?: number;
	overscan?: number;
}

/**
 * Renders `items` into `container` as a fixed-row-height virtual list: only
 * DOM nodes for rows within the visible viewport (+ overscan) exist at any
 * time, recycled on scroll. Falls back to rendering everything directly
 * when the item count is below `threshold` — virtualization has its own
 * overhead (scroll listeners, spacer reflows) that isn't worth paying for
 * a 20-row page.
 *
 * Returns a cleanup function that removes the scroll listener; callers
 * should invoke it when the view is torn down or re-rendered from scratch.
 */
export function renderVirtualList<T>(options: VirtualListOptions<T>): () => void {
	const { container, items, rowHeight, renderRow, threshold = 100, overscan = 6 } = options;

	container.empty();

	if (items.length <= threshold) {
		items.forEach((item, i) => container.appendChild(renderRow(item, i)));
		return () => {
			/* nothing to clean up in the non-virtualized path */
		};
	}

	const viewport = container.createDiv({ cls: "mediavault-virtual-viewport" });
	const topSpacer = viewport.createDiv({ cls: "mediavault-virtual-spacer" });
	const rowsContainer = viewport.createDiv({ cls: "mediavault-virtual-rows" });
	const bottomSpacer = viewport.createDiv({ cls: "mediavault-virtual-spacer" });

	function renderVisible() {
		const range = computeVisibleRange(
			viewport.scrollTop,
			viewport.clientHeight || 400,
			rowHeight,
			items.length,
			overscan
		);

		topSpacer.style.height = `${range.topSpacerHeight}px`;
		bottomSpacer.style.height = `${range.bottomSpacerHeight}px`;

		rowsContainer.empty();
		for (let i = range.startIndex; i < range.endIndex; i++) {
			rowsContainer.appendChild(renderRow(items[i], i));
		}
	}

	let ticking = false;
	const onScroll = () => {
		if (ticking) return;
		ticking = true;
		requestAnimationFrame(() => {
			renderVisible();
			ticking = false;
		});
	};

	viewport.addEventListener("scroll", onScroll);
	renderVisible();

	return () => viewport.removeEventListener("scroll", onScroll);
}
