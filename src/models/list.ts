import { MediaVaultId, ISODateString } from "../types/common";

/**
 * How a list's media should be ordered for display. "manual" respects the
 * literal order of `mediaIds` (drag-and-drop reordering writes directly to
 * that array); the others are computed sorts applied at render time and
 * never mutate `mediaIds` itself.
 */
export type ListSortMode = "manual" | "recent" | "title" | "dateAdded" | "rating" | "year";

/**
 * A user-created collection of media (roadmap Milestone 5), e.g. "Best
 * Horror" or "Cozy Anime". Kept as a thin, ordered list of `mediaId`
 * references rather than embedded media data — same flat-storage,
 * reference-by-id pattern as everything else, so a metadata refresh or
 * poster change never has anything to reconcile here.
 *
 * The banner (first four posters) is deliberately NOT stored — it's
 * derived at render time from `mediaIds` + the media repository, so it can
 * never go stale relative to the list's actual contents or the media's
 * current poster.
 */
export interface CustomList {
	id: MediaVaultId;

	title: string;
	description: string | null;

	/** Ordered references into the media repository. Order is authoritative when sortMode is "manual". */
	mediaIds: MediaVaultId[];

	sortMode: ListSortMode;

	/**
	 * Display name of who created/owns this list. Always null today —
	 * MediaVault has no concept of other users yet — but shown in the
	 * TV Time-style card/header ("Owner (future-proof)" per the roadmap
	 * spec) as "You" so the field and its UI slot already exist for
	 * whenever shared/synced lists become a thing.
	 */
	owner: string | null;

	/** True for lists created by an importer (e.g. a TV Time custom list) rather than by the user directly. */
	isImported: boolean;
	/** Provenance label for imported lists, e.g. "TV Time: Cozy Anime". Null for user-created lists. */
	importSource: string | null;

	createdAt: ISODateString;
	updatedAt: ISODateString;
}

/** Fields required to create a new CustomList before defaults are applied. */
export type NewCustomListInput = Pick<CustomList, "title"> &
	Partial<Omit<CustomList, "id" | "title" | "createdAt" | "updatedAt">>;
