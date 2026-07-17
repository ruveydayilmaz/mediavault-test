/**
 * Builds a horizontally-scrolling carousel shell: a scrollable track plus
 * left/right nav buttons vertically centered on the edges. Callers append
 * their own item elements into the returned `track` — this module only
 * owns scrolling/navigation, not item rendering, so it's reusable for both
 * Favorites and Lists (Milestone 5).
 *
 * - Buttons move exactly one item per click, measured from the first
 *   child's actual width (+ the track's gap) so it works regardless of
 *   item size.
 * - Swipe/touch scrolling comes for free from `overflow-x: auto` +
 *   `scroll-snap-type` — no custom touch handlers needed, which also means
 *   trackpad/mouse-wheel horizontal scroll works the same way.
 * - The track is focusable and listens for ArrowLeft/ArrowRight so it's
 *   fully keyboard-operable too.
 */
export function createCarousel(container: HTMLElement): { track: HTMLElement } {
	container.empty();
	container.addClass("mediavault-carousel");

	const prevBtn = container.createEl("button", {
		cls: "mediavault-carousel-nav mediavault-carousel-nav-prev",
		text: "‹",
	});
	prevBtn.setAttr("aria-label", "Scroll left");

	const track = container.createDiv({ cls: "mediavault-carousel-track" });
	track.setAttr("tabindex", "0");

	const nextBtn = container.createEl("button", {
		cls: "mediavault-carousel-nav mediavault-carousel-nav-next",
		text: "›",
	});
	nextBtn.setAttr("aria-label", "Scroll right");

	const scrollByOneItem = (direction: 1 | -1) => {
		const firstItem = track.firstElementChild as HTMLElement | null;
		if (!firstItem) return;
		const style = getComputedStyle(track);
		const gap = parseFloat(style.columnGap || style.gap || "0") || 0;
		const step = firstItem.getBoundingClientRect().width + gap;
		track.scrollBy({ left: direction * step, behavior: "smooth" });
	};

	prevBtn.addEventListener("click", () => scrollByOneItem(-1));
	nextBtn.addEventListener("click", () => scrollByOneItem(1));
	track.addEventListener("keydown", (evt) => {
		if (evt.key === "ArrowRight") {
			evt.preventDefault();
			scrollByOneItem(1);
		} else if (evt.key === "ArrowLeft") {
			evt.preventDefault();
			scrollByOneItem(-1);
		}
	});

	const updateNavVisibility = () => {
		const atStart = track.scrollLeft <= 1;
		const atEnd = track.scrollLeft + track.clientWidth >= track.scrollWidth - 1;
		prevBtn.toggleClass("is-disabled", atStart);
		nextBtn.toggleClass("is-disabled", atEnd || track.scrollWidth <= track.clientWidth);
	};
	track.addEventListener("scroll", updateNavVisibility, { passive: true });
	// Run once after the caller has finished populating the track.
	requestAnimationFrame(updateNavVisibility);

	return { track };
}
