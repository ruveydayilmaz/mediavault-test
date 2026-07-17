import { describe, it, expect } from "vitest";
import { generateMediaNote, resolveMediaNotePath, resolveMediaFolder } from "../../src/services/note-generator/media-note-generator";
import { MediaType, MediaStatus } from "../../src/types/enums";

function makeMedia(overrides: any = {}) {
	return {
		id: "m1",
		tmdbId: 157336,
		type: MediaType.Movie,
		title: "Interstellar",
		originalTitle: null,
		year: 2014,
		genres: ["Sci-Fi"],
		runtime: 169,
		posterPath: null,
		backdropPath: null,
		cast: [],
		crew: [],
		productionCompanies: [],
		language: "en",
		country: "US",
		synopsis: null,
		status: MediaStatus.Completed,
		notes: "",
		tags: [],
		averageRating: 9,
		watchCount: 1,
		notePath: null,
		createdAt: "",
		updatedAt: "",
		...overrides,
	};
}

function makeMockAppAndStorage() {
	const files: Record<string, string> = {};
	const mediaStore: any[] = [];
	const sessionStore: any[] = [];

	const app: any = {
		vault: {
			getAbstractFileByPath: (p: string) => (files[p] !== undefined ? {} : null),
			create: async (p: string, content: string) => {
				files[p] = content;
			},
			createFolder: async () => {},
			adapter: {
				read: async (p: string) => files[p],
				write: async (p: string, content: string) => {
					files[p] = content;
				},
			},
		},
	};

	const storage: any = {
		settings: { get: () => ({ mediaFolderPath: "MediaVault" }) },
		watchSessions: { findWhere: async (pred: any) => sessionStore.filter(pred) },
		comfortProfiles: { findWhere: async () => [] },
		media: {
			update: async (id: string, patch: any) => {
				const idx = mediaStore.findIndex((m) => m.id === id);
				mediaStore[idx] = { ...mediaStore[idx], ...patch };
				return mediaStore[idx];
			},
		},
	};

	return { app, storage, files, mediaStore, sessionStore };
}

describe("note-generator: path resolution", () => {
	it("resolves movie and TV folders correctly", () => {
		expect(resolveMediaFolder("MediaVault", MediaType.Movie)).toBe("MediaVault/Movies");
		expect(resolveMediaFolder("MediaVault", MediaType.TVShow)).toBe("MediaVault/TV");
	});

	it("sanitizes filesystem-unsafe characters in the filename", () => {
		const media = makeMedia({ title: "Se7en: The Cut", year: null });
		const path = resolveMediaNotePath("MediaVault", media);
		expect(path).not.toContain(":");
		expect(path.startsWith("MediaVault/Movies/")).toBe(true);
	});
});

describe("note-generator: user-content preservation (critical invariant)", () => {
	it("creates a new note with frontmatter, managed body, and a Notes placeholder", async () => {
		const { app, storage, files, mediaStore } = makeMockAppAndStorage();
		const media = makeMedia();
		mediaStore.push(media);

		const path = await generateMediaNote(app, storage, media);

		expect(path).toBe("MediaVault/Movies/Interstellar (2014).md");
		expect(files[path]).toContain("tmdb_id: 157336");
		expect(files[path]).toContain("## Notes");
		expect(mediaStore[0].notePath).toBe(path);
	});

	it("preserves user-written content (before, inside, and after the managed section) when regenerating", async () => {
		const { app, storage, files, mediaStore, sessionStore } = makeMockAppAndStorage();
		const media = makeMedia();
		mediaStore.push(media);

		const path = await generateMediaNote(app, storage, media);

		// Simulate the user editing the note by hand.
		files[path] = files[path].replace(
			"## Notes\n\n",
			"## Notes\n\nThis movie changed how I think about time and love.\n"
		);

		// A new watch session is logged, then the note is regenerated.
		sessionStore.push({
			id: "s1",
			mediaId: "m1",
			watchDate: "2024-01-01",
			rewatchNumber: 0,
			rating: 9,
			review: "Beautiful",
			tags: [],
		});

		const path2 = await generateMediaNote(app, storage, media);
		expect(path2).toBe(path);

		expect(files[path]).toContain("This movie changed how I think about time and love.");
		expect(files[path]).toContain("First watch");
		expect(files[path]).toContain("Beautiful");

		// Frontmatter must not be duplicated.
		const delimiterCount = (files[path].match(/^---$/gm) ?? []).length;
		expect(delimiterCount).toBe(2);
	});

	it("appends the managed block rather than overwriting a legacy note with no markers", async () => {
		const { app, storage, files, mediaStore } = makeMockAppAndStorage();
		const media = makeMedia();
		mediaStore.push(media);

		const path = resolveMediaNotePath("MediaVault", media);
		files[path] = "# Interstellar\n\nJust some notes, no markers here.\n";

		await generateMediaNote(app, storage, media);

		expect(files[path]).toContain("Just some notes, no markers here.");
		expect(files[path]).toContain("<!-- mediavault:start -->");
	});
});
