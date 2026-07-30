import { describe, it, expect } from "vitest";
import {
  ensureValidTraktToken,
  disconnectTrakt,
} from "../../src/services/trakt-token";

function makeMockStorage(initial: any) {
  let settingsStore = initial;
  const storage: any = {
    settings: {
      get: () => settingsStore,
      update: async (patch: any) => {
        settingsStore = { ...settingsStore, ...patch };
        return settingsStore;
      },
    },
  };
  return { storage, getSettings: () => settingsStore };
}

describe("trakt-token", () => {
  it("returns null when not connected", async () => {
    const { storage } = makeMockStorage({
      traktAccessToken: null,
      traktRefreshToken: null,
    });
    expect(await ensureValidTraktToken(storage)).toBeNull();
  });

  it("returns the current token as-is when well beyond the refresh buffer", async () => {
    const { storage } = makeMockStorage({
      traktAccessToken: "valid-token",
      traktRefreshToken: "r",
      traktTokenExpiresAt: Date.now() + 20 * 60 * 1000,
    });
    expect(await ensureValidTraktToken(storage)).toBe("valid-token");
  });

  it("clears all token fields on disconnect", async () => {
    const { storage, getSettings } = makeMockStorage({
      traktAccessToken: "x",
      traktRefreshToken: "y",
      traktTokenExpiresAt: 123,
    });
    await disconnectTrakt(storage);
    expect(getSettings().traktAccessToken).toBeNull();
    expect(getSettings().traktRefreshToken).toBeNull();
  });
});
