import { BaseRepository, generateId } from "./base-repository";
import { StorageAdapter } from "./storage-adapter";
import {
  ComfortProfile,
  ComfortPreset,
  DEFAULT_COMFORT_FLAGS,
} from "../../models/comfort";
import { MediaVaultId } from "../../types/common";

export class ComfortRepository extends BaseRepository<ComfortProfile> {
  private mediaIndexCache = {
    version: -1,
    map: new Map<MediaVaultId, ComfortProfile[]>(),
  };

  constructor(adapter: StorageAdapter) {
    super(adapter, "comfortProfiles");
  }

  async create(
    mediaId: MediaVaultId,
    input: Partial<Omit<ComfortProfile, "id" | "mediaId">> = {},
  ): Promise<ComfortProfile> {
    const profile: ComfortProfile = {
      id: generateId(),
      mediaId,
      comfortScore: 5,
      energyLevel: 5,
      attentionLevel: 5,
      emotionalHeaviness: 5,
      plotComplexity: 5,
      rewatchability: 5,
      flags: { ...DEFAULT_COMFORT_FLAGS },
      seasonalTags: [],
      triggerWarnings: [],
      ...input,
      updatedAt: new Date().toISOString(),
    };
    return this.save(profile);
  }

  async update(
    id: MediaVaultId,
    patch: Partial<ComfortProfile>,
  ): Promise<ComfortProfile | null> {
    return super.update(id, { ...patch, updatedAt: new Date().toISOString() });
  }

  async findByMediaId(mediaId: MediaVaultId): Promise<ComfortProfile | null> {
    const index = this.buildIndex((p) => p.mediaId, this.mediaIndexCache);
    return index.get(mediaId)?.[0] ?? null;
  }

  async getOrCreate(mediaId: MediaVaultId): Promise<ComfortProfile> {
    const existing = await this.findByMediaId(mediaId);
    if (existing) return existing;
    return this.create(mediaId);
  }

  async deleteByMediaId(mediaId: MediaVaultId): Promise<boolean> {
    const existing = await this.findByMediaId(mediaId);
    if (!existing) return false;
    return this.delete(existing.id);
  }
}

export class ComfortPresetRepository extends BaseRepository<ComfortPreset> {
  constructor(adapter: StorageAdapter) {
    super(adapter, "comfortPresets");
  }

  async create(
    input: Omit<ComfortPreset, "id" | "isBuiltIn">,
  ): Promise<ComfortPreset> {
    return this.save({ id: generateId(), isBuiltIn: false, ...input });
  }
}

export const BUILT_IN_COMFORT_PRESETS: Omit<ComfortPreset, "id">[] = [
  {
    name: "Bedtime",
    description: "Low energy, low attention, nothing upsetting before sleep.",
    energyMax: 4,
    attentionMax: 4,
    emotionalHeavinessMax: 3,
    comfortScoreMin: 6,
    requiredFlags: ["goodBeforeSleep"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
  {
    name: "Background noise",
    description:
      "Something to have on while doing chores — low attention required.",
    attentionMax: 4,
    requiredFlags: ["goodForBackgroundNoise"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
  {
    name: "Emotional recovery",
    description: "Safe, low-conflict, familiar favorites for hard days.",
    emotionalHeavinessMax: 3,
    comfortScoreMin: 7,
    requiredFlags: ["safeWhenAnxious", "lowConflict"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
  {
    name: "Cozy winter",
    description: "Rewatchable comfort picks with a winter/Christmas feel.",
    rewatchabilityMin: 7,
    requiredFlags: ["cozy"],
    excludedTriggers: [],
    seasonalTags: [],
    isBuiltIn: true,
  },
];
