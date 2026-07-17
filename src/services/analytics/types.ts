export interface CountItem {
	label: string;
	count: number;
}

export interface TrendPoint {
	period: string; // "2024-01" for monthly, "2024" for yearly
	count: number;
}

export interface AnalyticsSummary {
	/** Total minutes across all logged movie watches + watched episodes. */
	totalRuntimeMinutes: number;

	moviesWatchedCount: number;
	episodesWatchedCount: number;

	/** Average rating across all rated watch sessions + rated episode progress. */
	averageRating: number | null;

	topGenres: CountItem[];
	topActors: CountItem[];
	topDirectors: CountItem[];
	topStudios: CountItem[];

	/** Number of watch sessions with rewatchNumber > 0 — i.e. actual rewatches, not first watches. */
	rewatchCount: number;

	/** Percentage (0-100) of library items with status "completed". */
	completionRate: number;

	monthlyWatchTrend: TrendPoint[];
	yearlyWatchTrend: TrendPoint[];
}
