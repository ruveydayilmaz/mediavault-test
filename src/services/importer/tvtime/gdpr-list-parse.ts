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

function parseGoMapArrayLiteral(raw: string): GoMapListItem[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1).trim()
      : trimmed;

  if (!inner) return [];

  // Every "map[" boundary starts a new object, so this preserves ordering
  // and yields one chunk per entry regardless of how many entries exist.
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

interface RawJsonListObject {
  type?: string | number | null;
  uuid?: string | number | null;
  id?: string | number | null;
  created_at?: string | number | null;
}

function toStringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
}

function parseJsonObjectsArray(raw: string): GoMapListItem[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;

  return data.map((entry) => {
    const obj = (entry ?? {}) as RawJsonListObject;
    const createdAt = toStringOrNull(obj.created_at);
    return {
      type: toStringOrNull(obj.type),
      uuid: toStringOrNull(obj.uuid),
      tvTimeId: toStringOrNull(obj.id),
      createdAt: createdAt ? epochToISODate(createdAt) : null,
    };
  });
}

/**
 * Parses the `objects` column of a TV Time GDPR `lists-prod-lists.csv` row.
 * TV Time has shipped this column both as Go's `fmt %v` representation of
 * `[]map[string]interface{}` (e.g. `[map[id:1 type:series uuid:...] ...]`)
 * and, in some export versions, as a plain JSON array. Both preserve item
 * ordering and are attempted here so a format difference never silently
 * yields zero items for an otherwise valid list.
 */
export function parseGoMapArray(raw: string): GoMapListItem[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  if (trimmed.includes("map[")) {
    return parseGoMapArrayLiteral(trimmed);
  }

  const asJson = parseJsonObjectsArray(trimmed);
  if (asJson) return asJson;

  return parseGoMapArrayLiteral(trimmed);
}
