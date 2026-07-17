import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import { StorageService } from "../../services/storage";
import { renderPoster } from "./media-render";
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

	const carouselContainer = container.createDiv({ cls: "mediavault-favorites-carousel-container" });
	const { track } = createCarousel(carouselContainer);
	track.addClass("mediavault-favorites-track");

	const items = activeTab === "movies" ? movies : shows;

	for (const item of items) {
		const progress = item.type === MediaType.TVShow ? await getShowPercentWatched(storage, item.id) : null;
		track.appendChild(buildFavoriteCard(item, progress, onOpen));
	}
}

async function getShowPercentWatched(storage: StorageService, mediaId: MediaItem["id"]): Promise<number | null> {
	const episodes = await storage.episodes.findByMediaId(mediaId);

	if (!episodes.length) return null;

	const progress = await storage.episodeProgress.getShowProgress(mediaId, episodes);

	return progress.percentWatched;
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
			cls: "mediavault-favorite-progress-fill",
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
