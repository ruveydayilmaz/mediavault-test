/**
 * Shared date helpers for user-entered watch dates (movie watch sessions,
 * episode watch edits, and any future date selector). Centralized here so
 * "no future dates" is enforced identically everywhere it's needed, instead
 * of each modal reimplementing its own today/future check.
 *
 * These helpers intentionally operate on local calendar time (not UTC),
 * matching how a native `<input type="date">` value is entered and
 * displayed to the user.
 */

/** Today's date as a local `YYYY-MM-DD` string. Always computed fresh — never cache this. */
export function todayIsoDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const month = String(now.getMonth() + 1).padStart(2, "0");
  const day = String(now.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

/**
 * Whether an ISO date string (`YYYY-MM-DD`, optionally with a time
 * component) represents a point in the future relative to right now.
 *
 * Deliberately avoids handing the raw string to `new Date(string)`. That
 * overload's parsing behavior for anything beyond a handful of strict ISO
 * shapes is implementation-defined, and WebKit (Safari / iOS's WKWebView)
 * is well known to parse ambiguous date strings differently than V8
 * (desktop Electron, Android's Chromium-based WebView) — which is exactly
 * the kind of platform-dependent gap that could let a future date slip
 * past this check on iOS while working correctly on desktop. Instead:
 *
 * - A date-only value (`YYYY-MM-DD`, what a native `<input type="date">`
 *   always yields per spec) is compared with a plain string comparison
 *   against `todayIsoDate()`. Two `YYYY-MM-DD` strings sort lexically in
 *   exactly calendar order, so this needs no Date object, no timezone
 *   conversion, and no engine-specific parsing at all — "today" is never
 *   flagged as future regardless of the time of day.
 * - A value with a time component is broken into numeric components and
 *   built via `new Date(y, m, d, h, mi, s)`, the one Date constructor
 *   overload whose behavior is fully specified and identical across every
 *   engine/platform (no string parsing involved), then compared to the
 *   actual current instant — so "later today" counts as future while
 *   "earlier today" does not.
 * - Anything that doesn't match either shape is treated as not-future; the
 *   emptiness/format checks already present at each call site are
 *   responsible for rejecting genuinely malformed input.
 */
export function isFutureDate(value: string): boolean {
  if (!value) return false;

  const dateOnlyMatch = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (dateOnlyMatch) {
    return value > todayIsoDate();
  }

  const dateTimeMatch =
    /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2}))?/.exec(value);
  if (dateTimeMatch) {
    const [, year, month, day, hour, minute, second] = dateTimeMatch;
    const parsed = new Date(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      second ? Number(second) : 0,
    );
    if (Number.isNaN(parsed.getTime())) return false;
    return parsed.getTime() > Date.now();
  }

  return false;
}
