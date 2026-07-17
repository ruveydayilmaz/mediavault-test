import { MediaItem } from "../../models/media";
import { WatchSession } from "../../models/review";
import { AffinityProfile } from "./types";

/**
 * Builds a taste profile from the user's rated watch history: for every
 * rated session, its media's genres/cast/director are credited with a
 * weight proportional to the rating (a 10/10 watch counts far more toward
 * "you like this genre" than a 4/10 one). Everything is then normalized to
 * 0-1 by dividing by the maximum accumulated weight in each category, so
 * scores are comparable across genre/actor/director regardless of how many
 * distinct values exist in each.
 *
 * Ratings are read as whatever raw scale the user has configured; since we
 * only use them for *relative* weighting within this profile (not as an
 * absolute score), no scale conversion is needed — a 9 on a 10-point scale
 * and a 90 on a 100-point scale both correctly outweigh a lower rating on
 * the same scale.
 */
export function buildAffinityProfile(media: MediaItem[], sessions: WatchSession[]): AffinityProfile {
	const mediaById = new Map(media.map((m) => [m.id, m]));

	const genreWeights = new Map<string, number>();
	const actorWeights = new Map<string, number>();
	const directorWeights = new Map<string, number>();

	for (const session of sessions) {
		if (session.rating === null || session.rating <= 0) continue;
		const item = mediaById.get(session.mediaId);
		if (!item) continue;

		const weight = session.rating;

		for (const genre of item.genres) {
			genreWeights.set(genre, (genreWeights.get(genre) ?? 0) + weight);
		}

		// Only weight top-billed cast — a rating shouldn't credit someone billed 40th.
		for (const cast of item.cast.slice(0, 5)) {
			actorWeights.set(cast.name, (actorWeights.get(cast.name) ?? 0) + weight);
		}

		for (const crew of item.crew) {
			if (crew.job !== "Director" && crew.job !== "Creator") continue;
			directorWeights.set(crew.name, (directorWeights.get(crew.name) ?? 0) + weight);
		}
	}

	return {
		genre: normalize(genreWeights),
		actor: normalize(actorWeights),
		director: normalize(directorWeights),
	};
}

function normalize(weights: Map<string, number>): Map<string, number> {
	const max = Math.max(0, ...weights.values());
	if (max === 0) return new Map();
	const normalized = new Map<string, number>();
	for (const [key, value] of weights.entries()) {
		normalized.set(key, value / max);
	}
	return normalized;
}
