import { setIcon } from "obsidian";
import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import { StorageService } from "../../services/storage";
import { renderPoster, progressFillClasses, getMediaPercentWatched } from "./media-render";
import { createCarousel } from "./carousel";

export interface FavoritesResponsiveOptions {
	/** How many posters should be visible at once without scrolling. */
	visibleCount: number;
	/**
	 * Fill unused slots with placeholder cards so the carousel's width
	 * stays stable instead of collapsing/stretching (Milestone 2: mobile
	 * requirement — the Favorites row must mirror the Library grid's
	 * width even when there are fewer favorites than grid slots).
	 */
	fillPlaceholders: boolean;
}

export async function renderFavoritesSection(
	container: HTMLElement,
	storage: StorageService,
	allMedia: MediaItem[],
	activeTab: "movies" | "shows",
	onTabChange: (tab: "movies" | "shows") => void,
	onViewAll: () => void,
	onOpen: (item: MediaItem) => void,
	responsive: FavoritesResponsiveOptions
): Promise<void> {
	container.empty();

	const favorites = allMedia.filter((m) => m.isFavorite);

	const movies = favorites.filter((m) => m.type === MediaType.Movie);
	const shows = favorites.filter((m) => m.type === MediaType.TVShow);

	if (!movies.length && !shows.length) return;

	if (!movies.length) activeTab = "shows";
	if (!shows.length) activeTab = "movies";

	const header = container.createDiv({
		cls: "mediavault-favorites-header",
	});

	// Mobile: an arrow-style nav icon at the left of the header replaces the
	// desktop "View All" button as the way to open the full page (Mobile
	// Milestone 2: Show All Navigation). Both are always rendered; CSS shows
	// exactly one depending on screen tier, so there's one code path for the
	// click handler on both platforms.
	const tabs = header.createDiv({
		cls: "mediavault-sidebar-tabs",
	});

	if (movies.length) {
		const tab = tabs.createDiv({
			text: "Favorite Movies",
			cls: "mediavault-sidebar-tab" + (activeTab === "movies" ? " is-active" : ""),
		});

		tab.onclick = () => onTabChange("movies");
	}

	if (shows.length) {
		const tab = tabs.createDiv({
			text: "Favorite TV Series",
			cls: "mediavault-sidebar-tab" + (activeTab === "shows" ? " is-active" : ""),
		});

		tab.onclick = () => onTabChange("shows");
	}

	const mobileArrow = header.createEl("button", {
		cls: "clickable-icon mediavault-section-nav-arrow",
	});
	setIcon(mobileArrow, "chevron-right");
	mobileArrow.setAttr("aria-label", "View all favorites");
	mobileArrow.onclick = onViewAll;


	const viewAll = header.createEl("button", {
		cls: "mediavault-favorites-view-all",
		text: "View All",
	});

	viewAll.onclick = onViewAll;

	const items = activeTab === "movies" ? movies : shows;

	const carouselContainer = container.createDiv({ cls: "mediavault-favorites-carousel-container" });
	const { track } = createCarousel(carouselContainer);
	track.addClass("mediavault-favorites-track");

	const visibleCount = Math.max(1, responsive.visibleCount);
	const cardWidth = `calc((100% - ${(visibleCount - 1) * 12}px) / ${visibleCount})`;

	for (const item of items) {
		const progress = await getMediaPercentWatched(storage, item);
		const card = buildFavoriteCard(item, progress, onOpen);
		card.style.width = cardWidth;
		track.appendChild(card);
	}

	if (responsive.fillPlaceholders) {
		for (let i = items.length; i < visibleCount; i++) {
			const placeholder = buildPlaceholderCard();
			placeholder.style.width = cardWidth;
			track.appendChild(placeholder);
		}
	}
}

function buildPlaceholderCard(): HTMLElement {
	const card = document.createElement("div");
	card.addClass("mediavault-favorite-card", "mediavault-favorite-card-placeholder");
	card.createDiv({ cls: "mediavault-favorite-poster" });
	return card;
}

function buildFavoriteCard(item: MediaItem, percentWatched: number | null, onOpen: (item: MediaItem) => void): HTMLElement {
	const card = document.createElement("div");
	card.addClass("mediavault-favorite-card");

	card.onclick = () => onOpen(item);

	const poster = card.createDiv({
		cls: "mediavault-favorite-poster",
	});

	renderPoster(poster, item, "w200");

	if (percentWatched !== null) {
		const progress = poster.createDiv({
			cls: "mediavault-favorite-progress",
		});

		progress.createDiv({
			cls: progressFillClasses("mediavault-favorite-progress-fill", item.status),
			attr: {
				style: `width:${Math.round(percentWatched)}%`,
			},
		});
	}

	return card;
}
