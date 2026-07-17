import { MediaVaultId, ISODateString, Score1to10 } from "../types/common";
import { Season, TriggerWarning } from "../types/enums";

/**
 * Mood/comfort metadata for a MediaItem. Optional and edited independently
 * of core library metadata. This is what powers the Comfort Finder
 * (Milestone 14) and feeds into the recommendation engine's comfortMatch
 * term (Milestone 15).
 */
export interface ComfortProfile {
	id: MediaVaultId;
	mediaId: MediaVaultId;

	comfortScore: Score1to10;
	energyLevel: Score1to10;
	attentionLevel: Score1to10;
	emotionalHeaviness: Score1to10;
	plotComplexity: Score1to10;
	rewatchability: Score1to10;

	flags: ComfortFlags;

	seasonalTags: Season[];
	triggerWarnings: TriggerWarning[];

	updatedAt: ISODateString;
}

/**
 * Boolean flags used for fast filtering in the Comfort Finder.
 * Kept as a flat object (rather than a string[] of tags) so filtering is a
 * simple property check rather than an array-includes scan.
 */
export interface ComfortFlags {
	safeWhenAnxious: boolean;
	safeWhenDepressed: boolean;
	goodForBackgroundNoise: boolean;
	goodWhileCleaning: boolean;
	goodBeforeSleep: boolean;
	cozy: boolean;
	funny: boolean;
	noMajorCharacterDeath: boolean;
	lowConflict: boolean;
	familiarFavorite: boolean;
}

export const DEFAULT_COMFORT_FLAGS: ComfortFlags = {
	safeWhenAnxious: false,
	safeWhenDepressed: false,
	goodForBackgroundNoise: false,
	goodWhileCleaning: false,
	goodBeforeSleep: false,
	cozy: false,
	funny: false,
	noMajorCharacterDeath: false,
	lowConflict: false,
	familiarFavorite: false,
};

/**
 * A saved filter preset for the Comfort Finder, e.g. "bedtime",
 * "background noise", "emotional recovery", "cozy winter".
 */
export interface ComfortPreset {
	id: MediaVaultId;
	name: string;
	description: string | null;

	/** Range filters; omit a bound to leave it unconstrained. */
	energyMin?: Score1to10;
	energyMax?: Score1to10;
	attentionMin?: Score1to10;
	attentionMax?: Score1to10;
	emotionalHeavinessMax?: Score1to10;
	comfortScoreMin?: Score1to10;
	rewatchabilityMin?: Score1to10;

	requiredFlags: (keyof ComfortFlags)[];
	excludedTriggers: TriggerWarning[];
	seasonalTags: Season[];

	isBuiltIn: boolean;
}

/** A single scored result from a Comfort Finder query. */
export interface ComfortMatch {
	mediaId: MediaVaultId;
	score: number; // weighted ranking score, higher = better match
	matchedFlags: (keyof ComfortFlags)[];
}
