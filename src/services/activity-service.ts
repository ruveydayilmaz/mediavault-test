import type { StorageService } from "./storage";

export async function touchMediaActivity(
  storage: StorageService,
  mediaId: string,
): Promise<void> {
  await storage.media.update(mediaId, {
    lastActivityAt: new Date().toISOString(),
  });
}
