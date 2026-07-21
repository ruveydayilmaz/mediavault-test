import JSZip from "jszip";
import { runImport } from "./manager";
import { DetectionResult, ImportCategory, NormalizedImportBundle, emptyBundle, mergeBundles } from "./types";
import { parseGdprArchive } from "./gdpr";

/**
 * Per-file column renames applied before handoff to the normal detection
 * pipeline — only for TV Time's real GDPR export filenames that are
 * genuinely per-episode watch logs, but whose date column ("created_at")
 * isn't one of `WATCHED_DATE_ALIASES`. That alias list deliberately does
 * NOT include a bare "created_at", because several *other* real GDPR files
 * (`episode_emotion.csv`, `show_character_episode_vote.csv`) share the
 * exact same season+episode+created_at shape without being watch events at
 * all — loosening the alias globally would silently import those as watch
 * history. Renaming only these two known-good files' column to
 * `watched_at` (already a recognized alias) gets the real signal in
 * without that false-positive risk, and still runs through the exact same
 * `CsvWatchedEpisodesImporter.parse()` as every other watched-episode CSV.
 */
const FILENAME_COLUMN_RENAMES: Record<string, Record<string, string>> = {
	"seen_episode_latest.csv": { created_at: "watched_at" },
	"rewatched_episode.csv": { created_at: "watched_at" },
};

/** Renames columns in a CSV's header line only — the row data is left byte-identical, so this never risks mis-parsing quoted fields. */
function renameCsvHeaderColumns(content: string, renames: Record<string, string>): string {
	const nlIndex = content.indexOf("\n");
	const headerLine = nlIndex === -1 ? content : content.slice(0, nlIndex);
	const restContent = nlIndex === -1 ? "" : content.slice(nlIndex + 1);
	const hasTrailingCR = headerLine.endsWith("\r");
	const cleanHeader = hasTrailingCR ? headerLine.slice(0, -1) : headerLine;

	const renamedHeader = cleanHeader
		.split(",")
		.map((h) => renames[h.trim()] ?? h)
		.join(",");

	return renamedHeader + (hasTrailingCR ? "\r" : "") + (nlIndex === -1 ? "" : "\n" + restContent);
}

export interface ZipFileResult {
	filename: string;
	detection: DetectionResult;
	rowCount: number;
	unsupported: boolean;
}

export interface ZipImportResult {
	bundle: NormalizedImportBundle;
	files: ZipFileResult[];
	supportedCount: number;
	unsupportedCount: number;
}

/** Files TV Time's GDPR export includes that are never user-facing import data under any current category (translation metadata, internal usage telemetry, recommendation-engine state) — skipped up front rather than run through detection and reported as "unsupported", since that phrasing implies a gap MediaVault might one day close, and these never will be. */
const KNOWN_NON_IMPORTABLE = new Set([
	"comment_translation.csv",
	"tracking-deployment-prod-tracks.csv",
	"tracking-prod-count-by-timeframe.csv",
	"recommendations-prod-user-scores.csv",
	"recommendations-prod-user-shows.csv",
	"episode_comment_like.csv",
	"followed_tv_show_source.csv",
	"show_character_episode_vote.csv",
	"emotions-3-prod-episode_votes.csv",
	"emotions-live-votes.csv",
	"emotions-v2-prod-votes.csv",
	"episode_emotion.csv",
	"users-customization-prod-data.csv",
]);

/**
 * These need cross-file context (series id lookup, deduplication across
 * sources, or non-standard serialization), so they are routed through
 * `parseGdprArchive()` rather than the generic per-file detection pipeline.
 */
const GDPR_RELATIONAL_FILES = new Set([
	// Watch history
	"tracking-prod-records-v2.csv",
	"tracking-prod-records.csv",
	"rewatched_episode.csv",
	"show_seen_episode_latest.csv",
	"seen_episode_latest.csv",
	// Ratings / reactions
	"ratings-3-prod-episode_votes.csv",
	"ratings-v2-prod-votes.csv",
	"ratings-prod-episode_votes.csv",
	"ratings-live-votes.csv",
	// Comments / reviews
	"comments-prod-comments.csv",
	"episode_comment.csv",
	"show_comment.csv",
	// Status / favorites
	"user_show_special_status.csv",
	"user_tv_show_data.csv",
	// Custom lists (Go map format)
	"lists-prod-lists.csv",
]);

function basename(path: string): string {
	const parts = path.split("/");
	return parts[parts.length - 1];
}

/**
 * Extracts and imports a complete TV Time GDPR export archive. Every
 * `.csv`/`.json` entry is run through the exact same `runImport()` used for
 * a single manually-selected file — nothing here duplicates CSV/JSON
 * parsing or category-detection logic. Corrupted archives, unreadable
 * entries, and individually-unparseable files are caught per-file so one
 * bad entry never aborts the whole import; everything else that *can* be
 * read is still imported.
 */
