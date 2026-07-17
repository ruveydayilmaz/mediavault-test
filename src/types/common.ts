/**
 * Common primitive/shared types used across MediaVault's data models.
 */

/** Internal MediaVault ID (uuid-style string), distinct from external API ids. */
export type MediaVaultId = string;

/** ISO 8601 date string, e.g. "2026-07-02" or "2026-07-02T14:30:00Z" */
export type ISODateString = string;

export interface CastMember {
	tmdbPersonId: number;
	name: string;
	character: string;
	profilePath: string | null;
	order: number;
}

export interface CrewMember {
	tmdbPersonId: number;
	name: string;
	job: string; // e.g. "Director", "Writer", "Creator"
	department: string;
	profilePath: string | null;
}

export interface ProductionCompany {
	tmdbCompanyId: number;
	name: string;
	logoPath: string | null;
	originCountry: string | null;
}

/** A 1-10 scored attribute. Kept as a distinct type so it's easy to validate/clamp. */
export type Score1to10 = number;

/** Generic result wrapper for paginated/service responses. */
export interface PagedResult<T> {
	items: T[];
	total: number;
	page: number;
	pageSize: number;
}
