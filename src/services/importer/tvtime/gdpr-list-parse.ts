export interface GoMapListItem {
  type: string | null;
  uuid: string | null;
  tvTimeId: string | null;
  createdAt: string | null;
}

function epochToISODate(raw: string): string | null {
  const seconds = Number(raw);
  if (!Number.isFinite(seconds) || seconds <= 0) return null;
  return new Date(seconds * 1000).toISOString().slice(0, 10);
}

function parseGoMap(block: string): Record<string, string> {
  const result: Record<string, string> = {};
  const tokens = block.trim().split(/\s+/);
  for (const token of tokens) {
    const colonIdx = token.indexOf(":");
    if (colonIdx <= 0) continue;
    const key = token.slice(0, colonIdx);
    const value = token.slice(colonIdx + 1);
    result[key] = value;
  }
  return result;
}

export function parseGoMapArray(raw: string): GoMapListItem[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  if (!inner) return [];

  const chunks = inner.split("map[");
  const items: GoMapListItem[] = [];

  for (const chunk of chunks) {
    const cleaned = chunk.trim();
    if (!cleaned) continue;

    const body = cleaned.endsWith("]") ? cleaned.slice(0, -1) : cleaned;
    if (!body.trim()) continue;

    const fields = parseGoMap(body);

    items.push({
      type: fields["type"] || null,
      uuid: fields["uuid"] || null,
      tvTimeId: fields["id"] || null,
      createdAt: fields["created_at"]
        ? epochToISODate(fields["created_at"])
        : null,
    });
  }

  return items;
}
