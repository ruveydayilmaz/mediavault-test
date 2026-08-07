import type { StorageService } from "./storage";

/**
 * Single write point for `lastActivityAt` (drives Recent sorting).
 *
 * Live user actions call this with no `at` and get "now", same as always.
 * Bulk imports (e.g. the GDPR importer) pass the actual historical
 * timestamp of the imported event so Recent reflects real watch
 * chronology instead of import time. When an explicit `at` is given, the
 * write is a monotonic bump: it never moves `lastActivityAt` backward
 * past whatever is already stored, so importing older history can't
 * regress a show/movie that already has more recent real activity, and
 * re-running the same import is a no-op (idempotent).
 */
export async function touchMediaActivity(
  storage: StorageService,
  mediaId: string,
  at?: string,
): Promise<void> {
  if (at) {
    const media = await storage.media.findById(mediaId);
    if (media?.lastActivityAt && media.lastActivityAt >= at) return;
    await storage.media.update(mediaId, { lastActivityAt: at });
    return;
  }
  await storage.media.update(mediaId, {
    lastActivityAt: new Date().toISOString(),
  });
}
