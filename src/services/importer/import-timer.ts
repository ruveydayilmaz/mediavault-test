/**
 * Minimal stage-timing instrumentation for the import pipeline. Accumulates
 * elapsed time per named stage across however many times that stage is
 * entered (e.g. "TMDB matching" is entered once per distinct title), so the
 * end-of-import report can show exactly where time went — see the
 * GDPR Import Performance Audit milestone.
 *
 * Deliberately dependency-free and cheap: a handful of Map writes per call,
 * never itself a meaningful fraction of import time.
 */
export class ImportTimer {
	private totals = new Map<string, number>();
	private counts = new Map<string, number>();
	private start = performance.now();

	/** Times a synchronous or async block under `stage`, accumulating into the running total for that stage. */
	async time<T>(stage: string, fn: () => Promise<T>): Promise<T> {
		const t0 = performance.now();
		try {
			return await fn();
		} finally {
			this.add(stage, performance.now() - t0);
		}
	}

	/** Manually adds elapsed milliseconds to a stage — for cases where `time()`'s try/finally wrapping doesn't fit (e.g. timing a batch as a whole). */
	add(stage: string, ms: number): void {
		this.totals.set(stage, (this.totals.get(stage) ?? 0) + ms);
		this.counts.set(stage, (this.counts.get(stage) ?? 0) + 1);
	}

	/** Merges another timer's accumulated stages into this one (e.g. combining ZIP-extraction timing with commit-phase timing into one report). */
	merge(other: ImportTimer): void {
		for (const [stage, ms] of other.totals) {
			this.totals.set(stage, (this.totals.get(stage) ?? 0) + ms);
		}
		for (const [stage, count] of other.counts) {
			this.counts.set(stage, (this.counts.get(stage) ?? 0) + count);
		}
	}

	/** Total wall-clock time since this timer was constructed. */
	totalElapsedMs(): number {
		return performance.now() - this.start;
	}

	/** Snapshot of every stage's accumulated time, sorted slowest-first, plus a synthetic "Total" row. */
	breakdown(): { stage: string; ms: number; calls: number }[] {
		const rows = [...this.totals.entries()]
			.map(([stage, ms]) => ({ stage, ms, calls: this.counts.get(stage) ?? 0 }))
			.sort((a, b) => b.ms - a.ms);
		rows.push({ stage: "Total", ms: this.totalElapsedMs(), calls: 0 });
		return rows;
	}

	/** Human-readable "Xm Ys" / "X.Xs" formatting for the report UI. */
	static formatMs(ms: number): string {
		if (ms < 1000) return `${Math.round(ms)} ms`;
		const totalSeconds = ms / 1000;
		if (totalSeconds < 60) return `${totalSeconds.toFixed(1)}s`;
		const minutes = Math.floor(totalSeconds / 60);
		const seconds = Math.round(totalSeconds % 60);
		return `${minutes}m ${seconds}s`;
	}
}
