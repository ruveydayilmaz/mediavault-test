import { MediaItem } from "../../models/media";
import { ComfortProfile } from "../../models/comfort";
import { FrontmatterData, serializeFrontmatter } from "./frontmatter";
import { MediaType } from "../../types/enums";
import { NoteTemplateSettings } from "../../settings/settings";
import { CREW_ROLE_JOBS, tmdbImageUrl } from "../../api/tmdb-normalize";

const REQUIRED_FRONTMATTER_KEYS = ["type", "title", "year", "tmdb_id"];
const COMFORT_FRONTMATTER_KEYS = [
  "comfort_score",
  "energy_level",
  "attention_required",
];

function crewNames(media: MediaItem, jobs: readonly string[]): string[] {
  const jobSet = new Set(jobs);
  const names = new Set<string>();
  media.crew
    .filter((c) => jobSet.has(c.job))
    .forEach((c) => names.add(c.name));
  return [...names];
}

/**
 * Builds the MediaVault-managed frontmatter data for a newly generated
 * (or regenerated) note. This only produces the properties MediaVault owns —
 * required identifiers plus whichever optional properties are enabled in the
 * user's note-template settings. Any additional frontmatter properties the
 * user has manually added to an existing note are merged in separately by
 * the note generator and are never touched here.
 */
export function buildMediaFrontmatterData(
  media: MediaItem,
  comfort: ComfortProfile | null,
  template: NoteTemplateSettings,
): FrontmatterData {
  // Required / MediaVault-managed properties: always present, never
  // removable via the template settings, since MediaVault uses these to
  // identify and (re)locate the note for a given media item.
  const data: FrontmatterData = {
    type: media.type === MediaType.Movie ? "movie" : "tv",
    title: media.title,
    year: media.year,
    tmdb_id: media.tmdbId,
  };

  const opt = template.optionalProperties;

  if (opt.genres) data.genres = media.genres;
  if (opt.status) data.status = media.status;
  if (opt.rating_avg) data.rating_avg = media.averageRating;
  if (opt.watch_count) data.watch_count = media.watchCount;
  if (opt.synopsis) data.synopsis = media.synopsis;
  if (opt.platform) data.platform = media.platform;
  if (opt.release_date) data.release_date = media.releaseDate;
  if (opt.runtime) data.runtime = media.runtime;
  if (opt.country) data.country = media.country;
  if (opt.language) data.language = media.language;
  if (opt.studios) {
    data.studios = media.productionCompanies.map((p) => p.name);
  }
  if (opt.cast) {
    data.cast = media.cast.slice(0, 10).map((c) => c.name);
  }
  if (opt.director) {
    data.director = crewNames(media, CREW_ROLE_JOBS.Director);
  }
  if (opt.producer) {
    data.producer = crewNames(media, CREW_ROLE_JOBS.Producer);
  }
  if (opt.poster) data.poster = tmdbImageUrl(media.posterPath, "w500");
  if (opt.backdrop)
    data.backdrop = tmdbImageUrl(media.backdropPath, "original");
  if (opt.tmdb_url) {
    const kind = media.type === MediaType.Movie ? "movie" : "tv";
    data.tmdb_url = `https://www.themoviedb.org/${kind}/${media.tmdbId}`;
  }

  if (comfort) {
    data.comfort_score = comfort.comfortScore;
    data.energy_level = comfort.energyLevel;
    data.attention_required = comfort.attentionLevel;
  }

  return data;
}

export function buildMediaFrontmatter(
  media: MediaItem,
  comfort: ComfortProfile | null,
  template: NoteTemplateSettings,
): string {
  return serializeFrontmatter(
    buildMediaFrontmatterData(media, comfort, template),
  );
}

/**
 * The full set of frontmatter keys MediaVault could ever write, regardless
 * of which optional properties are currently enabled. Used to merge
 * generated frontmatter with any pre-existing frontmatter in a note without
 * clobbering keys the user added themselves — MediaVault only ever
 * overwrites keys it recognizes as its own.
 */
export function managedFrontmatterKeys(
  template: NoteTemplateSettings,
): Set<string> {
  return new Set([
    ...REQUIRED_FRONTMATTER_KEYS,
    ...Object.keys(template.optionalProperties),
    ...COMFORT_FRONTMATTER_KEYS,
  ]);
}
