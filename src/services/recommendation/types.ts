export interface AffinityProfile {
	genre: Map<string, number>; // 0-1, normalized
	actor: Map<string, number>;
	director: Map<string, number>;
}

export type RecommendationCategory =
	| "similar_to_favorites"
	| "hidden_gems"
	| "comfort_rewatch"
	| "high_energy"
	| "low_attention";

export interface Recommendation {
	category: RecommendationCategory;
	/** Present for external TMDB discovery candidates not yet in the library. */
	tmdbId?: number;
	mediaKind?: "movie" | "tv";
	/** Present for recommendations sourced from the existing library (comfort-based categories). */
	mediaId?: string;
	title: string;
	year: number | null;
	posterPath: string | null;
	score: number;
	reasons: string[];
}

export interface AffinityScoreBreakdown {
	genreAffinity: number;
	actorAffinity: number;
	directorAffinity: number;
	comfortMatch?: number;
}

export interface ScoreWeights {
	genre: number;
	actor: number;
	director: number;
	comfort: number;
}

/** Weights per the spec: genreAffinity*0.35 + actorAffinity*0.2 + directorAffinity*0.15 + comfortMatch*0.3 */
export const DEFAULT_SCORE_WEIGHTS: ScoreWeights = {
	genre: 0.35,
	actor: 0.2,
	director: 0.15,
	comfort: 0.3,
};
