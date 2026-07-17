import type { StorageService } from "../storage";
import type { TMDBService } from "../../api/tmdb";
import { MediaItem } from "../../models/media";
import { buildAffinityProfile } from "./affinity";
import { scoreCandidate, scoreCandidateAffinity, explainScore, CandidateInfo } from "./score";
import { Recommendation } from "./types";
import { filterByComfortCriteria, ComfortableMedia } from "../comfort/filter";
import { rankComfortMatches } from "../comfort/rank";
import { getComfortableMedia } from "../comfort/join";
import { MediaType } from "../../types/enums";

const MAX_CANDIDATE_DETAIL_FETCHES = 15;

/** Media rated by the user, sorted highest-rated first. */
export function getTopRatedMedia(media: MediaItem[], limit = 3): MediaItem[] {
	return [...media]
		.filter((m) => m.averageRating !== null)
		.sort((a, b) => (b.averageRating ?? 0) - (a.averageRating ?? 0))
		.slice(0, limit);
}

/**
 * Discovery candidates from TMDB's similar/recommendations for the user's
 * top-rated favorites. Fetches full details (genres/cast/director) for
 * scoring — bounded to MAX_CANDIDATE_DETAIL_FETCHES so a large favorites
 * list can't trigger unbounded API calls; TMDBService's own cache keeps
 * repeat runs cheap regardless.
 */
async function fetchScoredCandidates(
	storage: StorageService,
	tmdb: TMDBService,
	favorites: MediaItem[]
): Promise<{ candidate: { tmdbId: number; mediaKind: "movie" | "tv"; title: string; year: number | null; posterPath: string | null }; score: number; reasons: string[] }[]> {
	const affinityProfile = buildAffinityProfile(await storage.media.getAll(), await storage.watchSessions.getAll());
	const existingMedia = await storage.media.getAll();
	const existingKey = new Set(existingMedia.map((m) => `${m.type}:${m.tmdbId}`));

	const rawCandidates = new Map<string, { tmdbId: number; mediaKind: "movie" | "tv"; title: string; year: number | null; posterPath: string | null }>();

	for (const fav of favorites) {
		const kind = fav.type === MediaType.Movie ? "movie" : "tv";
		const [similar, recs] = await Promise.all([
			tmdb.getSimilar(fav.tmdbId, kind).catch(() => ({ items: [] as const })),
			tmdb.getRecommendations(fav.tmdbId, kind).catch(() => ({ items: [] as const })),
		]);
		for (const item of [...similar.items, ...recs.items]) {
			const key = `${item.mediaKind}:${item.tmdbId}`;
			if (existingKey.has(key)) continue; // already in library
			if (!rawCandidates.has(key)) {
				rawCandidates.set(key, {
					tmdbId: item.tmdbId,
					mediaKind: item.mediaKind,
					title: item.title,
					year: item.year,
					posterPath: item.posterPath,
				});
			}
		}
	}

	const candidateList = [...rawCandidates.values()].slice(0, MAX_CANDIDATE_DETAIL_FETCHES);

	const scored = await Promise.all(
		candidateList.map(async (candidate) => {
			try {
				const details =
					candidate.mediaKind === "movie"
						? await tmdb.getMovie(candidate.tmdbId)
						: await tmdb.getTV(candidate.tmdbId);

				const info: CandidateInfo = {
					genres: details.genres,
					castNames: details.cast.slice(0, 5).map((c) => c.name),
					directorNames: details.crew.filter((c) => c.job === "Director" || c.job === "Creator").map((c) => c.name),
				};

				const breakdown = scoreCandidateAffinity(info, affinityProfile);
				const score = scoreCandidate(breakdown);
				const reasons = explainScore(info, breakdown, affinityProfile);

				return { candidate, score, reasons };
			} catch {
				return { candidate, score: 0, reasons: [] };
			}
		})
	);

	return scored.sort((a, b) => b.score - a.score);
}

