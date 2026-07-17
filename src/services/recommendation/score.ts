import { AffinityProfile, AffinityScoreBreakdown, ScoreWeights, DEFAULT_SCORE_WEIGHTS } from "./types";

export interface CandidateInfo {
	genres: string[];
	castNames: string[];
	directorNames: string[];
}

/** Average affinity across a candidate's genres/cast/directors — 0 if none of them appear in the profile at all. */
export function scoreCandidateAffinity(candidate: CandidateInfo, profile: AffinityProfile): AffinityScoreBreakdown {
	return {
		genreAffinity: averageAffinity(candidate.genres, profile.genre),
		actorAffinity: averageAffinity(candidate.castNames, profile.actor),
		directorAffinity: averageAffinity(candidate.directorNames, profile.director),
	};
}

function averageAffinity(keys: string[], weights: Map<string, number>): number {
	if (keys.length === 0) return 0;
	const scores = keys.map((k) => weights.get(k) ?? 0);
	return scores.reduce((sum, s) => sum + s, 0) / scores.length;
}

/**
 * Composite score per the spec's weighting: genre*0.35 + actor*0.2 +
 * director*0.15 + comfortMatch*0.3. When comfortMatch is unavailable (the
 * common case for external TMDB discovery candidates, which have no local
 * comfort profile), its weight is redistributed proportionally across the
 * remaining three factors rather than silently treating "no comfort data"
 * as "bad comfort match" — a candidate shouldn't be penalized just for
 * being new to the library.
 */
export function scoreCandidate(breakdown: AffinityScoreBreakdown, weights: ScoreWeights = DEFAULT_SCORE_WEIGHTS): number {
	if (breakdown.comfortMatch === undefined) {
		const remaining = weights.genre + weights.actor + weights.director;
		if (remaining === 0) return 0;
		const scale = (weights.genre + weights.actor + weights.director + weights.comfort) / remaining;
		return (
			breakdown.genreAffinity * weights.genre * scale +
			breakdown.actorAffinity * weights.actor * scale +
			breakdown.directorAffinity * weights.director * scale
		);
	}

	return (
		breakdown.genreAffinity * weights.genre +
		breakdown.actorAffinity * weights.actor +
		breakdown.directorAffinity * weights.director +
		breakdown.comfortMatch * weights.comfort
	);
}

/** Builds a short human-readable list of "why this was recommended" reasons from the strongest factors. */
export function explainScore(candidate: CandidateInfo, breakdown: AffinityScoreBreakdown, profile: AffinityProfile): string[] {
	const reasons: string[] = [];

	const topGenre = candidate.genres.find((g) => (profile.genre.get(g) ?? 0) > 0.5);
	if (topGenre) reasons.push(`You rate ${topGenre} highly`);

	const topActor = candidate.castNames.find((a) => (profile.actor.get(a) ?? 0) > 0.5);
	if (topActor) reasons.push(`Features ${topActor}`);

	const topDirector = candidate.directorNames.find((d) => (profile.director.get(d) ?? 0) > 0.5);
	if (topDirector) reasons.push(`Directed by ${topDirector}`);

	if (breakdown.comfortMatch !== undefined && breakdown.comfortMatch > 0.6) {
		reasons.push("Matches your comfort preferences");
	}

	return reasons;
}
