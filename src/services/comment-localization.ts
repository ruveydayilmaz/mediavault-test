import { TraktComment } from "../api/trakt";

/**
 * Filters + orders Trakt comments by the user's configured languages.
 *
 * Trakt's comments endpoints (`/movies/:id/comments`,
 * `/shows/:id/comments`, `/shows/:id/seasons/:s/episodes/:e/comments`)
 * don't document a server-side language filter param — unlike some other
 * Trakt endpoints (e.g. `/movies/trending?languages=`) — so this is done
 * locally, over whatever `extended=full` already returned. Comments Trakt
 * didn't tag with a language are excluded, since there's no way to know
 * whether they match a configured language or not, and showing them
 * unfiltered would defeat the point of this feature.
 */
export function filterAndSortCommentsByLanguage(
	comments: TraktComment[],
	primaryLanguage: string,
	additionalLanguages: string[]
): TraktComment[] {
	const priority = [primaryLanguage, ...additionalLanguages].filter((l) => l.trim().length > 0);
	if (priority.length === 0) return comments;

	const rank = new Map(priority.map((lang, i) => [lang.toLowerCase(), i]));

	return comments
		.filter((c) => c.language !== null && rank.has(c.language.toLowerCase()))
		.sort((a, b) => {
			const rankA = rank.get((a.language as string).toLowerCase()) as number;
			const rankB = rank.get((b.language as string).toLowerCase()) as number;
			return rankA - rankB;
		});
}
