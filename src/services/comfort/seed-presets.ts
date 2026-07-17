import type { StorageService } from "../storage";
import { BUILT_IN_COMFORT_PRESETS } from "../storage/comfort-repository";

/**
 * Seeds the built-in presets (Bedtime, Background noise, Emotional
 * recovery, Cozy winter) on first run. Idempotent — checks existing preset
 * names before creating, so calling this on every plugin load never
 * duplicates presets or clobbers a user's own edits to a same-named custom
 * preset (an existing name of any kind blocks re-seeding that one).
 */
export async function seedBuiltInPresets(storage: StorageService): Promise<number> {
	const existing = await storage.comfortPresets.getAll();
	const existingNames = new Set(existing.map((p) => p.name));

	let created = 0;
	for (const preset of BUILT_IN_COMFORT_PRESETS) {
		if (existingNames.has(preset.name)) continue;
		await storage.comfortPresets.create(preset);
		created++;
	}
	return created;
}
