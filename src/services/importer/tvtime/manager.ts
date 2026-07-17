import { parseImportFile, detectFormat, parseCSV, parseJSON } from "../parse";
import { TVTimeImporter, DetectionResult, NormalizedImportBundle, emptyBundle } from "./types";
import { JsonSeriesImporter } from "./json-series";
import { JsonMovieImporter } from "./json-movie";
import { JsonListImporter } from "./json-list";
import { CsvFollowedShowsImporter } from "./csv-followed-shows";
import {
	CsvCommentsImporter,
	CsvLikesImporter,
	CsvRatingsImporter,
	CsvFavoritesImporter,
	CsvWatchedEpisodesImporter,
	CsvWatchedMoviesImporter,
} from "./csv-generic";

/**
 * Registered in priority order — first matching detector wins. Ordered
 * most-specific-signature first (e.g. the exact "followed shows" column
 * set, or a comment column) down to the broadest fallback (a bare
 * title+date CSV, treated as movie watch history). Adding support for a
 * new TV Time export is exactly one line here plus one new module
 * implementing TVTimeImporter — nothing else in the plugin changes.
 */
const IMPORTERS: TVTimeImporter[] = [
	JsonSeriesImporter,
	JsonMovieImporter,
	JsonListImporter,
	CsvFollowedShowsImporter,
	CsvCommentsImporter,
	CsvLikesImporter,
	CsvRatingsImporter,
	CsvFavoritesImporter,
	CsvWatchedEpisodesImporter,
	CsvWatchedMoviesImporter,
];

export interface ImportManagerResult {
	detection: DetectionResult;
	bundle: NormalizedImportBundle;
	/** True only when the file's format/category couldn't be recognized at all. */
	unsupported: boolean;
}

/**
 * Detects the file's format + export category, then runs the matching
 * importer. This is the ONLY entry point the UI should call — it never
 * needs to know about individual importer modules.
 */
export function runImport(fileContent: string): ImportManagerResult {
	const format = detectFormat(fileContent);
	const parsed: unknown = format === "json" ? parseJSON(fileContent) : parseCSV(fileContent);

	for (const importer of IMPORTERS) {
		if (importer.detect(parsed, format)) {
			const bundle = importer.parse(parsed);
			return {
				detection: { format, category: importer.category, label: importer.label },
				bundle,
				unsupported: false,
			};
		}
	}

	return {
		detection: { format, category: "unknown", label: "Unrecognized format" },
		bundle: emptyBundle(),
		unsupported: true,
	};
}

/** Re-exported for callers that already have parsed rows/JSON (e.g. tests) and want to skip re-parsing the raw string. */
export { parseImportFile };
