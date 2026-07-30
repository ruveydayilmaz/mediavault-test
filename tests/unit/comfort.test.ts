import { describe, it, expect } from "vitest";
import {
  filterByComfortCriteria,
  ComfortableMedia,
} from "../../src/services/comfort/filter";
import { rankComfortMatches } from "../../src/services/comfort/rank";
import { MediaType, MediaStatus } from "../../src/types/enums";
import { DEFAULT_COMFORT_FLAGS } from "../../src/models/comfort";

function makeItem(
  id: string,
  title: string,
  profileOverrides: any = {},
  flagOverrides: any = {},
): ComfortableMedia {
  return {
    media: {
      id,
      tmdbId: 1,
      type: MediaType.Movie,
      title,
      originalTitle: null,
      year: 2020,
      genres: [],
      runtime: 100,
      posterPath: null,
      backdropPath: null,
      cast: [],
      crew: [],
      productionCompanies: [],
      language: null,
      country: null,
      synopsis: null,
      status: MediaStatus.Completed,
      notes: "",
      tags: [],
      averageRating: null,
      watchCount: 0,
      notePath: null,
      createdAt: "",
      updatedAt: "",
    } as any,
    profile: {
      id: "p" + id,
      mediaId: id,
      comfortScore: 5,
      energyLevel: 5,
      attentionLevel: 5,
      emotionalHeaviness: 5,
      plotComplexity: 5,
      rewatchability: 5,
      flags: { ...DEFAULT_COMFORT_FLAGS, ...flagOverrides },
      seasonalTags: [],
      triggerWarnings: [],
      updatedAt: "",
      ...profileOverrides,
    } as any,
  };
}

describe("comfort filter: the 'cleaning the kitchen' scenario from the spec", () => {
  it("returns only the item matching energy>6, attention<4, comfort>7, no death", () => {
    const cozySafe = makeItem(
      "1",
      "Cozy Safe Show",
      { comfortScore: 9, energyLevel: 8, attentionLevel: 2 },
      { noMajorCharacterDeath: true },
    );
    const tooIntense = makeItem(
      "2",
      "Intense Drama",
      { comfortScore: 8, energyLevel: 8, attentionLevel: 9 },
      { noMajorCharacterDeath: false },
    );
    const lowComfort = makeItem("3", "Meh Show", {
      comfortScore: 3,
      energyLevel: 8,
      attentionLevel: 2,
    });
    const lowEnergy = makeItem(
      "4",
      "Sleepy Show",
      { comfortScore: 9, energyLevel: 3, attentionLevel: 2 },
      { noMajorCharacterDeath: true },
    );

    const filtered = filterByComfortCriteria(
      [cozySafe, tooIntense, lowComfort, lowEnergy],
      {
        energyMin: 6,
        attentionMax: 4,
        comfortScoreMin: 7,
        requiredFlags: ["noMajorCharacterDeath"],
      },
    );

    expect(filtered).toHaveLength(1);
    expect(filtered[0].media.title).toBe("Cozy Safe Show");
  });

  it("excludes items with an excluded trigger warning", () => {
    const clean = makeItem("5", "No Horror");
    const withHorror = makeItem("6", "Horror Movie");
    (withHorror.profile as any).triggerWarnings = ["horror"];

    const result = filterByComfortCriteria([clean, withHorror], {
      excludedTriggers: ["horror" as any],
    });
    expect(result).toHaveLength(1);
    expect(result[0].media.title).toBe("No Horror");
  });

  it("matches seasonal tags with OR semantics", () => {
    const winter = makeItem("7", "Winter Movie");
    (winter.profile as any).seasonalTags = ["winter"];
    const summer = makeItem("8", "Summer Movie");
    (summer.profile as any).seasonalTags = ["summer"];

    const result = filterByComfortCriteria([winter, summer], {
      seasonalTags: ["winter" as any],
    });
    expect(result).toHaveLength(1);
    expect(result[0].media.title).toBe("Winter Movie");
  });
});

describe("comfort ranking", () => {
  it("ranks by weighted score in monotonically decreasing order", () => {
    const best = makeItem(
      "r1",
      "Best",
      { comfortScore: 10, rewatchability: 10, emotionalHeaviness: 1 },
      { cozy: true },
    );
    const mid = makeItem("r2", "Mid", {
      comfortScore: 6,
      rewatchability: 5,
      emotionalHeaviness: 5,
    });
    const worst = makeItem("r3", "Worst", {
      comfortScore: 2,
      rewatchability: 1,
      emotionalHeaviness: 10,
    });

    const ranked = rankComfortMatches([mid, worst, best], {
      requiredFlags: ["cozy"],
    });

    expect(ranked[0].mediaId).toBe("r1");
    expect(ranked[ranked.length - 1].mediaId).toBe("r3");
    expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    expect(ranked[1].score).toBeGreaterThan(ranked[2].score);
  });

  it("ranks a flag-matching item above an otherwise-identical item missing the requested flag", () => {
    const hasFlag = makeItem(
      "f1",
      "Has Flag",
      { comfortScore: 7, rewatchability: 7, emotionalHeaviness: 3 },
      { cozy: true },
    );
    const noFlag = makeItem(
      "f2",
      "No Flag",
      { comfortScore: 7, rewatchability: 7, emotionalHeaviness: 3 },
      { cozy: false },
    );

    const ranked = rankComfortMatches([noFlag, hasFlag], {
      requiredFlags: ["cozy"],
    });
    expect(ranked[0].mediaId).toBe("f1");
  });
});