async function buildSimilarToFavorites(storage: StorageService, tmdb: TMDBService): Promise<Recommendation[]> {
	const media = await storage.media.getAll();
	const favorites = getTopRatedMedia(media, 3);
	if (favorites.length === 0) return [];

	const scored = await fetchScoredCandidates(storage, tmdb, favorites);

	return scored.slice(0, 3).map(({ candidate, score, reasons }) => ({
		category: "similar_to_favorites" as const,
		tmdbId: candidate.tmdbId,
		mediaKind: candidate.mediaKind,
		title: candidate.title,
		year: candidate.year,
		posterPath: candidate.posterPath,
		score,
		reasons: reasons.length > 0 ? reasons : ["Similar to your top-rated titles"],
	}));
}

/**
 * "Hidden gems": drawn from the same TMDB discovery pool as
 * similar-to-favorites, but specifically the next tier down (ranked 4th
 * onward) — titles with solid affinity that aren't the single most obvious
 * picks. This is a pragmatic proxy for "hidden gem" given TMDB's search/
 * similar endpoints don't expose a popularity figure to filter on directly.
 */
async function buildHiddenGems(storage: StorageService, tmdb: TMDBService): Promise<Recommendation[]> {
	const media = await storage.media.getAll();
	const favorites = getTopRatedMedia(media, 3);
	if (favorites.length === 0) return [];

	const scored = await fetchScoredCandidates(storage, tmdb, favorites);

	return scored.slice(3, 6).map(({ candidate, score, reasons }) => ({
		category: "hidden_gems" as const,
		tmdbId: candidate.tmdbId,
		mediaKind: candidate.mediaKind,
		title: candidate.title,
		year: candidate.year,
		posterPath: candidate.posterPath,
		score,
		reasons: reasons.length > 0 ? reasons : ["A lesser-known match for your taste"],
	}));
}

/** Comfort rewatches: already-watched library items with strong comfort+rewatchability, ranked highest first. */
async function buildComfortRewatchPicks(storage: StorageService): Promise<Recommendation[]> {
	const comfortable = await getComfortableMedia(storage);
	const watched = comfortable.filter((c) => c.media.watchCount > 0);

	const ranked = rankComfortMatches(watched, {});
	const byId = new Map(watched.map((c) => [c.media.id, c]));

	return ranked.slice(0, 5).map((match) => {
		const item = byId.get(match.mediaId) as ComfortableMedia;
		return {
			category: "comfort_rewatch" as const,
			mediaId: item.media.id,
			title: item.media.title,
			year: item.media.year,
			posterPath: item.media.posterPath,
			score: match.score,
			reasons: ["A familiar favorite you already love"],
		};
	});
}

async function buildEnergyPicks(
	storage: StorageService,
	category: "high_energy" | "low_attention"
): Promise<Recommendation[]> {
	const comfortable = await getComfortableMedia(storage);
	const unwatched = comfortable.filter((c) => c.media.watchCount === 0);

	const filtered = filterByComfortCriteria(
		unwatched,
		category === "high_energy" ? { energyMin: 7 } : { attentionMax: 3 }
	);
	const ranked = rankComfortMatches(filtered, {});
	const byId = new Map(filtered.map((c) => [c.media.id, c]));

	return ranked.slice(0, 5).map((match) => {
		const item = byId.get(match.mediaId) as ComfortableMedia;
		return {
			category,
			mediaId: item.media.id,
			title: item.media.title,
			year: item.media.year,
			posterPath: item.media.posterPath,
			score: match.score,
			reasons: [category === "high_energy" ? "High-energy pick from your library" : "Easy, low-attention pick from your library"],
		};
	});
}

export interface RecommendationSet {
	similarToFavorites: Recommendation[];
	hiddenGems: Recommendation[];
	comfortRewatch: Recommendation[];
	highEnergy: Recommendation[];
	lowAttention: Recommendation[];
}

/** Builds all recommendation categories. TMDB-backed categories are skipped gracefully if there are no rated favorites yet. */
export async function buildRecommendations(storage: StorageService, tmdb: TMDBService): Promise<RecommendationSet> {
	const [similarToFavorites, hiddenGems, comfortRewatch, highEnergy, lowAttention] = await Promise.all([
		buildSimilarToFavorites(storage, tmdb),
		buildHiddenGems(storage, tmdb),
		buildComfortRewatchPicks(storage),
		buildEnergyPicks(storage, "high_energy"),
		buildEnergyPicks(storage, "low_attention"),
	]);

	return { similarToFavorites, hiddenGems, comfortRewatch, highEnergy, lowAttention };
}
