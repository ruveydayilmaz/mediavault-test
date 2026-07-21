/**
 * Parses Go's `fmt.Sprintf("%v", map)` serialization format used in
 * TV Time's GDPR `lists-prod-lists.csv`.
 *
 * The `objects` column contains data like:
 * ```
 * [map[created_at:1.767036007e+09 id:262954 type:series uuid:51ab9d04-...] map[...]]
 * ```
 *
 * Each `map[...]` block holds space-separated `key:value` pairs. Values never
 * contain spaces for the keys we care about (type, uuid, id, created_at), so
 * splitting on whitespace inside a single map is safe.
 */

/** A single parsed item from a Go map list entry. */
export interface GoMapListItem {
	type: string | null;
	uuid: string | null;
	/** TV Time's numeric series/movie id — may be absent for movies. */
	tvTimeId: string | null;
	/** ISO date parsed from the epoch float in `created_at`. */
	createdAt: string | null;
}

/**
 * Converts a Unix epoch (possibly in scientific notation, e.g. `1.767036007e+09`)
 * to an ISO date string (YYYY-MM-DD). Returns null for non-finite values.
 */
function epochToISODate(raw: string): string | null {
	const seconds = Number(raw);
	if (!Number.isFinite(seconds) || seconds <= 0) return null;
	return new Date(seconds * 1000).toISOString().slice(0, 10);
}

/**
 * Parses a single `map[key:value key:value ...]` block into a plain
 * key→value record. The key is everything before the first colon on each
 * space-separated token; the value is everything after it.
 */
function parseGoMap(block: string): Record<string, string> {
	const result: Record<string, string> = {};
	const tokens = block.trim().split(/\s+/);
	for (const token of tokens) {
		const colonIdx = token.indexOf(":");
		if (colonIdx <= 0) continue; // skip tokens without a valid key
		const key = token.slice(0, colonIdx);
		const value = token.slice(colonIdx + 1);
		result[key] = value;
	}
	return result;
}

/** Parses Go's `map[key:value ...]` serialization from TV Time's GDPR list export. */
export function parseGoMapArray(raw: string): GoMapListItem[] {
	const trimmed = raw.trim();
	if (!trimmed || trimmed === "[]") return [];

	// Strip the outer brackets: "[map[...] map[...]]" → "map[...] map[...]"
	const inner = trimmed.startsWith("[") && trimmed.endsWith("]")
		? trimmed.slice(1, -1).trim()
		: trimmed;

	if (!inner) return [];

	// Split on "map[" boundaries. The first element is empty (text before the
	// first "map["), so we drop it. Each remaining element ends with "]" and
	// possibly trailing whitespace.
	const chunks = inner.split("map[");
	const items: GoMapListItem[] = [];

	for (const chunk of chunks) {
		const cleaned = chunk.trim();
		if (!cleaned) continue;

		// Strip trailing "]"
		const body = cleaned.endsWith("]") ? cleaned.slice(0, -1) : cleaned;
		if (!body.trim()) continue;

		const fields = parseGoMap(body);

		items.push({
			type: fields["type"] || null,
			uuid: fields["uuid"] || null,
			tvTimeId: fields["id"] || null,
			createdAt: fields["created_at"] ? epochToISODate(fields["created_at"]) : null,
		});
	}

	return items;
}
