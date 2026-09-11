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
 * - A date-only value (`YYYY-MM-DD`) is compared as local midnight, so
 *   "today" is never flagged as future regardless of the current time of
 *   day.
 * - A value with a time component is compared to the actual current
 *   instant, so "later today" correctly counts as future while "earlier
 *   today" does not.
 * - Invalid/unparseable input is treated as not-future (the emptiness /
 *   format checks that already exist at each call site are responsible for
 *   rejecting those).
 */
export function isFutureDate(value: string): boolean {
  if (!value) return false;

  const dateOnly = /^\d{4}-\d{2}-\d{2}$/.test(value);
  const parsed = dateOnly ? new Date(`${value}T00:00:00`) : new Date(value);

  if (Number.isNaN(parsed.getTime())) return false;

  return parsed.getTime() > Date.now();
}
