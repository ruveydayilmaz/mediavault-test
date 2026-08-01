import en from "./locales/en";
import tr from "./locales/tr";
import {
  DEFAULT_LOCALE,
  Locale,
  TranslationDict,
  TranslationParams,
} from "./types";

const LOCALES: Record<Locale, TranslationDict> = { en, tr };

type Listener = (locale: Locale) => void;

/**
 * Centralized localization service. One instance lives on the plugin and is
 * shared by every component. Components should never read translation
 * dictionaries or hardcode strings directly - always go through `t()`.
 */
export class I18nService {
  private locale: Locale = DEFAULT_LOCALE;
  private listeners: Set<Listener> = new Set();

  setLocale(locale: Locale): void {
    if (!LOCALES[locale]) locale = DEFAULT_LOCALE;
    if (this.locale === locale) return;
    this.locale = locale;
    for (const listener of this.listeners) listener(this.locale);
  }

  getLocale(): Locale {
    return this.locale;
  }

  /** Subscribe to language changes. Returns an unsubscribe function. */
  onChange(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private lookup(dict: TranslationDict, key: string): string | undefined {
    const parts = key.split(".");
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let node: any = dict;
    for (const part of parts) {
      if (node == null || typeof node !== "object") return undefined;
      node = node[part];
    }
    return typeof node === "string" ? node : undefined;
  }

  private interpolate(str: string, params?: TranslationParams): string {
    if (!params) return str;
    return str.replace(/\{(\w+)\}/g, (match, key) => {
      const value = params[key];
      return value === undefined ? match : String(value);
    });
  }

  /** Translate a stable key. Falls back to English, then to the key itself. */
  t(key: string, params?: TranslationParams): string {
    const current = LOCALES[this.locale];
    let str = this.lookup(current, key);
    if (str === undefined && this.locale !== DEFAULT_LOCALE) {
      str = this.lookup(LOCALES[DEFAULT_LOCALE], key);
    }
    if (str === undefined) return key;
    return this.interpolate(str, params);
  }

  private get intlLocale(): string {
    return this.locale === "tr" ? "tr-TR" : "en-US";
  }

  formatNumber(n: number, options?: Intl.NumberFormatOptions): string {
    return new Intl.NumberFormat(this.intlLocale, options).format(n);
  }

  formatPercent(n: number): string {
    return new Intl.NumberFormat(this.intlLocale, {
      style: "percent",
      maximumFractionDigits: 0,
    }).format(n);
  }

  formatRating(n: number): string {
    return new Intl.NumberFormat(this.intlLocale, {
      maximumFractionDigits: 1,
      minimumFractionDigits: n % 1 === 0 ? 0 : 1,
    }).format(n);
  }

  /** Locale-aware runtime string, e.g. "2h 15m" / "2s 15dk". */
  formatRuntime(totalMinutes: number): string {
    const hours = Math.floor(totalMinutes / 60);
    const minutes = Math.round(totalMinutes % 60);
    const hUnit = this.locale === "tr" ? "s" : "h";
    const mUnit = this.locale === "tr" ? "dk" : "m";
    if (hours <= 0) return `${minutes}${mUnit}`;
    if (minutes <= 0) return `${hours}${hUnit}`;
    return `${hours}${hUnit} ${minutes}${mUnit}`;
  }

  formatDate(iso: string, options?: Intl.DateTimeFormatOptions): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(
      this.intlLocale,
      options ?? { year: "numeric", month: "short", day: "numeric" },
    ).format(date);
  }

  formatMonthYear(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(this.intlLocale, {
      year: "numeric",
      month: "long",
    }).format(date);
  }

  formatWeekday(iso: string): string {
    const date = new Date(iso);
    if (Number.isNaN(date.getTime())) return iso;
    return new Intl.DateTimeFormat(this.intlLocale, { weekday: "long" }).format(
      date,
    );
  }

  /** Locale-aware relative time string: "Just now", "3h ago", "Yesterday", ... */
  formatRelativeTime(iso: string): string {
    const then = new Date(iso).getTime();
    if (Number.isNaN(then)) return iso;
    const diffMs = Date.now() - then;
    const diffMinutes = Math.floor(diffMs / 60000);

    if (diffMinutes < 1) return this.t("common.justNow");
    if (diffMinutes < 60) return this.t("common.minutesAgo", { n: diffMinutes });

    const diffHours = Math.floor(diffMinutes / 60);
    if (diffHours < 24) return this.t("common.hoursAgo", { n: diffHours });

    const diffDays = Math.floor(diffHours / 24);
    if (diffDays === 1) return this.t("common.yesterday");
    if (diffDays < 7) return this.t("common.daysAgo", { n: diffDays });
    if (diffDays < 14) return this.t("common.lastWeek");
    if (diffDays < 30) {
      // Prefer the RelativeTimeFormat API for weeks when available.
      try {
        const rtf = new Intl.RelativeTimeFormat(this.intlLocale, {
          numeric: "auto",
        });
        return rtf.format(-Math.floor(diffDays / 7), "week");
      } catch {
        return this.t("common.daysAgo", { n: diffDays });
      }
    }
    if (diffDays < 60) return this.t("common.lastMonth");

    return this.formatDate(iso);
  }
}

// Singleton instance shared across the whole plugin.
export const i18n = new I18nService();

/** Shorthand translation function bound to the shared singleton. */
export function t(key: string, params?: TranslationParams): string {
  return i18n.t(key, params);
}
