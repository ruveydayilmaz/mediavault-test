import { App, Modal, Notice } from "obsidian";
import { renderModalHeader } from "./modal-chrome";
import type { StorageService } from "../../services/storage";
import type { TMDBService } from "../../api/tmdb";
import { TMDBFilmographyItem, TMDBPersonDetails } from "../../types/tmdb";
import { MediaType } from "../../types/enums";
import { tmdbImageUrl } from "../../api/tmdb-normalize";
import { buildMediaItemFromTMDB } from "../../services/media-import";
import { MediaDetailModal } from "./media-detail-modal";

type FilmographyCategory = TMDBFilmographyItem["category"];

const CATEGORY_TABS: { id: FilmographyCategory; label: string }[] = [
	{ id: "tv_series", label: "TV Series" },
	{ id: "tv_program", label: "TV Programs" },
	{ id: "movie", label: "Movies" },
];

/**
 * Opened from a Cast tab (Milestone 4: Cast & Filmography System; tabs +
 * sorting added in Milestone 3: Cast Filmography Improvements). Shows the
 * actor's bio and their combined filmography split into TV Series / TV
 * Programs / Movies tabs, each sorted newest-first; clicking any item
 * opens its existing Details modal if it's already in the library, or
 * offers to add it first — same pattern already used by
 * `RecommendationsModal` for TMDB results that aren't local media yet.
 */
export class ActorDetailsModal extends Modal {
	private storage: StorageService;
	private tmdb: TMDBService;
	private personId: number;

	private person: TMDBPersonDetails | null = null;
	private activeTab: FilmographyCategory | null = null;
	private visibleCountByTab: Record<FilmographyCategory, number> = { tv_series: 30, tv_program: 30, movie: 30 };

	private tabBarEl!: HTMLElement;
	private gridEl!: HTMLElement;

	constructor(app: App, storage: StorageService, tmdb: TMDBService, personId: number) {
		super(app);
		this.storage = storage;
		this.tmdb = tmdb;
		this.personId = personId;
	}

	async onOpen(): Promise<void> {
		const { contentEl } = this;
		contentEl.empty();
		contentEl.addClass("mediavault-detail-modal");
		contentEl.addClass("mediavault-actor-modal");
		const headerRow = renderModalHeader(this, contentEl, "Actor");

		const loading = contentEl.createDiv({ cls: "mediavault-modal-hint", text: "Loading actor details..." });
		try {
			this.person = await this.tmdb.getPersonDetails(this.personId);
		} catch (err) {
			loading.setText(`Couldn't load actor details — ${(err as Error).message}`);
			return;
		}
		loading.remove();
		headerRow.querySelector<HTMLElement>(".mediavault-modal-header-title")?.setText(this.person.name);

		const header = contentEl.createDiv({ cls: "mediavault-actor-header" });
		const photoUrl = tmdbImageUrl(this.person.profilePath, "w342");
		if (photoUrl) {
			header.createEl("img", { cls: "mediavault-actor-photo", attr: { src: photoUrl, alt: this.person.name } });
		}
		const info = header.createDiv({ cls: "mediavault-actor-info" });
		if (this.person.birthday) {
			info.createDiv({ cls: "mediavault-detail-meta", text: `Born ${this.person.birthday}` });
		}
		if (this.person.placeOfBirth) {
			info.createDiv({ cls: "mediavault-detail-meta", text: this.person.placeOfBirth });
		}

		contentEl.createEl("h3", { text: "Filmography" });

		if (this.person.filmography.length === 0) {
			contentEl.createDiv({ cls: "mediavault-modal-hint", text: "No filmography available." });
			return;
		}

		this.tabBarEl = contentEl.createDiv({ cls: "mediavault-detail-tabs" });
		this.gridEl = contentEl.createDiv({ cls: "mediavault-actor-filmography-grid" });

		// Remember the last selected tab while the modal stays open — only
		// pick a fresh default (first non-empty category) the first time.
		if (this.activeTab === null) {
			this.activeTab = CATEGORY_TABS.find((t) => this.itemsForTab(t.id).length > 0)?.id ?? "movie";
		}

		this.renderTabBar();
		this.renderGrid();
	}

