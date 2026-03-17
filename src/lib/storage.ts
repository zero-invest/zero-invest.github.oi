import type { FundJournal, WatchlistModel } from '../types';
import { getDefaultJournal, getDefaultWatchlistModel } from './watchlist';

const WATCHLIST_MODEL_PREFIX = 'premium-estimator:model:';
const JOURNAL_PREFIX = 'premium-estimator:journal:';
const FAVORITE_FUNDS_KEY = 'premium-estimator:favorite-funds';
const FUND_ORDER_PREFIX = 'premium-estimator:fund-order:';

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
