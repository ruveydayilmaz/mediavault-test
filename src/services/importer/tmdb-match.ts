import type { TMDBService } from "../../api/tmdb";
import { TMDBSearchResult } from "../../types/tmdb";
import { normalizeTitle, stripSubtitle, titleSimilarity } from "./normalize";

export interface TitleLookup {
  kind: "movie" | "tv";
  title: string;
  year: number | null;
  originalTitle?: string | null;
  releaseDate?: string | null;
  runtimeSeconds?: number | null;
  country?: string | null;
  language?: string | null;
}

export type MatchTier = "exact" | "year" | "fuzzy" | "unmatched";

export interface MatchResult {
  candidate: TMDBSearchResult | null;
  tier: MatchTier;
  score: number;
  rejected: TMDBSearchResult[];
  queriesTried: string[];
}

const STAR_TIERS: Record<MatchTier, string> = {
  exact: "★★★★★",
  year: "★★★★☆",
  fuzzy: "★★★☆☆",
  unmatched: "☆☆☆☆☆",
};

export function tierStars(tier: MatchTier): string {
  return STAR_TIERS[tier];
}

function scoreCandidate(
  lookup: TitleLookup,
  candidate: TMDBSearchResult,
  comparisonTitles: string[],
): number {
  let titleSim = 0;
  for (const t of comparisonTitles) {
    titleSim = Math.max(
      titleSim,
      titleSimilarity(t, candidate.title),
      candidate.originalTitle ? titleSimilarity(t, candidate.originalTitle) : 0,
    );
  }

  let yearScore = 0.5;
  if (lookup.year !== null) {
    if (candidate.year === null) {
      yearScore = 0.4;
    } else {
      const diff = Math.abs(lookup.year - candidate.year);
      yearScore = diff === 0 ? 1 : diff === 1 ? 0.7 : diff <= 3 ? 0.3 : 0;
    }
  }

  let regionScore = 0.5;
  let regionWeight = 0;
  if (lookup.country) {
    regionWeight = 0.15;
    regionScore = candidate.country
      ? candidate.country.toUpperCase() === lookup.country.toUpperCase()
        ? 1
        : 0.15
      : 0.5;
  } else if (lookup.language) {
    regionWeight = 0.1;
    regionScore = candidate.language
      ? candidate.language.toLowerCase() === lookup.language.toLowerCase()
        ? 1
        : 0.2
      : 0.5;
  }

  const titleWeight = 0.75 - regionWeight * 0.5;
  const yearWeight = 0.25 - regionWeight * 0.5;
  return (
    titleSim * titleWeight + yearScore * yearWeight + regionScore * regionWeight
  );
}

async function gatherCandidates(
  tmdb: TMDBService,
  lookup: TitleLookup,
): Promise<{
  candidates: TMDBSearchResult[];
  queriesTried: string[];
  comparisonTitles: string[];
}> {
  const searchFn =
    lookup.kind === "movie"
      ? tmdb.searchMovies.bind(tmdb)
      : tmdb.searchShows.bind(tmdb);
  const tried = new Set<string>();
  const queriesTried: string[] = [];
  const pool = new Map<number, TMDBSearchResult>();

  async function tryQuery(query: string, year: number | null): Promise<void> {
    const trimmed = query.trim();
    const dedupeKey = `${trimmed.toLowerCase()}::${year ?? ""}`;
    if (!trimmed || tried.has(dedupeKey)) return;
    tried.add(dedupeKey);
    queriesTried.push(year !== null ? `${trimmed} (${year})` : trimmed);

    try {
      const result = await searchFn(trimmed, 1, year);
      for (const item of result.items) pool.set(item.tmdbId, item);
    } catch {
      // network hiccup, rate limit, etc
    }
  }

  async function tryQueryPair(query: string): Promise<void> {
    await Promise.all([
      lookup.year !== null ? tryQuery(query, lookup.year) : Promise.resolve(),
      tryQuery(query, null),
    ]);
  }

  const normalized = normalizeTitle(lookup.title);
  const stripped = stripSubtitle(lookup.title);
  const originalTitle = lookup.originalTitle?.trim() ?? "";
  const comparisonTitles = [
    lookup.title,
    normalized,
    ...(stripped ? [stripped] : []),
    ...(originalTitle ? [originalTitle] : []),
  ];

  function alreadyConfident(): boolean {
    if (pool.size !== 1) return false;
    const [only] = pool.values();
    const norm = normalizeTitle(only.title);
    const normOriginal = only.originalTitle
      ? normalizeTitle(only.originalTitle)
      : null;
    const titleOk = comparisonTitles.some(
      (t) => normalizeTitle(t) === norm || normalizeTitle(t) === normOriginal,
    );
    const yearOk =
      lookup.year === null || only.year === null || only.year === lookup.year;
    return titleOk && yearOk;
  }

  await tryQueryPair(lookup.title);
  if (!alreadyConfident() && normalized !== lookup.title.trim().toLowerCase()) {
    await tryQueryPair(normalized);
  }

  if (stripped && !alreadyConfident()) {
    await tryQueryPair(stripped);
  }

  if (originalTitle && !alreadyConfident()) {
    await tryQueryPair(originalTitle);
  }

  return { candidates: [...pool.values()], queriesTried, comparisonTitles };
}

export async function findBestMatch(
  tmdb: TMDBService,
  lookup: TitleLookup,
): Promise<MatchResult> {
  const { candidates, queriesTried, comparisonTitles } = await gatherCandidates(
    tmdb,
    lookup,
  );

  if (candidates.length === 0) {
    return {
      candidate: null,
      tier: "unmatched",
      score: 0,
      rejected: [],
      queriesTried,
    };
  }

  const ranked = candidates
    .map((c) => ({
      candidate: c,
      score: scoreCandidate(lookup, c, comparisonTitles),
    }))
    .sort((a, b) => b.score - a.score);

  const [best, ...rest] = ranked;
  const rejected = rest.map((r) => r.candidate);

  const normComparisons = comparisonTitles.map(normalizeTitle);
  const normCandidateTitles = [
    normalizeTitle(best.candidate.title),
    ...(best.candidate.originalTitle
      ? [normalizeTitle(best.candidate.originalTitle)]
      : []),
  ];
  const exactTitle = normCandidateTitles.some((ct) =>
    normComparisons.includes(ct),
  );
  const yearMatches =
    lookup.year === null ||
    best.candidate.year === null ||
    best.candidate.year === lookup.year;

  let tier: MatchTier;
  if (exactTitle && yearMatches) {
    tier = "exact";
  } else if (exactTitle || best.score >= 0.75) {
    tier = "year";
  } else if (best.score >= 0.55) {
    tier = "fuzzy";
  } else {
    return {
      candidate: null,
      tier: "unmatched",
      score: best.score,
      rejected: ranked.map((r) => r.candidate),
      queriesTried,
    };
  }

  return {
    candidate: best.candidate,
    tier,
    score: best.score,
    rejected,
    queriesTried,
  };
}
