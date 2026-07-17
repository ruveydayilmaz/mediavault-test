/**
 * Best-effort parse of a date string into an ISO date (YYYY-MM-DD). Returns
 * null if unparseable. Shared by the tvtime/* importer modules — kept here
 * rather than duplicated since it's genuinely just a date-parsing utility,
 * not tied to any particular import category's shape.
 */
export function parseFlexibleDate(raw: string | null): string | null {
	if (!raw) return null;
	const parsed = new Date(raw);
	if (isNaN(parsed.getTime())) return null;
	return parsed.toISOString().slice(0, 10);
}

