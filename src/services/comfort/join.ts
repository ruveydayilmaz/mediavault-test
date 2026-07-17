import type { StorageService } from "../storage";
import { ComfortableMedia } from "./filter";

/**
 * Joins every media item that has a comfort profile with that profile.
 * Items without a profile yet are excluded — they simply haven't been
 * given comfort metadata, so they can't participate in comfort queries
 * until they are (via the comfort profile editor).
 */
export async function getComfortableMedia(storage: StorageService): Promise<ComfortableMedia[]> {
	const [media, profiles] = await Promise.all([storage.media.getAll(), storage.comfortProfiles.getAll()]);
	const profileByMediaId = new Map(profiles.map((p) => [p.mediaId, p]));

	const result: ComfortableMedia[] = [];
	for (const item of media) {
		const profile = profileByMediaId.get(item.id);
		if (profile) result.push({ media: item, profile });
	}
	return result;
}
