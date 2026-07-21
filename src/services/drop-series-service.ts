import type { StorageService } from "./storage";
import { MediaStatus } from "../types/enums";
import { recalculateAndPersistStatus } from "./status-service";

/**
 * Marks a TV series Dropped, with an optional reason (Milestone 3: Dropped
 * TV Series). Dropped is a manual-override status — `calculateMediaStatus`
 * always preserves it once set, so this is a direct write rather than a
 * recalculation.
 */
export async function dropSeries(storage: StorageService, mediaId: string, reason: string | null): Promise<void> {
	await storage.media.update(mediaId, {
		status: MediaStatus.Dropped,
		droppedReason: reason && reason.trim() !== "" ? reason.trim() : null,
	});
}

/**
 * Resumes a dropped series. Progress (episode progress, watch history)
 * was never touched by dropping, so it's already exactly as it was —
 * this only needs to lift the manual override so status goes back to
 * being auto-derived. The dropping reason is intentionally left in place;
 * only the user explicitly editing/removing it should clear it.
 */
export async function resumeSeries(storage: StorageService, mediaId: string): Promise<void> {
	// Watching isn't a manual-override status, so writing it here first
	// (rather than calling recalculateAndPersistStatus directly, which
	// would just see the current status is Dropped — a manual override —
	// and preserve it unchanged) clears the way for a genuine recalculation.
	await storage.media.update(mediaId, { status: MediaStatus.Watching });
	await recalculateAndPersistStatus(storage, mediaId);
}

/** Edits or clears the stored dropping reason without changing status. */
export async function updateDroppedReason(storage: StorageService, mediaId: string, reason: string | null): Promise<void> {
	await storage.media.update(mediaId, {
		droppedReason: reason && reason.trim() !== "" ? reason.trim() : null,
	});
}
