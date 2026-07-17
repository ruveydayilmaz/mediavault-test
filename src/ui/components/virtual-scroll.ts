export interface VirtualRange {
	startIndex: number;
	endIndex: number; // exclusive
	topSpacerHeight: number;
	bottomSpacerHeight: number;
}

/**
 * Computes which item indices should actually be mounted in the DOM for a
 * fixed-row-height virtual list, given the current scroll position. Only
 * rows within the visible viewport (plus a small overscan buffer, so quick
 * scrolling doesn't show blank flashes) are ever rendered — this is what
 * keeps a 10,000-row table view's DOM node count constant instead of
 * growing with the library size.
 */
export function computeVisibleRange(
	scrollTop: number,
	containerHeight: number,
	rowHeight: number,
	totalItems: number,
	overscan = 5
): VirtualRange {
	if (totalItems === 0 || rowHeight <= 0) {
		return { startIndex: 0, endIndex: 0, topSpacerHeight: 0, bottomSpacerHeight: 0 };
	}

	const firstVisible = Math.floor(scrollTop / rowHeight);
	const visibleCount = Math.ceil(containerHeight / rowHeight);

	const startIndex = Math.max(0, firstVisible - overscan);
	const endIndex = Math.min(totalItems, firstVisible + visibleCount + overscan);

	return {
		startIndex,
		endIndex,
		topSpacerHeight: startIndex * rowHeight,
		bottomSpacerHeight: (totalItems - endIndex) * rowHeight,
	};
}
