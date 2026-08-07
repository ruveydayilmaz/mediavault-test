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

// ---------------------------------------------------------------------------
// Generic Go map-object array parser
//
// The GDPR `collection` row's metadata objects carry nested array fields
// (`posters[]`, `fanart[]`) that the simple whitespace-tokenizing parser
// above can't handle (a naive split would break on the spaces separating
// multiple poster URLs). This is a small bracket-depth-aware parser that
// walks the raw Go `fmt %v` text character by character, so nested `[...]`
// values are consumed as a unit rather than split apart.
// ---------------------------------------------------------------------------

export type GoMapObject = Record<string, string | string[]>;

function parseGoMapBody(body: string): GoMapObject {
  const result: GoMapObject = {};
  let i = 0;
  const n = body.length;

  while (i < n) {
    while (i < n && /\s/.test(body[i])) i++;
    if (i >= n) break;

    const colonIdx = body.indexOf(":", i);
    if (colonIdx === -1) break;
    const key = body.slice(i, colonIdx);
    i = colonIdx + 1;

    if (body[i] === "[") {
      let depth = 1;
      i++;
      const start = i;
      while (i < n && depth > 0) {
        if (body[i] === "[") depth++;
        else if (body[i] === "]") depth--;
        if (depth > 0) i++;
      }
      const arrBody = body.slice(start, i);
      i++; // consume closing ']'
      result[key] = arrBody.trim() ? arrBody.trim().split(/\s+/) : [];
    } else {
      const start = i;
      while (i < n && !/\s/.test(body[i])) i++;
      result[key] = body.slice(start, i);
    }
  }

  return result;
}

function parseGoMapObjectsLiteral(raw: string): GoMapObject[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  const inner =
    trimmed.startsWith("[") && trimmed.endsWith("]")
      ? trimmed.slice(1, -1)
      : trimmed;

  const objects: GoMapObject[] = [];
  let i = 0;
  const n = inner.length;

  while (i < n) {
    while (i < n && /\s/.test(inner[i])) i++;
    if (i >= n) break;

    if (inner.startsWith("map[", i)) {
      i += 4;
      let depth = 1;
      const start = i;
      while (i < n && depth > 0) {
        if (inner[i] === "[") depth++;
        else if (inner[i] === "]") depth--;
        if (depth > 0) i++;
      }
      const body = inner.slice(start, i);
      i++; // consume closing ']'
      objects.push(parseGoMapBody(body));
    } else {
      i++;
    }
  }

  return objects;
}

function parseJsonObjectArray(raw: string): GoMapObject[] | null {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!Array.isArray(data)) return null;
  return data.map((entry) => {
    const obj = (entry ?? {}) as Record<string, unknown>;
    const out: GoMapObject = {};
    for (const [key, value] of Object.entries(obj)) {
      if (Array.isArray(value)) {
        out[key] = value.map((v) => String(v));
      } else if (value !== null && value !== undefined) {
        out[key] = String(value);
      }
    }
    return out;
  });
}

/**
 * Parses the `objects` column of a GDPR `lists-prod-lists.csv` row whose
 * `s_key` is `collection` — the array of per-list metadata entries (name,
 * description, dates, visibility, artwork, and each list's own `s_key`).
 * Handles both Go's `fmt %v` literal and a plain JSON array, mirroring
 * `parseGoMapArray`'s dual-format tolerance.
 */
export function parseGoMapObjectsArray(raw: string): GoMapObject[] {
  const trimmed = raw.trim();
  if (!trimmed || trimmed === "[]") return [];

  if (trimmed.includes("map[")) {
    return parseGoMapObjectsLiteral(trimmed);
  }

  const asJson = parseJsonObjectArray(trimmed);
  if (asJson) return asJson;

  return parseGoMapObjectsLiteral(trimmed);
}

function firstString(value: string | string[] | undefined): string | null {
  if (value === undefined) return null;
  if (Array.isArray(value)) return value[0] ?? null;
  return value.trim() ? value : null;
}

function stringArray(value: string | string[] | undefined): string[] {
  if (value === undefined) return [];
  if (Array.isArray(value)) return value.filter((v) => v.trim().length > 0);
  return value.trim() ? [value] : [];
}

export interface ListMetadata {
  sKey: string | null;
  name: string | null;
  description: string | null;
  createdAt: string | null;
  updatedAt: string | null;
  isPublic: boolean;
  posterUrls: string[];
  fanartUrls: string[];
  type: string | null;
}

/**
 * Normalizes a raw `GoMapObject` from the `collection` row's metadata array
 * into a typed `ListMetadata` record.
 */
export function parseListMetadata(obj: GoMapObject): ListMetadata {
  const createdAtRaw = firstString(obj["created_at"]);
  const updatedAtRaw = firstString(obj["updated_at"]);
  const isPublicRaw = firstString(obj["is_public"]);
  return {
    sKey: firstString(obj["s_key"]),
    name: firstString(obj["name"]),
    description: firstString(obj["description"]),
    createdAt: createdAtRaw ? epochToISODate(createdAtRaw) : null,
    updatedAt: updatedAtRaw ? epochToISODate(updatedAtRaw) : null,
    isPublic: isPublicRaw === "true" || isPublicRaw === "1",
    posterUrls: stringArray(obj["posters"]),
    fanartUrls: stringArray(obj["fanart"]),
    type: firstString(obj["type"]),
  };
}
