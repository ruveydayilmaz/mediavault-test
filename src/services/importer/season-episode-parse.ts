/**
 * Some TV Time exports (and other import sources) fold season/episode
 * information straight into a single title string rather than separate
 * columns — "Breaking Bad S01E05", "Breaking Bad - Season 1", "1x03 Breaking
 * Bad". Searching TMDB for that whole string almost never matches anything,
 * since no show is literally titled "Breaking Bad S01E05". Stripping the
 * marker out both gives the matcher a clean, searchable base title *and*
 * recovers season/episode numbers a dedicated column might not have
 * provided.
 */
export interface ParsedSeasonEpisode {
	baseTitle: string;
	season: number | null;
	episode: number | null;
}

interface Pattern {
	regex: RegExp;
	extract: (m: RegExpMatchArray) => { season: number | null; episode: number | null };
}

const PATTERNS: Pattern[] = [
	// "S01E05", "S1E5", "S01 E05"
	{
		regex: /\bS(\d{1,2})\s?E(\d{1,3})\b/i,
		extract: (m) => ({ season: parseInt(m[1], 10), episode: parseInt(m[2], 10) }),
	},
	// "1x03", "12x3"
	{
		regex: /\b(\d{1,2})x(\d{1,3})\b/i,
		extract: (m) => ({ season: parseInt(m[1], 10), episode: parseInt(m[2], 10) }),
	},
	// "Season 1 Episode 3", "Season 01, Episode 003"
	{
		regex: /\bSeason\s?(\d{1,2}),?\s+Episode\s?(\d{1,3})\b/i,
		extract: (m) => ({ season: parseInt(m[1], 10), episode: parseInt(m[2], 10) }),
	},
	// "S01" alone (no episode)
	{
		regex: /\bS(\d{1,2})\b/i,
		extract: (m) => ({ season: parseInt(m[1], 10), episode: null }),
	},
	// "Season 1", "Season 01" alone
	{
		regex: /\bSeason\s?(\d{1,2})\b/i,
		extract: (m) => ({ season: parseInt(m[1], 10), episode: null }),
	},
];

/**
 * Strips the first recognized season/episode marker out of `rawTitle` and
 * returns the cleaned base title alongside whatever season/episode numbers
 * were found. Returns null if no marker is present at all — callers should
 * treat that as "nothing to parse," not "season 0."
 */
export function parseSeasonEpisodeFromTitle(rawTitle: string): ParsedSeasonEpisode | null {
	for (const pattern of PATTERNS) {
		const match = rawTitle.match(pattern.regex);
		if (!match) continue;

		const { season, episode } = pattern.extract(match);
		const baseTitle = (rawTitle.slice(0, match.index) + rawTitle.slice((match.index ?? 0) + match[0].length))
			// leftover separators/dashes where the marker used to sit (e.g. "Breaking Bad - " -> "Breaking Bad")
			.replace(/[-–—:]\s*$/, "")
			.replace(/\s+/g, " ")
			.trim();

		if (!baseTitle) continue; // the whole string was just the marker — nothing usable to search with

		return { baseTitle, season, episode };
	}

	return null;
}