export async function runZipImport(
	zipData: ArrayBuffer,
	onProgress?: (done: number, total: number) => void
): Promise<ZipImportResult> {
	let zip: JSZip;
	try {
		zip = await JSZip.loadAsync(zipData);
	} catch (err) {
		throw new Error(`Couldn't open this ZIP file — it may be corrupted. (${(err as Error).message})`);
	}

	const entries = Object.values(zip.files).filter(
		(entry) => !entry.dir && /\.(csv|json)$/i.test(entry.name)
	);

	const bundles: NormalizedImportBundle[] = [];
	const files: ZipFileResult[] = [];
	let done = 0;

	const contents = new Map<string, string>();
	for (const entry of entries) {
		const name = basename(entry.name);

		if (KNOWN_NON_IMPORTABLE.has(name.toLowerCase())) {
			done++;
			onProgress?.(done, entries.length);
			continue;
		}

		try {
			let content = await entry.async("text");
			contents.set(name.toLowerCase(), content);

			if (GDPR_RELATIONAL_FILES.has(name.toLowerCase())) {
				files.push({
					filename: name,
					detection: { format: "csv", category: "unknown", label: "TV Time GDPR data" },
					rowCount: 0,
					unsupported: false,
				});
				done++;
				onProgress?.(done, entries.length);
				continue;
			}

			const renames = FILENAME_COLUMN_RENAMES[name.toLowerCase()];
			if (renames && !/\.json$/i.test(name)) {
				content = renameCsvHeaderColumns(content, renames);
			}

			const result = runImport(content);
			bundles.push(result.bundle);
			files.push({
				filename: name,
				detection: result.detection,
				rowCount:
					result.bundle.watches.length +
					result.bundle.reviews.length +
					result.bundle.likes.length +
					result.bundle.ratings.length +
					result.bundle.favorites.length +
					result.bundle.lists.length,
				unsupported: result.unsupported,
			});
		} catch (err) {
			files.push({
				filename: name,
				detection: { format: "csv", category: "unknown", label: `Couldn't read this file (${(err as Error).message})` },
				rowCount: 0,
				unsupported: true,
			});
		}

		done++;
		onProgress?.(done, entries.length);
	}

	// Replace generic per-file interpretation with the archive-aware parser
	// for TV Time's relational tracking tables. Generic detection cannot infer
	// that these are watch logs from one file in isolation.
	const gdprBundles = parseGdprArchive(contents);
	for (const [filename, bundle] of gdprBundles) {
		const file = files.find((f) => f.filename.toLowerCase() === filename);
		if (file) {
			file.detection = { format: "csv", category: gdprCategory(filename), label: gdprLabel(filename) };
			file.rowCount = bundle.watches.length + bundle.reviews.length + bundle.ratings.length + bundle.favorites.length + bundle.lists.length;
			file.unsupported = false;
		}
		bundles.push(bundle);
	}

	const bundle = bundles.length > 0 ? mergeBundles(bundles) : emptyBundle();
	const supportedCount = files.filter((f) => !f.unsupported).length;

	return {
		bundle,
		files,
		supportedCount,
		unsupportedCount: files.length - supportedCount,
	};
}

/** Maps a GDPR archive filename to the appropriate ImportCategory. */
function gdprCategory(filename: string): ImportCategory {
	if (filename.includes("tracking") || filename.includes("rewatched") || filename.includes("seen_episode") || filename.includes("special_status")) return "csv_watched_episodes";
	if (filename.includes("ratings")) return "csv_ratings";
	if (filename.includes("comment")) return "csv_comments";
	if (filename.includes("lists")) return "json_list";
	if (filename.includes("user_tv_show_data")) return "csv_favorites";
	return "unknown";
}

/** Human-readable label for GDPR archive files shown in the import preview. */
function gdprLabel(filename: string): string {
	if (filename.includes("tracking-prod-records")) return "TV Time Tracking History";
	if (filename.includes("rewatched")) return "TV Time Rewatched Episodes";
	if (filename.includes("seen_episode")) return "TV Time Episode Progress";
	if (filename.includes("ratings")) return "TV Time Reactions";
	if (filename.includes("comments-prod")) return "TV Time Comments";
	if (filename.includes("episode_comment")) return "TV Time Episode Comments";
	if (filename.includes("show_comment")) return "TV Time Show Comments";
	if (filename.includes("special_status")) return "TV Time Watch Later / Favorites";
	if (filename.includes("user_tv_show_data")) return "TV Time Show Favorites";
	if (filename.includes("lists")) return "TV Time Custom Lists";
	return "TV Time GDPR Data";
}
