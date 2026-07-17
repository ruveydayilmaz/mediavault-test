import type { App } from "obsidian";
import type { StorageService } from "../storage";
import { MediaItem } from "../../models/media";
import { MediaType } from "../../types/enums";
import { buildMediaFrontmatter } from "./media-frontmatter";
import { buildManagedBody, mergeManagedBody } from "./note-content";

function sanitizeFilename(name: string): string {
	return name.replace(/[/\\:*?"<>|]/g, "-").trim();
}

/** Builds the vault-relative folder for a media item, e.g. "MediaVault/Movies" or "MediaVault/TV". */
export function resolveMediaFolder(baseFolderPath: string, type: MediaType): string {
	const sub = type === MediaType.Movie ? "Movies" : "TV";
	return `${baseFolderPath.replace(/\/+$/, "")}/${sub}`;
}

/** Builds the full vault-relative note path for a media item. */
export function resolveMediaNotePath(baseFolderPath: string, media: MediaItem): string {
	const folder = resolveMediaFolder(baseFolderPath, media.type);
	const filename = sanitizeFilename(media.year ? `${media.title} (${media.year})` : media.title);
	return `${folder}/${filename}.md`;
}

async function ensureFolderExists(app: App, folderPath: string): Promise<void> {
	const parts = folderPath.split("/").filter(Boolean);
	let current = "";
	for (const part of parts) {
		current = current ? `${current}/${part}` : part;
		if (!app.vault.getAbstractFileByPath(current)) {
			await app.vault.createFolder(current).catch(() => {
				/* may already exist due to a race — safe to ignore */
			});
		}
	}
}

/**
 * Generates or safely updates the markdown note for a media item:
 * frontmatter is always fully regenerated (it's derived data), and the
 * managed body section (watch history, cast, tags) is regenerated too —
 * but anything the user wrote outside those markers is preserved exactly.
 *
 * Returns the vault-relative path the note was written to, and updates
 * MediaItem.notePath to match.
 */
export async function generateMediaNote(app: App, storage: StorageService, media: MediaItem): Promise<string> {
	const baseFolder = storage.settings.get().mediaFolderPath || "MediaVault";
	const notePath = resolveMediaNotePath(baseFolder, media);

	const sessions = await storage.watchSessions.findWhere((s) => s.mediaId === media.id);
	const comfortProfiles = await storage.comfortProfiles.findWhere((c) => c.mediaId === media.id);
	const comfort = comfortProfiles[0] ?? null;

	const frontmatter = buildMediaFrontmatter(media, comfort);
	const managedBody = buildManagedBody(media, sessions);

	const existingFile = app.vault.getAbstractFileByPath(notePath);
	let finalContent: string;

	if (existingFile) {
		const existingContent = await app.vault.adapter.read(notePath);
		// Frontmatter always regenerates fully; only the body after it is merged.
		const bodyOnly = stripLeadingFrontmatter(existingContent);
		const mergedBody = mergeManagedBody(bodyOnly, managedBody);
		finalContent = `${frontmatter}\n\n${mergedBody}`;
		await app.vault.adapter.write(notePath, finalContent);
	} else {
		await ensureFolderExists(app, resolveMediaFolder(baseFolder, media.type));
		finalContent = `${frontmatter}\n\n# ${media.title}\n\n${managedBody}\n\n## Notes\n\n`;
		await app.vault.create(notePath, finalContent);
	}

	if (media.notePath !== notePath) {
		await storage.media.update(media.id, { notePath });
	}

	return notePath;
}

/** Strips a leading YAML frontmatter block (if present) so it isn't duplicated when regenerating. */
function stripLeadingFrontmatter(content: string): string {
	if (!content.startsWith("---")) return content;
	const closingIdx = content.indexOf("\n---", 3);
	if (closingIdx === -1) return content;
	// Skip past the closing "---" and the newline after it.
	const afterFrontmatter = content.indexOf("\n", closingIdx + 4);
	return afterFrontmatter === -1 ? "" : content.slice(afterFrontmatter + 1);
}
