import { Platform } from "obsidian";

/**
 * Key persisted in localStorage (device-local; purely a "have we shown
 * the UI hint yet" flag, not user data, so it doesn't go through the
 * vault storage/settings system) once the user has either seen the swipe
 * hint play out once, or has manually scrolled a carousel themselves.
 * Shared across all carousel instances so the hint plays at most once
 * total, not once per carousel (Favorites vs Lists).
 */
const SWIPE_HINT_SEEN_KEY = "mediavault-carousel-swipe-hint-seen";

function hasSeenSwipeHint(): boolean {
	try {
		return localStorage.getItem(SWIPE_HINT_SEEN_KEY) === "1";
	} catch {
		return true; // fail safe: never annoy the user if storage is unavailable
	}
}

function markSwipeHintSeen(): void {
	try {
		localStorage.setItem(SWIPE_HINT_SEEN_KEY, "1");
	} catch {
		/* ignore — storage may be unavailable in some environments */
	}
}

/**
 * Plays a one-time "nudge" to hint that the track is horizontally
 * scrollable: a short scroll out and back. Cancels itself immediately if
 * the user starts interacting with the track first.
 */
function playSwipeHint(track: HTMLElement): void {
	if (hasSeenSwipeHint()) return;

	let cancelled = false;
	const cancel = () => {
		if (cancelled) return;
		cancelled = true;
		markSwipeHintSeen();
		track.removeEventListener("pointerdown", cancel);
		track.removeEventListener("touchstart", cancel);
		track.removeEventListener("wheel", cancel);
		track.removeEventListener("scroll", cancel);
	};

	// Any sign of the user touching the carousel cancels the hint and
	// marks it as seen, so it never plays again.
	track.addEventListener("pointerdown", cancel, { passive: true });
	track.addEventListener("touchstart", cancel, { passive: true });
	track.addEventListener("wheel", cancel, { passive: true });
	track.addEventListener("scroll", cancel, { passive: true });

	// Wait for layout (posters/images) to settle, then only bother if
	// there's actually overflow to hint at.
	requestAnimationFrame(() => {
		requestAnimationFrame(() => {
			if (cancelled) return;
			if (track.scrollWidth <= track.clientWidth + 1) return;

			const nudgeDistance = Math.min(48, track.scrollWidth - track.clientWidth);
			track.scrollBy({ left: nudgeDistance, behavior: "smooth" });
			window.setTimeout(() => {
				if (cancelled) return;
				track.scrollBy({ left: -nudgeDistance, behavior: "smooth" });
				// The nudge itself fires `scroll` events, which would
				// otherwise cancel via the listener above before we're
				// done animating — mark as seen only after it plays out.
				window.setTimeout(() => {
					if (!cancelled) markSwipeHintSeen();
				}, 500);
			}, 450);
		});
	});
}

/**
 * Builds a horizontally-scrolling carousel shell: a scrollable track,
 * plus (desktop only) left/right nav buttons vertically centered on the
 * edges. Callers append their own item elements into the returned
 * `track` — this module only owns scrolling/navigation, not item
 * rendering, so it's reusable for both Favorites and Lists (Milestone 5).
 *
 * - On desktop, buttons move exactly one item per click, measured from
 *   the first child's actual width (+ the track's gap) so it works
 *   regardless of item size.
 * - On mobile, nav buttons are omitted entirely — navigation is
 *   swipe/scroll only. A subtle one-time nudge animation plays the first
 *   time a carousel is shown, to hint that it's swipeable, then never
 *   repeats and stops the moment the user touches the carousel
 *   themselves.
 * - Swipe/touch scrolling comes for free from `overflow-x: auto` +
 *   `scroll-snap-type` — no custom touch handlers needed, which also
 *   means trackpad/mouse-wheel horizontal scroll works the same way, and
 *   momentum scrolling on iOS/Android is the platform default (no JS
 *   involved to preserve).
 * - The track is focusable and listens for ArrowLeft/ArrowRight so it's
 *   fully keyboard-operable too.
 */
export function createCarousel(container: HTMLElement): { track: HTMLElement } {
	container.empty();
	container.addClass("mediavault-carousel");

	const track = container.createDiv({ cls: "mediavault-carousel-track" });
	track.setAttr("tabindex", "0");

	if (Platform.isMobile) {
		container.addClass("mediavault-carousel-mobile");
		playSwipeHint(track);
		return { track };
	}

	const prevBtn = container.createEl("button", {
		cls: "mediavault-carousel-nav mediavault-carousel-nav-prev",
		text: "‹",
	});
	prevBtn.setAttr("aria-label", "Scroll left");
	container.insertBefore(prevBtn, track);

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
