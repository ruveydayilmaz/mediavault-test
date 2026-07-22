import { Platform } from "obsidian";
import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import { StorageService } from "../../services/storage";
import { renderPoster, progressFillClasses, getMediaPercentWatched } from "./media-render";
import { createCarousel } from "./carousel";

export async function renderFavoritesSection(
	container: HTMLElement,
	storage: StorageService,
	allMedia: MediaItem[],
	activeTab: "movies" | "shows",
	onTabChange: (tab: "movies" | "shows") => void,
	onViewAll: () => void,
	onOpen: (item: MediaItem) => void
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

	const viewAll = header.createEl("button", {
		cls: "mediavault-favorites-view-all",
		text: "View All",
	});

	viewAll.onclick = onViewAll;

	const items = activeTab === "movies" ? movies : shows;

	// Mobile Grid & Layout Improvements (Milestone 1): on phones, Favorites
	// renders as the same responsive grid as the Library view (shared
	// `.mediavault-grid` class/breakpoints) instead of a horizontally
	// scrolling carousel — desktop/tablet keep the carousel unchanged.
	if (Platform.isPhone) {
		const grid = container.createDiv({ cls: "mediavault-grid mediavault-favorites-grid" });

		for (const item of items) {
			const progress = await getMediaPercentWatched(storage, item);
			grid.appendChild(buildFavoriteCard(item, progress, onOpen));
		}

		return;
	}

	const carouselContainer = container.createDiv({ cls: "mediavault-favorites-carousel-container" });
	const { track } = createCarousel(carouselContainer);
	track.addClass("mediavault-favorites-track");

	for (const item of items) {
		const progress = await getMediaPercentWatched(storage, item);
		track.appendChild(buildFavoriteCard(item, progress, onOpen));
	}
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

	card.createDiv({
		cls: "mediavault-favorite-title",
		text: item.title,
	});

	return card;
}
