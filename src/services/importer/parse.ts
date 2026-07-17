/** A single row as read straight from a CSV file or coerced from a JSON record, before any interpretation. */
export type RawImportRow = Record<string, string>;

/** Detects whether raw file content is JSON or CSV based on its leading non-whitespace character. */
export function detectFormat(content: string): "json" | "csv" {
	const trimmed = content.trimStart();
	return trimmed.startsWith("[") || trimmed.startsWith("{") ? "json" : "csv";
}

/**
 * Minimal quote-aware CSV parser — handles quoted fields containing commas
 * and escaped double-quotes ("") without pulling in an external dependency.
 * Not a full RFC 4180 implementation, but covers the exports we expect
 * (TV Time, Trakt, Letterboxd-style CSVs).
 */
export function parseCSV(content: string): RawImportRow[] {
	const rows = splitCSVRows(content);
	if (rows.length === 0) return [];

	const headers = rows[0].map((h) => h.trim());
	return rows.slice(1).map((row) => {
		const record: RawImportRow = {};
		headers.forEach((header, i) => {
			record[header] = (row[i] ?? "").trim();
		});
		return record;
	});
}

function splitCSVRows(content: string): string[][] {
	const rows: string[][] = [];
	let field = "";
	let row: string[] = [];
	let inQuotes = false;

	for (let i = 0; i < content.length; i++) {
		const char = content[i];
		const next = content[i + 1];

		if (inQuotes) {
			if (char === '"' && next === '"') {
				field += '"';
				i++;
			} else if (char === '"') {
				inQuotes = false;
			} else {
				field += char;
			}
			continue;
		}

		if (char === '"') {
			inQuotes = true;
		} else if (char === ",") {
			row.push(field);
			field = "";
		} else if (char === "\n" || char === "\r") {
			// Handle \r\n by skipping the paired \n
			if (char === "\r" && next === "\n") continue;
			row.push(field);
			field = "";
			if (row.some((f) => f.length > 0) || row.length > 1) {
				rows.push(row);
			}
			row = [];
		} else {
			field += char;
		}
	}

	// Final field/row if the file doesn't end with a newline
	if (field.length > 0 || row.length > 0) {
		row.push(field);
		rows.push(row);
	}

	return rows;
}

/**
 * Parses JSON input into raw rows. Accepts a flat array of objects, or an
 * object with "movies"/"episodes"/"shows"/"history" array properties (any
 * combination), flattening them all into one row list.
 */
export function parseJSON(content: string): unknown {
	const data = JSON.parse(content);

	if (Array.isArray(data)) {
		return data;
	}

	if (data && typeof data === "object") {
		const knownKeys = ["movies", "episodes", "shows", "history", "watched"];
		const rows: unknown[] = [];
		for (const key of knownKeys) {
			const value = (data as Record<string, unknown>)[key];
			if (Array.isArray(value)) {
				rows.push(...value);
			}
		}
		if (rows.length > 0) return rows;

		// A single bare object (TV Time's real per-file movie/series export shape) — not a
		// wrapper, not an array. Treat it as one record rather than rejecting it.
		return data;
	}

	throw new Error("Unrecognized JSON structure — expected an array of records, a single record object, or a {movies, episodes, ...} wrapper object.");
}

export function parseImportFile(content: string): unknown {
	const format = detectFormat(content);
	return format === "json" ? parseJSON(content) : parseCSV(content);
}
