import type { FundJournal, WatchlistModel } from '../types';
import { getDefaultJournal, getDefaultWatchlistModel } from './watchlist';

const WATCHLIST_MODEL_PREFIX = 'premium-estimator:model:';
const JOURNAL_PREFIX = 'premium-estimator:journal:';
const FAVORITE_FUNDS_KEY = 'premium-estimator:favorite-funds';
const FUND_ORDER_PREFIX = 'premium-estimator:fund-order:';
const FUND_SORT_KEY = 'premium-estimator:fund-sort';
const DETAIL_SCROLL_PREFIX = 'premium-estimator:detail-scroll:';

export interface FundSortPreference {
  sortKey: string;
  sortDirection: 'asc' | 'desc';
}

function readJson<T>(key: string, fallback: T): T {
  if (typeof window === 'undefined') {
    return fallback;
  }

  let raw: string | null = null;

  try {
    raw = window.localStorage.getItem(key);
  } catch {
    return fallback;
  }

  if (!raw) {
    return fallback;
  }

  try {
    return { ...fallback, ...JSON.parse(raw) } as T;
  } catch {
    return fallback;
  }
}

export function readWatchlistModel(code: string): WatchlistModel {
  return readJson(`${WATCHLIST_MODEL_PREFIX}${code}`, getDefaultWatchlistModel());
}

export function writeWatchlistModel(code: string, model: WatchlistModel) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(`${WATCHLIST_MODEL_PREFIX}${code}`, JSON.stringify(model));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readFundJournal(code: string): FundJournal {
  const journal = readJson(`${JOURNAL_PREFIX}${code}`, getDefaultJournal());
  return {
    snapshots: Array.isArray(journal.snapshots) ? journal.snapshots : [],
    errors: Array.isArray(journal.errors) ? journal.errors : [],
  };
}

export function writeFundJournal(code: string, journal: FundJournal) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(`${JOURNAL_PREFIX}${code}`, JSON.stringify(journal));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readFavoriteFundCodes(): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(FAVORITE_FUNDS_KEY);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function writeFavoriteFundCodes(codes: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(FAVORITE_FUNDS_KEY, JSON.stringify(codes));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readFundOrder(pageKey: string): string[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = window.localStorage.getItem(`${FUND_ORDER_PREFIX}${pageKey}`);
    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter((item): item is string => typeof item === 'string');
  } catch {
    return [];
  }
}

export function writeFundOrder(pageKey: string, codes: string[]) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(`${FUND_ORDER_PREFIX}${pageKey}`, JSON.stringify(codes));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readFundSortPreference(): FundSortPreference | null {
  if (typeof window === 'undefined') {
    return null;
  }

  try {
    const raw = window.localStorage.getItem(FUND_SORT_KEY);
    if (!raw) {
      return null;
    }

    const parsed = JSON.parse(raw) as Partial<FundSortPreference>;
    if (typeof parsed?.sortKey !== 'string') {
      return null;
    }
    if (parsed.sortDirection !== 'asc' && parsed.sortDirection !== 'desc') {
      return null;
    }

    return {
      sortKey: parsed.sortKey,
      sortDirection: parsed.sortDirection,
    };
  } catch {
    return null;
  }
}

export function writeFundSortPreference(preference: FundSortPreference) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    window.localStorage.setItem(FUND_SORT_KEY, JSON.stringify(preference));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}

export function readDetailScrollY(code: string): number {
  if (typeof window === 'undefined' || !code) {
    return 0;
  }

  try {
    const raw = window.sessionStorage.getItem(`${DETAIL_SCROLL_PREFIX}${code}`);
    if (!raw) {
      return 0;
    }

    const parsed = Number(raw);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  } catch {
    return 0;
  }
}

export function writeDetailScrollY(code: string, scrollY: number) {
  if (typeof window === 'undefined' || !code) {
    return;
  }

  try {
    const normalized = Number.isFinite(scrollY) && scrollY > 0 ? Math.round(scrollY) : 0;
    window.sessionStorage.setItem(`${DETAIL_SCROLL_PREFIX}${code}`, String(normalized));
  } catch {
    // Ignore storage failures in restricted browser contexts.
  }
}
