import type { App } from "obsidian";
import type { StorageService } from "./storage";
import { MediaType } from "../types/enums";

/**
 * Generates (or fully regenerates) "Trakt Rating History.md" — a
 * date-grouped log of watches with wikilink backlinks to each media note,
 * in the format described in the milestone spec:
 *
 *   ## 2026-07-02
 *   - [[Interstellar]] — 10/10
 *
 * This note is a derived view, not a source of truth — it's safe to
 * regenerate from scratch on every sync, since it's built entirely from
 * WatchSession/EpisodeProgress data that already lives in VaultData.
 */
export async function generateTraktHistoryNote(app: App, storage: StorageService, notePath: string): Promise<void> {
	const media = await storage.media.getAll();
	const mediaById = new Map(media.map((m) => [m.id, m]));

	const sessions = await storage.watchSessions.getAll();
	const progress = await storage.episodeProgress.getAll();

	type Entry = { date: string; line: string };
	const entries: Entry[] = [];

	for (const session of sessions) {
		const item = mediaById.get(session.mediaId);
		if (!item) continue;
		const ratingText = session.rating !== null ? ` — ${session.rating}/10` : "";
		entries.push({ date: session.watchDate, line: `[[${item.title}]]${ratingText}` });
	}

	for (const p of progress) {
		if (!p.watched || !p.watchedDate) continue;
		const item = mediaById.get(p.mediaId);
		if (!item || item.type !== MediaType.TVShow) continue;
		const ratingText = p.rating !== null ? ` — ${p.rating}/10` : "";
		entries.push({
			date: p.watchedDate.slice(0, 10),
			line: `[[${item.title}]] — S${String(p.seasonNumber).padStart(2, "0")}E${String(p.episodeNumber).padStart(2, "0")}${ratingText}`,
		});
	}

	entries.sort((a, b) => (a.date < b.date ? 1 : a.date > b.date ? -1 : 0)); // newest first

	const byDate = new Map<string, string[]>();
	for (const entry of entries) {
		if (!byDate.has(entry.date)) byDate.set(entry.date, []);
		byDate.get(entry.date)!.push(entry.line);
	}

	const lines: string[] = ["# Trakt Rating History", ""];
	for (const [date, dateLines] of byDate) {
		lines.push(`## ${date}`);
		dateLines.forEach((l) => lines.push(`- ${l}`));
		lines.push("");
	}

	const content = lines.join("\n");

	const existing = app.vault.getAbstractFileByPath(notePath);
	if (existing) {
		await app.vault.adapter.write(notePath, content);
	} else {
		// Ensure parent folder exists before creating the file.
		const folder = notePath.split("/").slice(0, -1).join("/");
		if (folder && !app.vault.getAbstractFileByPath(folder)) {
			await app.vault.createFolder(folder).catch(() => {
				/* folder may already exist due to a race — safe to ignore */
			});
		}
		await app.vault.create(notePath, content);
	}
}
