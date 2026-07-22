/**
 * Runs `fn` over every item in `items`, at most `limit` in flight at once,
 * preserving result order. Used throughout the GDPR importer to turn what
 * used to be fully-sequential TMDB requests (one round trip at a time) into
 * a small number of concurrent requests — without removing the rate-limit
 * safety a naive `Promise.all` over everything at once would risk.
 */
export async function mapWithConcurrency<T, R>(
	items: T[],
	limit: number,
	fn: (item: T, index: number) => Promise<R>
): Promise<R[]> {
	const results: R[] = new Array(items.length);
	let nextIndex = 0;

	async function worker(): Promise<void> {
		for (let i = nextIndex++; i < items.length; i = nextIndex++) {
			results[i] = await fn(items[i], i);
		}
	}

	const workerCount = Math.max(1, Math.min(limit, items.length));
	await Promise.all(Array.from({ length: workerCount }, () => worker()));
	return results;
}