	private itemsForTab(category: FilmographyCategory): TMDBFilmographyItem[] {
		return this.person?.filmography.filter((item) => item.category === category) ?? [];
	}

	private renderTabBar(): void {
		this.tabBarEl.empty();
		CATEGORY_TABS.forEach((tab) => {
			const count = this.itemsForTab(tab.id).length;
			const btn = this.tabBarEl.createEl("button", {
				cls: "mediavault-detail-tab" + (this.activeTab === tab.id ? " is-active" : ""),
				text: count > 0 ? `${tab.label} (${count})` : tab.label,
			});
			btn.disabled = count === 0;
			btn.addEventListener("click", () => {
				if (this.activeTab === tab.id) return;
				this.activeTab = tab.id;
				this.renderTabBar();
				this.renderGrid();
			});
		});
	}

	private renderGrid(): void {
		this.gridEl.empty();
		if (!this.activeTab) return;
		this.renderFilmographyPage(this.itemsForTab(this.activeTab));
	}

	/** Lazy-loaded in pages rather than all at once — filmographies for prolific actors can run into the hundreds. */
	private renderFilmographyPage(items: TMDBFilmographyItem[]): void {
		const activeTab = this.activeTab as FilmographyCategory;
		const visibleCount = this.visibleCountByTab[activeTab];
		const page = items.slice(0, visibleCount);
		page.forEach((item) => this.renderFilmographyCard(this.gridEl, item));

		if (items.length > visibleCount) {
			const moreBtn = this.gridEl.createEl("button", {
				cls: "mediavault-actor-load-more",
				text: `Load more (${items.length - visibleCount} remaining)`,
			});
			moreBtn.addEventListener("click", () => {
				this.visibleCountByTab[activeTab] += 30;
				this.renderGrid();
			});
		}
	}

	private renderFilmographyCard(grid: HTMLElement, item: TMDBFilmographyItem): void {
		const card = grid.createDiv({ cls: "mediavault-actor-film-card" });
		const posterUrl = tmdbImageUrl(item.posterPath, "w200");
		const poster = card.createDiv({ cls: "mediavault-card-poster" });
		if (posterUrl) {
			poster.createEl("img", { attr: { src: posterUrl, alt: item.title, loading: "lazy" } });
		} else {
			poster.setText("🎬");
		}
		const info = card.createDiv({ cls: "mediavault-actor-film-info" });
		info.createDiv({ cls: "mediavault-actor-film-title", text: item.year ? `${item.title} (${item.year})` : item.title });
		if (item.character) {
			info.createDiv({ cls: "mediavault-detail-meta", text: `as ${item.character}` });
		}

		card.addEventListener("click", () => void this.openFilmographyItem(item));
	}

	private async openFilmographyItem(item: TMDBFilmographyItem): Promise<void> {
		const mediaKind = item.mediaKind === "movie" ? "movie" : "tv";
		const mediaType = mediaKind === "movie" ? MediaType.Movie : MediaType.TVShow;

		const existing = await this.storage.media.findByTmdbId(item.tmdbId, mediaType);
		if (existing) {
			this.close();
			new MediaDetailModal(this.app, this.storage, this.tmdb, existing).open();
			return;
		}

		// Not in the library yet — open a read-only preview (Milestone 2:
		// Filmography Preview Instead of Auto-Import) built straight from
		// TMDB data, rather than importing on click. The preview modal's
		// own "Add to Library" action is the only thing that writes to
		// storage from here on.
		try {
			const details = mediaKind === "movie" ? await this.tmdb.getMovie(item.tmdbId) : await this.tmdb.getTV(item.tmdbId);
			const previewMedia = buildMediaItemFromTMDB(details);
			this.close();
			new MediaDetailModal(
				this.app,
				this.storage,
				this.tmdb,
				previewMedia,
				undefined,
				undefined,
				"cast",
				undefined,
				undefined,
				true,
				details.tmdbRating
			).open();
		} catch (err) {
			new Notice(`MediaVault: couldn't load "${item.title}" — ${(err as Error).message}`);
		}
	}

	onClose(): void {
		this.contentEl.empty();
	}
}
