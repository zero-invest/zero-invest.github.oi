import React, { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, Route, Routes, useLocation, useNavigate, useParams } from 'react-router-dom';
import { FundTable } from './components/FundTable';
import { LineChart } from './components/LineChart';
import { MetricCard } from './components/MetricCard';
import { readFavoriteFundCodes, readFundJournal, readFundOrder, readWatchlistModel, writeFavoriteFundCodes, writeFundJournal, writeFundOrder, writeWatchlistModel } from './lib/storage';
import { estimateWatchlistFund, getDefaultWatchlistModel, reconcileJournal, recordEstimateSnapshot } from './lib/watchlist';
import type { FundJournal, FundRuntimeData, FundViewModel, GithubTrafficPayload, RuntimePayload, WatchlistModel } from './types';
const FAST_SYNC_INTERVAL = 60_000;
const SLOW_SYNC_INTERVAL = 15 * 60_000;
const DEFAULT_REMOTE_API_BASE = 'https://api.leo2026.cloud/api/runtime';
const REMOTE_API_BASE = String(import.meta.env.VITE_RUNTIME_API_BASE || DEFAULT_REMOTE_API_BASE).replace(/\/+$/, '');
const GENERATED_FETCH_TIMEOUT_MS = 4500;
const TOAST_AUTO_CLOSE_MS = 3000;
const MEMBER_COPY = '非会员暂无权限查看基金详情，请先注册登录并开通会员。';

// 获取 Worker API 基础 URL（用于训练指标等 API）
function getRuntimeApiBase(): string {
  const envBase = import.meta.env.VITE_RUNTIME_API_BASE;
  if (envBase) {
    return String(envBase).replace(/\/+$/, '');
  }
  // 默认使用 Cloudflare Worker URL
  return 'https://lof-premium-rate-web-api.987144016.workers.dev';
}
type ViewCategory = 'qdii-lof' | 'domestic-lof' | 'qdii-etf' | 'domestic-etf' | 'favorites';

function isAbortLikeError(error: unknown): boolean {
  if (!error) {
    return false;
  }

  if (typeof error === 'object') {
    const name = String((error as { name?: unknown }).name || '');
    if (name === 'AbortError' || name === 'TimeoutError') {
      return true;
    }
  }

  const message = error instanceof Error ? error.message : String(error);
  const normalized = message.toLowerCase();
  return normalized.includes('aborted') || normalized.includes('aborterror') || normalized.includes('signal is aborted');
}

// 本地开发与 GitHub Pages 优先静态，其他线上环境可优先 Worker API，最后兜底静态
function isGithubPagesHost(hostname: string): boolean {
  return hostname === 'github.io' || hostname.endsWith('.github.io');
}

async function fetchGeneratedJson<T>(fileName: string): Promise<T> {
  const ts = Date.now();
  const hostname = window.location.hostname;
  const isLocal = hostname === 'localhost' || hostname === '127.0.0.1';
  const preferStaticFirst = isLocal || isGithubPagesHost(hostname);
  const allowRuntimeApi = fileName === 'funds-runtime.json';
  // 本地开发和 GitHub Pages 优先本地/静态 generated；其余线上环境 funds-runtime 优先 Worker API
  const candidates: string[] = [];
  if (preferStaticFirst) {
    candidates.push(`generated/${fileName}?ts=${ts}`);
  }
  // API 路径 — 仅 funds-runtime 走 Worker API；
  // premium-compare 的历史数据由本地脚本维护，Worker D1 中没有完整历史，
  // 因此始终走部署时打包的静态文件以保证数据完整性。
  if (!preferStaticFirst && allowRuntimeApi) {
    candidates.push(`${REMOTE_API_BASE}/all`);
  }
  // 非静态优先的线上环境保留静态兜底
  if (!preferStaticFirst) {
    candidates.push(`generated/${fileName}?ts=${ts}`);
  }

  let lastError: Error | null = null;
  for (const url of candidates) {
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), GENERATED_FETCH_TIMEOUT_MS);
    try {
      const response = await fetch(url, { cache: 'no-store', signal: controller.signal });
      if (!response.ok) throw new Error(`http-${response.status}`);
      const data = await response.json();
      if (fileName === 'funds-runtime.json') {
        return data as T;
      } else if (/^(\d+)-offline-research\.json$/.test(fileName)) {
        const resolved = data.fund || data;
        // 格式验证：确保返回的是 OfflineResearchSummary 而非 FundRuntimeData
        if (resolved && typeof resolved === 'object' && 'segmented' in resolved) {
          return resolved as T;
        }
        throw new Error('offline-research 数据格式不匹配');
      } else if (fileName === 'premium-compare.json') {
        return data as T;
      }
      throw new Error('未知数据结构');
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    } finally {
      clearTimeout(timeout);
    }
  }
  throw lastError ?? new Error(`failed to load generated/${fileName}`);
}

const PAGE_OPTIONS: Array<{ key: ViewCategory; path: string; label: string; lead: string; tableTitle: string; tableDescription: string }> = [
  {
    key: 'qdii-lof',
    path: '/qdii-lof',
    label: '跨境 LOF',
    lead: 'QDII 官方净值通常会慢一个到两个交易日，具体以净值日期列为准。本页默认优先按可获取的前十大持仓推算净值，持仓覆盖不足部分再由海外代理篮子补齐，并叠加 USD/CNY 与误差修正项。',
    tableTitle: 'QDII LOF 列表',
    tableDescription: '本页默认按“前十大持仓优先 + 代理篮子补足 + 汇率/修正因子”估值；若暂时拿不到持仓报价，则自动回退到代理篮子。点击表头可排序。',
  },
  {
    key: 'domestic-lof',
    path: '/domestic-lof',
    label: '国内 LOF',
    lead: '这一页放国内 LOF 和联接 LOF。默认优先按前十大持仓推算当日净值，持仓覆盖不足时由代理篮子补齐；若无法取得持仓报价，则回退到代理或场内信号。',
    tableTitle: '国内 LOF 列表',
    tableDescription: '国内 LOF 当前口径是：前十大持仓优先、代理篮子补足、修正因子校准；持仓不可用时回退到代理或场内信号。点击表头可排序。',
  },
  {
    key: 'qdii-etf',
    path: '/qdii-etf',
    label: '跨境 ETF',
    lead: '这一页放跨境 QDII ETF。默认采用“前十大持仓优先 + 代理篮子补足 + 汇率/修正因子”口径，场内价格主要用于展示溢价率。',
    tableTitle: 'QDII ETF 列表',
    tableDescription: 'QDII ETF 页估值口径与 QDII LOF 一致：前十大持仓优先、代理篮子补足、汇率和修正因子联合驱动。点击表头可排序。',
  },
  {
    key: 'domestic-etf',
    path: '/domestic-etf',
    label: '国内ETF',
    lead: '这一页放国内 ETF。默认优先按持仓推算净值，持仓覆盖不足时由代理篮子或场内信号补足。',
    tableTitle: '国内 ETF 列表',
    tableDescription: '国内 ETF 当前口径是：前十大持仓优先、代理篮子补足、修正因子校准；持仓不可用时回退到代理或场内信号。点击表头可排序。',
  },
  {
    key: 'favorites',
    path: '/favorites',
    label: '我的收藏',
    lead: '这里汇总你收藏的所有基金，跨 QDII/国内、LOF/ETF 统一展示，字段和交互与主列表完全一致。',
    tableTitle: '我的收藏列表',
    tableDescription: '收藏页与主列表同款：同列、同排序、同收藏星标、同拖拽调整。',
  },
];

const DESKTOP_SHELL_NAV = [
  { label: '跨境 LOF', to: '/qdii-lof' },
  { label: '国内 LOF', to: '/domestic-lof' },
  { label: '跨境 ETF', to: '/qdii-etf' },
  { label: '国内 ETF', to: '/domestic-etf' },
  { label: '我的收藏', to: '/favorites' },
  { label: '会员中心', to: '/member' },
  { label: '说明文档', to: '/docs' },
  { label: '访客趋势', to: '/traffic' },
];

function DesktopShell({
  currentPath,
  currentUser,
  title,
  subtitle,
  actions,
  children,
}: {
  currentPath: string;
  currentUser: AuthUser | null;
  title: string;
  subtitle: string;
  actions?: React.ReactNode;
  children: React.ReactNode;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [isDark, setIsDark] = useState<boolean>(() => {
    if (typeof window === 'undefined') return false;
    return window.localStorage.getItem('premium-theme') === 'dark';
  });
  const [sidebarWidth, setSidebarWidth] = useState<number>(() => {
    if (typeof window === 'undefined') return 220;
    const saved = Number(window.localStorage.getItem('premium-sidebar-width') || '220');
    return Number.isFinite(saved) ? Math.min(320, Math.max(180, saved)) : 220;
  });

  useEffect(() => {
    document.documentElement.dataset.theme = isDark ? 'dark' : 'light';
    window.localStorage.setItem('premium-theme', isDark ? 'dark' : 'light');
  }, [isDark]);

  useEffect(() => {
    document.documentElement.style.setProperty('--sidebar-width', `${sidebarWidth}px`);
    window.localStorage.setItem('premium-sidebar-width', String(sidebarWidth));
  }, [sidebarWidth]);

  const startSidebarResize = (event: React.MouseEvent<HTMLDivElement>) => {
    event.preventDefault();
    const startX = event.clientX;
    const startWidth = sidebarWidth;

    const handleMove = (moveEvent: MouseEvent) => {
      const next = Math.min(320, Math.max(180, startWidth + moveEvent.clientX - startX));
      setSidebarWidth(next);
    };

    const handleUp = () => {
      window.removeEventListener('mousemove', handleMove);
      window.removeEventListener('mouseup', handleUp);
    };

    window.addEventListener('mousemove', handleMove);
    window.addEventListener('mouseup', handleUp);
  };

  return (
    <main className="dashboard-shell">
      <button className="mobile-shell-toggle" type="button" onClick={() => setMenuOpen((value) => !value)}>
        ☰ 菜单
      </button>
      <aside className="dashboard-sidebar">
        <div className="dashboard-brand">
          <span className="dashboard-brand__mark">◆</span>
          <div>
            <strong>Premium</strong>
          </div>
        </div>
        <nav className="dashboard-nav">
          {DESKTOP_SHELL_NAV.map((item) => (
            <Link key={item.to} className={`dashboard-nav__item${currentPath === item.to ? ' dashboard-nav__item--active' : ''}`} to={item.to}>
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="dashboard-sidebar__footer">
          <span>{currentUser ? `当前状态：${currentUser.nickname}` : '当前状态：游客'}</span>
          <small>{currentUser ? `会员状态：${currentUser.membership.isActive ? `有效，至 ${formatMemberExpiry(currentUser.membership.expiresAt)}` : '未开通'}` : '会员状态：未登录'}</small>
          <span className="dashboard-sidebar__promo">
            公众号：利奥的笔记
          </span>
        </div>
        <div className="dashboard-sidebar__resizer" onMouseDown={startSidebarResize} />
      </aside>
      {menuOpen ? (
        <div className="mobile-shell-drawer">
          <div className="dashboard-brand">
            <span className="dashboard-brand__mark">◆</span>
            <div>
              <strong>Premium</strong>
            </div>
          </div>
          <nav className="dashboard-nav">
            {DESKTOP_SHELL_NAV.map((item) => (
              <Link key={item.to} className={`dashboard-nav__item${currentPath === item.to ? ' dashboard-nav__item--active' : ''}`} to={item.to} onClick={() => setMenuOpen(false)}>
                {item.label}
              </Link>
            ))}
          </nav>
        </div>
      ) : null}
      <section className="dashboard-main">
        <header className="dashboard-topbar">
          <h1>{title}</h1>
          <div className="dashboard-topbar__icons">
            <button className="dashboard-icon-button" type="button" onClick={() => setIsDark((value) => !value)} aria-label="切换明暗模式">
              {isDark ? '☀' : '◐'}
            </button>
            <Link className="dashboard-text-button dashboard-text-button--member" to="/member">
              会员中心
            </Link>
            {currentUser ? (
              <button className="dashboard-icon-button dashboard-icon-button--logout" type="button" onClick={() => { void fetchApi('/api/auth/logout', { method: 'POST' }).then(() => window.location.reload()).catch(() => window.location.reload()); }} aria-label="退出登录" title="退出登录">
                <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4" /><polyline points="16 17 21 12 16 7" /><line x1="21" y1="12" x2="9" y2="12" /></svg>
              </button>
            ) : null}
          </div>
        </header>
        {children}
      </section>
    </main>
  );
}

const HOLDINGS_SIGNAL_MIN_COVERAGE_BY_CODE: Record<string, number> = {
  '513310': 0.55,
  '161128': 0.65,
};

function getZonedClock(date: Date, timeZone: string) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((item) => item.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((item) => item.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((item) => item.type === 'minute')?.value ?? '0');

  return {
    weekday,
    minutes: hour * 60 + minute,
  };
}

function isWeekday(weekday: string) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
}

function isCnTradingSession(date: Date) {
  const clock = getZonedClock(date, 'Asia/Shanghai');
  if (!isWeekday(clock.weekday)) {
    return false;
  }

  return (clock.minutes >= 9 * 60 + 30 && clock.minutes < 11 * 60 + 30) || (clock.minutes >= 13 * 60 && clock.minutes < 15 * 60);
}

function isUsTradingSession(date: Date) {
  const clock = getZonedClock(date, 'America/New_York');
  if (!isWeekday(clock.weekday)) {
    return false;
  }

  return clock.minutes >= 9 * 60 + 30 && clock.minutes < 16 * 60;
}

function getRuntimeRefreshInterval(now = new Date()) {
  return isCnTradingSession(now) || isUsTradingSession(now) ? FAST_SYNC_INTERVAL : SLOW_SYNC_INTERVAL;
}

interface AuthUser {
  id: number;
  accountId: string;
  accountType: string;
  nickname: string;
  inviteCode: string;
  inviteRewardDeadlineAt: string;
  membership: {
    isActive: boolean;
    expiresAt: string;
    trialGrantedAt: string;
  };
}

async function fetchApi<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${getRuntimeApiBase()}${path}`, {
    credentials: 'include',
    headers: {
      'content-type': 'application/json',
      ...(init?.headers || {}),
    },
    ...init,
  });
  const data = await response.json();
  if (!response.ok || data?.ok === false) {
    throw new Error(data?.error || `http-${response.status}`);
  }
  return data as T;
}

function formatMemberExpiry(value: string) {
  if (!value) return '未开通';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '未开通';
  return date.toLocaleString('zh-CN', { hour12: false });
}

function formatCurrency(value: number): string {
  return value.toFixed(4);
}

function formatPercent(value: number): string {
  return `${(value * 100).toFixed(2)}%`;
}

function formatBps(value: number): string {
  return `${(value * 10000).toFixed(1)} bp`;
}

function getMarketChangeRate(runtime: FundRuntimeData): number {
  return runtime.previousClose > 0 ? runtime.marketPrice / runtime.previousClose - 1 : 0;
}

function formatOptionalCurrency(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatCurrency(value) : '--';
}

function formatOptionalChangeRate(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? formatPercent(value) : '--';
}

function formatHoldingWeight(value?: number): string {
  return typeof value === 'number' && Number.isFinite(value) ? `${value.toFixed(2)}%` : '--';
}

function normalizeWatchlistModel(input: Partial<WatchlistModel> | undefined): WatchlistModel {
  const fallback = getDefaultWatchlistModel();
  const source = input ?? {};
  const pickNumber = (value: unknown, fallbackValue: number) => (typeof value === 'number' && Number.isFinite(value) ? value : fallbackValue);

  return {
    alpha: pickNumber(source.alpha, fallback.alpha),
    betaLead: pickNumber(source.betaLead, fallback.betaLead),
    betaGap: pickNumber(source.betaGap, fallback.betaGap),
      betaIntraday: pickNumber(source.betaIntraday, fallback.betaIntraday),
    learningRate: pickNumber(source.learningRate, fallback.learningRate),
    sampleCount: pickNumber(source.sampleCount, fallback.sampleCount),
    meanAbsError: pickNumber(source.meanAbsError, fallback.meanAbsError),
    lastUpdatedAt: typeof source.lastUpdatedAt === 'string' ? source.lastUpdatedAt : undefined,
  };
}

function normalizeFundJournal(input: Partial<FundJournal> | undefined): FundJournal {
  return {
    snapshots: Array.isArray(input?.snapshots) ? input.snapshots : [],
    errors: Array.isArray(input?.errors) ? input.errors : [],
  };
}

function formatDateTime(value: string): string {
  if (!value) {
    return '--';
  }

  return new Date(value).toLocaleString();
}

function formatRuntimeTime(date: string, time: string): string {
  const merged = `${date || '--'} ${time || ''}`.trim();
  return merged || '--';
}

const AUTHING_DOMAIN = 'https://sicfljueranf-demo.authing.cn';
const AUTHING_APP_ID = '69c768cd00a8bf9c4493e994';
const AUTHING_CALLBACK_PATH = '/auth/callback';

function getAuthingCallbackUrl(): string {
  if (typeof window === 'undefined') {
    return `http://localhost:5173${AUTHING_CALLBACK_PATH}`;
  }
  return `${window.location.origin}${AUTHING_CALLBACK_PATH}`;
}

function buildAuthingAuthorizeUrl(hint: 'login' | 'register' = 'login'): string {
  const state = JSON.stringify({ hint, returnTo: '/member', ts: Date.now() });
  const params = new URLSearchParams({
    client_id: AUTHING_APP_ID,
    response_type: 'code',
    scope: 'openid profile email phone',
    redirect_uri: getAuthingCallbackUrl(),
    state,
  });
  return `${AUTHING_DOMAIN}/oidc/auth?${params.toString()}`;
}

function getDefaultGithubTrafficPayload(): GithubTrafficPayload {
  return {
    generatedAt: '',
    source: 'github-traffic-api',
    repo: '',
    available: false,
    reason: '',
    recent7: {
      days: [],
      viewCount: 0,
      viewUniques: 0,
      cloneCount: 0,
      cloneUniques: 0,
    },
    totals: {
      viewCount: 0,
      viewUniques: 0,
      cloneCount: 0,
      cloneUniques: 0,
    },
    snapshots: [],
  };
}

function getHoursSinceSync(syncedAt: string): number | null {
  if (!syncedAt) {
    return null;
  }

  const syncedAtMs = new Date(syncedAt).getTime();
  if (!Number.isFinite(syncedAtMs)) {
    return null;
  }

  return Math.max(0, (Date.now() - syncedAtMs) / (1000 * 60 * 60));
}

function sumTrafficMetric(days: Array<{ viewCount?: number; viewUniques?: number; cloneCount?: number; cloneUniques?: number }>, key: 'viewCount' | 'viewUniques' | 'cloneCount' | 'cloneUniques') {
  return days.reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);
}

function getRecent7TrafficFallback(traffic: GithubTrafficPayload) {
  const sourceDays = (traffic.recent7?.days?.length
    ? traffic.recent7.days
    : ((traffic.snapshots?.length ? traffic.snapshots : traffic.last14Days) ?? [])
  ).slice(-7);

  return {
    viewUniques: Number(traffic.recent7?.viewUniques) || sumTrafficMetric(sourceDays, 'viewUniques'),
    viewCount: Number(traffic.recent7?.viewCount) || sumTrafficMetric(sourceDays, 'viewCount'),
  };
}

interface PublicTrafficCounterDay {
  date: string;
  uniqueDevices: number;
}

interface PublicTrafficCounter {
  available: boolean;
  source: string;
  totalUniqueDevices: number;
  todayUniqueDevices: number;
  active7UniqueDevices: number;
  days: PublicTrafficCounterDay[];
  reason?: string;
}

const COUNTAPI_ENDPOINTS = ['https://api.countapi.xyz', 'https://countapi.xyz'];
const COUNTAPI_NAMESPACE = 'lof-premium-rate-web';
const COUNTAPI_TOTAL_KEY = 'uv-total-devices';
const COUNTAPI_DAILY_PREFIX = 'uv-day-';
const COUNTAPI_ACTIVE7_BUCKET_PREFIX = 'uv-active7-bucket-';
const LOCAL_DEVICE_DAILY_MARK_PREFIX = 'traffic-device-daily-hit-';
const LOCAL_DEVICE_7D_MARK_PREFIX = 'traffic-device-7d-hit-';

function getDefaultPublicTrafficCounter(): PublicTrafficCounter {
  return {
    available: false,
    source: 'countapi',
    totalUniqueDevices: 0,
    todayUniqueDevices: 0,
    active7UniqueDevices: 0,
    days: [],
    reason: '',
  };
}

function getCstDateKey(date: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(date);
}

function getRecentCstDateKeys(dayCount: number): string[] {
  const now = new Date();
  return Array.from({ length: dayCount }, (_, index) => {
    const next = new Date(now);
    next.setDate(now.getDate() - (dayCount - 1 - index));
    return getCstDateKey(next);
  });
}

function parseCstDayIndex(dateKey: string): number {
  const [year, month, day] = dateKey.split('-').map((item) => Number(item));
  if (!year || !month || !day) {
    return 0;
  }
  return Math.floor(Date.UTC(year, month - 1, day) / 86_400_000);
}

function hasDeviceDailyCounterMark(dateKey: string): boolean {
  try {
    const markerKey = `${LOCAL_DEVICE_DAILY_MARK_PREFIX}${dateKey}`;
    return Boolean(window.localStorage.getItem(markerKey));
  } catch {
    return false;
  }
}

function markDeviceDailyCounter(dateKey: string) {
  try {
    const markerKey = `${LOCAL_DEVICE_DAILY_MARK_PREFIX}${dateKey}`;
    window.localStorage.setItem(markerKey, '1');
  } catch {
    // ignore local storage failures
  }
}

function hasDevice7dCounterMark(bucketKey: string): boolean {
  try {
    const markerKey = `${LOCAL_DEVICE_7D_MARK_PREFIX}${bucketKey}`;
    return Boolean(window.localStorage.getItem(markerKey));
  } catch {
    return false;
  }
}

function markDevice7dCounter(bucketKey: string) {
  try {
    const markerKey = `${LOCAL_DEVICE_7D_MARK_PREFIX}${bucketKey}`;
    window.localStorage.setItem(markerKey, '1');
  } catch {
    // ignore local storage failures
  }
}

async function requestCountApiValue(key: string, mode: 'get' | 'hit'): Promise<{ value: number; ok: boolean }> {
  for (const endpoint of COUNTAPI_ENDPOINTS) {
    const controller = new AbortController();
    const timeout = window.setTimeout(() => controller.abort(), 6000);
    try {
      const response = await fetch(`${endpoint}/${mode}/${COUNTAPI_NAMESPACE}/${key}`, {
        cache: 'no-store',
        signal: controller.signal,
      });
      if (!response.ok) {
        continue;
      }
      const payload = (await response.json()) as { value?: number };
      return { value: Number(payload?.value) || 0, ok: true };
    } catch {
      const relayUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(`${endpoint}/${mode}/${COUNTAPI_NAMESPACE}/${key}`)}`;
      try {
        const relayResponse = await fetch(relayUrl, {
          cache: 'no-store',
          signal: controller.signal,
        });
        if (!relayResponse.ok) {
          continue;
        }
        const relayPayload = (await relayResponse.json()) as { value?: number };
        return { value: Number(relayPayload?.value) || 0, ok: true };
      } catch {
        continue;
      }
    } finally {
      window.clearTimeout(timeout);
    }
  }

  return { value: 0, ok: false };
}

async function loadPublicTrafficCounter(): Promise<PublicTrafficCounter> {
  const today = getCstDateKey(new Date());
  const todayIndex = parseCstDayIndex(today);
  const active7Bucket = String(Math.floor(todayIndex / 7));
  const dayKeys = getRecentCstDateKeys(7);
  const dailyMarked = hasDeviceDailyCounterMark(today);
  const active7Marked = hasDevice7dCounterMark(active7Bucket);

  let [totalUniqueRes, todayUniqueRes, active7UniqueRes, dayValues] = await Promise.all([
    requestCountApiValue(COUNTAPI_TOTAL_KEY, dailyMarked ? 'get' : 'hit'),
    requestCountApiValue(`${COUNTAPI_DAILY_PREFIX}${today}`, dailyMarked ? 'get' : 'hit'),
    requestCountApiValue(`${COUNTAPI_ACTIVE7_BUCKET_PREFIX}${active7Bucket}`, active7Marked ? 'get' : 'hit'),
    Promise.all(dayKeys.map(async (dateKey) => {
      const daily = await requestCountApiValue(`${COUNTAPI_DAILY_PREFIX}${dateKey}`, 'get');
      return { date: dateKey, uniqueDevices: daily.value };
    })),
  ]);

  const countApiReachable = totalUniqueRes.ok || todayUniqueRes.ok || active7UniqueRes.ok;
  if (countApiReachable) {
    // Recover from old bug: marker existed but never really hit counter.
    if (dailyMarked && totalUniqueRes.value <= 0 && todayUniqueRes.value <= 0) {
      const [recoveryTotal, recoveryToday] = await Promise.all([
        requestCountApiValue(COUNTAPI_TOTAL_KEY, 'hit'),
        requestCountApiValue(`${COUNTAPI_DAILY_PREFIX}${today}`, 'hit'),
      ]);
      if (recoveryTotal.ok) {
        totalUniqueRes = recoveryTotal;
      }
      if (recoveryToday.ok) {
        todayUniqueRes = recoveryToday;
      }
    }
    if (active7Marked && active7UniqueRes.value <= 0) {
      const recoveryActive7 = await requestCountApiValue(`${COUNTAPI_ACTIVE7_BUCKET_PREFIX}${active7Bucket}`, 'hit');
      if (recoveryActive7.ok) {
        active7UniqueRes = recoveryActive7;
      }
    }

    if (!dailyMarked && totalUniqueRes.ok && todayUniqueRes.ok && (totalUniqueRes.value > 0 || todayUniqueRes.value > 0)) {
      markDeviceDailyCounter(today);
    }
    if (!active7Marked && active7UniqueRes.ok && active7UniqueRes.value > 0) {
      markDevice7dCounter(active7Bucket);
    }

    dayValues = dayValues.map((item) => (item.date === today
      ? { ...item, uniqueDevices: Math.max(item.uniqueDevices, todayUniqueRes.value) }
      : item));

    const available = totalUniqueRes.value > 0 || todayUniqueRes.value > 0 || active7UniqueRes.value > 0 || dayValues.some((item) => item.uniqueDevices > 0);
    return {
      available,
      source: 'countapi-device-uv',
      totalUniqueDevices: totalUniqueRes.value,
      todayUniqueDevices: todayUniqueRes.value,
      active7UniqueDevices: active7UniqueRes.value,
      days: dayValues,
      reason: available ? '' : 'countapi-empty',
    };
  }
  return {
    available: false,
    source: 'countapi',
    totalUniqueDevices: 0,
    todayUniqueDevices: 0,
    active7UniqueDevices: 0,
    days: dayKeys.map((dateKey) => ({ date: dateKey, uniqueDevices: 0 })),
    reason: 'countapi-unreachable',
  };
}

function getPageOption(pageCategory: ViewCategory) {
  return PAGE_OPTIONS.find((item) => item.key === pageCategory) ?? PAGE_OPTIONS[0];
}

function isQdiiEtfFund(fund: FundViewModel) {
  if (fund.runtime.pageCategory !== 'etf') {
    return false;
  }

  const text = `${fund.runtime.name || ''} ${fund.runtime.benchmark || ''} ${fund.runtime.fundType || ''}`;
  return /QDII|纳斯达克|标普|道琼斯|日经|TOPIX|德国|巴西|沙特|东南亚|全球|美国|港美|油气|生物科技/i.test(text);
}

function hasAnnouncedHoldingsSignal(runtime: FundRuntimeData) {
  const disclosedHoldings = runtime.disclosedHoldings ?? [];
  const requiredCount = Math.min(10, disclosedHoldings.length);
  if (requiredCount <= 0) {
    return false;
  }

  const quotedTickers = new Set(
    (runtime.holdingQuotes ?? [])
      .filter((item) => Number.isFinite(item.currentPrice) && item.currentPrice > 0 && Number.isFinite(item.previousClose) && item.previousClose > 0)
      .map((item) => item.ticker.toUpperCase()),
  );

  const coveredCount = disclosedHoldings
    .slice(0, requiredCount)
    .filter((item) => quotedTickers.has(String(item.ticker || '').toUpperCase())).length;
  const strictCoverage = coveredCount >= requiredCount;
  if (strictCoverage) {
    return true;
  }

  const minCoverage = HOLDINGS_SIGNAL_MIN_COVERAGE_BY_CODE[runtime.code];
  if (!Number.isFinite(minCoverage)) {
    return false;
  }

  return coveredCount >= Math.min(3, requiredCount) && getAnnouncedHoldingsCoveragePercent(runtime) / 100 >= minCoverage;
}

function getAnnouncedHoldingsCoveragePercent(runtime: FundRuntimeData) {
  const disclosedHoldings = runtime.disclosedHoldings ?? [];
  if (!disclosedHoldings.length) {
    return 0;
  }

  const quotedTickers = new Set(
    (runtime.holdingQuotes ?? [])
      .filter((item) => Number.isFinite(item.currentPrice) && item.currentPrice > 0 && Number.isFinite(item.previousClose) && item.previousClose > 0)
      .map((item) => item.ticker.toUpperCase()),
  );

  const requiredHoldings = disclosedHoldings.slice(0, Math.min(10, disclosedHoldings.length));
  const coveredWeight = requiredHoldings.reduce((sum, item) => {
    if (!quotedTickers.has(String(item.ticker || '').toUpperCase())) {
      return sum;
    }

    return sum + Math.max(0, Number(item.weight) || 0);
  }, 0);

  return Math.max(0, Math.min(100, coveredWeight));
}

function getTop10DisclosedWeightPercent(runtime: FundRuntimeData) {
  const disclosedHoldings = runtime.disclosedHoldings ?? [];
  if (!disclosedHoldings.length) {
    return 0;
  }

  return disclosedHoldings
    .slice(0, 10)
    .reduce((sum, item) => sum + Math.max(0, Number(item.weight) || 0), 0);
}

class AppErrorBoundary extends React.Component<React.PropsWithChildren, { hasError: boolean }> {
  constructor(props: React.PropsWithChildren) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  render() {
    if (this.state.hasError) {
      return (
        <main className="page">
          <section className="panel notice-panel">
            详情页渲染失败。通常是浏览器还缓存着旧页面资源，先强制刷新一次；如果仍然异常，再稍后重试。
          </section>
        </main>
      );
    }

    return this.props.children;
  }
}

function getEstimateDriverLabels(runtime: FundRuntimeData) {
  return hasAnnouncedHoldingsSignal(runtime)
    ? {
        summary: `该基金当前按公告披露持仓（最多前十条）估值；披露权重覆盖约 ${getAnnouncedHoldingsCoveragePercent(runtime).toFixed(2)}% 时，剩余仓位用代理篮子补足，海外资产同步计入 USD/CNY 变化。`,
        primaryFactor: '公告持仓涨跌幅（主）+ 代理篮子（补）',
        secondaryFactor: runtime.pageCategory === 'qdii-lof' ? 'USD/CNY 变化' : '学习修正项',
      }
    : runtime.estimateMode === 'proxy'
    ? {
        summary: `该基金当前按 ${runtime.proxyBasketName || '代理篮子'} + USD/CNY 推算净值，场内价格只用于计算溢价率。`,
        primaryFactor: '代理篮子涨跌幅',
        secondaryFactor: 'USD/CNY 变化',
      }
    : {
        summary: '该基金当前按最近官方净值锚点、场内日内涨跌幅和误差历史做盘中指示估值。',
        primaryFactor: '场内涨跌幅',
        secondaryFactor: '昨收相对净值偏离',
      };
}

interface AlgoVariant {
  key: string;
  label: string;
  alpha: number;
  betaLead: number;
  betaGap: number;
}

interface AlgoScore {
  variant: AlgoVariant;
  sampleCount: number;
  maeAll: number;
  mae30: number;
  maeRecent: number;
  estimatedNav: number;
  premiumRate: number;
}

interface FeatureRow {
  date: string;
  anchorNav: number;
  actualNav: number;
  leadReturn: number;
  closeGapReturn: number;
  targetReturn: number;
}

interface ResearchPoint {
  date: string;
  actualNav: number;
  predictedNav: number;
  absError: number;
}

interface ResearchCandidate {
  key: string;
  label: string;
  mode: 'path-adjust' | 'time-series';
  trainPoints: ResearchPoint[];
  validationPoints: ResearchPoint[];
  maeTrain: number;
  maeValidation: number;
  maeValidation30: number;
}

interface VolatilityBucketStat {
  label: string;
  count: number;
  mae: number;
  avgVol: number;
}

interface VolatilityDiagnostics {
  trainRange: string;
  validationRange: string;
  train: VolatilityBucketStat[];
  validation: VolatilityBucketStat[];
  summary: string;
}

interface OfflineResearchSummary {
  code: string;
  generatedAt: string;
  splitMode: string;
  method?: string;
  explanation?: string;
  fallbackMode?: string;
  disclosureCount: number;
  usedQuoteTickers?: string[];
  avgHoldingCoverage?: number;
  trainRange: string;
  validationRange: string;
  segmented: {
    maeTrain: number;
    maeValidation: number;
    maeValidation30: number;
    maeValidation30Robust?: number;
    maeValidationWeighted?: number;
    maeValidation30Weighted?: number;
  };
  dualObjective: {
    mode: string;
    lambda: number;
    maeValidation: number;
    maeValidation30: number;
    premiumProxyValidation?: number;
  };
  chartPath: string;
  notes: string;
}

interface TrainingMetricSummary {
  maeTrain: number;
  maeValidation: number;
  maeValidation30: number;
  maeValidation30Robust?: number;
  generatedAt: string;
}

interface PremiumCompareProviderRow {
  provider: string;
  sourceUrl: string;
  status: string;
  premiumRateCurrent?: number | null;
  hitCount60?: number;
  avgAbsProviderError30: number | null;
  avgAbsOurError30: number | null;
  avgAbsDelta30: number | null;
  settledCount30?: number;
  settledWindowSize?: number;
  sampleCount30: number;
}

interface PremiumCompareProviderDailyRow {
  date: string;
  time: string;
  marketPrice: number | null;
  providerPremiumRate: number;
  ourReportedPremiumRate: number | null;
  status: 'settled' | 'pending';
  actualPremiumRate: number | null;
  providerPremiumError: number | null;
  ourPremiumError: number | null;
  premiumErrorDelta: number | null;
}

interface PremiumCompareEastmoneyRow {
  date: string;
  time: string;
  marketPrice: number;
  providerPremiumRate: number;
  providerEstimatedNav: number | null;
  status: 'settled' | 'pending';
  actualNav: number | null;
  providerNavError: number | null;
  ourReportedPremiumRate: number | null;
  ourEstimatedNav: number | null;
  ourNavError: number | null;
}

interface PremiumCompareCodePayload {
  code: string;
  name: string;
  snapshotAt: string;
  ourPremiumRate: number | null;
  ourPremiumSummary?: {
    settledCount30: number;
    settledWindowSize: number;
    avgAbsOurError30: number | null;
  };
  eastmoneyDailyValuations?: PremiumCompareEastmoneyRow[];
  providerDailyComparisons?: Record<string, PremiumCompareProviderDailyRow[]>;
  providers: PremiumCompareProviderRow[];
}

interface PremiumComparePayload {
  generatedAt: string;
  syncedAt: string;
  codes: Record<string, PremiumCompareCodePayload>;
}

const OFFLINE_RESEARCH_CODES = new Set(['160216', '160723', '161725', '501018', '161129', '160719', '161116', '164701', '501225', '513310', '161130', '160416', '162719', '162411', '161125', '161126', '161127', '162415', '159329', '513080', '520830', '513730', '164824', '160644', '159100', '520870', '160620', '161217', '161124', '501300', '160140', '520580', '159509', '501312', '501011', '501050', '160221', '165520', '167301', '161226', '161128', '513800', '513880', '513520', '513100', '513500', '159502', '513290', '159561', '513030', '513850', '513300', '159518', '163208', '159577', '513400', '159985', '168204', '501036', '501043', '160807', '161607', '161039']);
const PREMIUM_COMPARE_DETAIL_CODES = new Set(['160723', '501018', '161129', '160416', '501225', '162719', '161128', '161125', '163208', '161126', '162411', '161130', '162415', '161116', '501312', '160719', '164701']);
const PREMIUM_PROVIDER_LABELS: Record<string, string> = {
  'eastmoney-fundgz': '东方财富 fundgz',
  'eastmoney-quote': '东方财富行情',
  etfpro: 'ETFPRO',
  sina: '新浪',
  xueqiu: '雪球',
  'manual-jiuquaner': '韭圈儿(手工)',
  'manual-xueqiu': '雪球(手工)',
  'manual-sina-finance': '新浪财经(手工)',
  'manual-huatai': '华泰(手工)',
  'manual-huabao': '华宝(手工)',
  'manual-xiaobeiyangji': '小倍养基(手工)',
  'manual-haoetf': 'HaoETF(手工)',
  'manual-hs': '同花顺(手工)',
  'manual-hslof': '同花顺LOF(手工)',
  'manual-wind': '万得Wind(手工)',
};

function getPremiumProviderLabel(provider: string) {
  const key = String(provider || '').trim();
  if (PREMIUM_PROVIDER_LABELS[key]) {
    return PREMIUM_PROVIDER_LABELS[key];
  }
  if (key === 'manual-haoetf') {
    return 'HaoETF(手工)';
  }
  if (key.startsWith('manual-')) {
    return `${key.replace('manual-', '')}(手工)`;
  }
  return key || '未知来源';
}

function getEstimatedNavFromPremium(marketPrice: number | null | undefined, premiumRate: number | null | undefined): number | null {
  if (typeof marketPrice !== 'number' || !Number.isFinite(marketPrice) || marketPrice <= 0) {
    return null;
  }
  if (typeof premiumRate !== 'number' || !Number.isFinite(premiumRate)) {
    return null;
  }

  const denominator = 1 + premiumRate;
  if (!Number.isFinite(denominator) || Math.abs(denominator) < 1e-9) {
    return null;
  }

  const estimatedNav = marketPrice / denominator;
  return Number.isFinite(estimatedNav) ? estimatedNav : null;
}

function getPointsDateRange(points: ResearchPoint[]) {
  if (!points.length) {
    return '-- ~ --';
  }

  return `${points[0].date} ~ ${points[points.length - 1].date}`;
}

function formatDateRange<T extends { date: string }>(rows: T[]) {
  if (!rows.length) {
    return '-- ~ --';
  }

  return `${rows[0].date} ~ ${rows[rows.length - 1].date}`;
}

function average(values: number[]) {
  if (!values.length) {
    return Number.NaN;
  }

  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function solveLinearSystem(matrix: number[][], vector: number[]): number[] | null {
  const n = matrix.length;
  if (!n || vector.length !== n) {
    return null;
  }

  const a = matrix.map((row, rowIndex) => [...row, vector[rowIndex]]);

  for (let col = 0; col < n; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < n; row += 1) {
      if (Math.abs(a[row][col]) > Math.abs(a[pivot][col])) {
        pivot = row;
      }
    }

    if (Math.abs(a[pivot][col]) < 1e-12) {
      return null;
    }

    [a[col], a[pivot]] = [a[pivot], a[col]];
    const pivotValue = a[col][col];
    for (let j = col; j <= n; j += 1) {
      a[col][j] /= pivotValue;
    }

    for (let row = 0; row < n; row += 1) {
      if (row === col) {
        continue;
      }

      const factor = a[row][col];
      if (Math.abs(factor) < 1e-12) {
        continue;
      }

      for (let j = col; j <= n; j += 1) {
        a[row][j] -= factor * a[col][j];
      }
    }
  }

  return a.map((row) => row[n]);
}

function fitLinearWeights(features: number[][], targets: number[], ridge = 0): number[] | null {
  if (!features.length || features.length !== targets.length) {
    return null;
  }

  const dim = features[0].length;
  const xtx = Array.from({ length: dim }, () => Array(dim).fill(0));
  const xty = Array(dim).fill(0);

  for (let i = 0; i < features.length; i += 1) {
    const x = features[i];
    const y = targets[i];
    for (let r = 0; r < dim; r += 1) {
      xty[r] += x[r] * y;
      for (let c = 0; c < dim; c += 1) {
        xtx[r][c] += x[r] * x[c];
      }
    }
  }

  for (let i = 0; i < dim; i += 1) {
    xtx[i][i] += ridge;
  }

  return solveLinearSystem(xtx, xty);
}

function fitHuberIrls(features: number[][], targets: number[], delta: number, ridge = 0.6, iterations = 6): number[] | null {
  if (!features.length || features.length !== targets.length) {
    return null;
  }

  const dim = features[0].length;
  let weights = fitLinearWeights(features, targets, ridge) ?? Array(dim).fill(0);

  for (let iter = 0; iter < iterations; iter += 1) {
    const weightedFeatures: number[][] = [];
    const weightedTargets: number[] = [];

    for (let i = 0; i < features.length; i += 1) {
      const x = features[i];
      const y = targets[i];
      const prediction = x.reduce((sum, value, index) => sum + value * (weights[index] ?? 0), 0);
      const residual = y - prediction;
      const absResidual = Math.abs(residual);
      const robustWeight = absResidual <= delta ? 1 : delta / Math.max(absResidual, 1e-6);
      const scale = Math.sqrt(robustWeight);

      weightedFeatures.push(x.map((value) => value * scale));
      weightedTargets.push(y * scale);
    }

    const next = fitLinearWeights(weightedFeatures, weightedTargets, ridge);
    if (!next) {
      break;
    }

    weights = next;
  }

  return weights;
}

function buildFeatureRows(fund: FundViewModel): FeatureRow[] {
  const snapshotsByDate = new Map(fund.journal.snapshots.map((item) => [item.estimateDate, item]));
  return fund.journal.errors
    .map((errorPoint) => {
      const snapshot = snapshotsByDate.get(errorPoint.date);
      if (!snapshot || snapshot.anchorNav <= 0 || errorPoint.actualNav <= 0) {
        return null;
      }

      return {
        date: errorPoint.date,
        anchorNav: snapshot.anchorNav,
        actualNav: errorPoint.actualNav,
        leadReturn: snapshot.leadReturn,
        closeGapReturn: snapshot.closeGapReturn,
        targetReturn: errorPoint.actualNav / snapshot.anchorNav - 1,
      };
    })
    .filter((item): item is FeatureRow => Boolean(item))
    .sort((left, right) => left.date.localeCompare(right.date));
}

function splitTrainValidationByYear<T extends { date: string }>(rows: T[]): { train: T[]; validation: T[] } {
  const train = rows.filter((item) => item.date.startsWith('2025-'));
  const validation = rows.filter((item) => item.date >= '2026-01-01');

  if (train.length && validation.length) {
    return { train, validation };
  }

  const splitIndex = Math.max(1, Math.floor(rows.length * 0.7));
  return {
    train: rows.slice(0, splitIndex),
    validation: rows.slice(splitIndex),
  };
}

function quantile(values: number[], q: number): number {
  if (!values.length) {
    return 0;
  }

  const sorted = [...values].sort((left, right) => left - right);
  const index = Math.max(0, Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * q)));
  return sorted[index];
}

function buildVolatilityDiagnostics(fund: FundViewModel): VolatilityDiagnostics | null {
  const features = buildFeatureRows(fund);
  if (features.length < 40) {
    return null;
  }

  const errorByDate = new Map(fund.journal.errors.map((item) => [item.date, item.absError]));
  const rows = features
    .map((item) => ({
      date: item.date,
      vol: Math.abs(item.leadReturn) + 0.8 * Math.abs(item.closeGapReturn),
      absError: errorByDate.get(item.date) ?? Number.NaN,
    }))
    .filter((item) => Number.isFinite(item.absError));

  if (rows.length < 20) {
    return null;
  }

  const split = splitTrainValidationByYear(rows);
  const q1 = quantile(split.train.map((item) => item.vol), 0.33);
  const q2 = quantile(split.train.map((item) => item.vol), 0.66);

  const summarize = (dataset: typeof rows): VolatilityBucketStat[] => {
    const buckets = [
      { label: '低波动', rows: dataset.filter((item) => item.vol < q1) },
      { label: '中波动', rows: dataset.filter((item) => item.vol >= q1 && item.vol < q2) },
      { label: '高波动', rows: dataset.filter((item) => item.vol >= q2) },
    ];

    return buckets.map((bucket) => ({
      label: bucket.label,
      count: bucket.rows.length,
      mae: average(bucket.rows.map((item) => item.absError)),
      avgVol: average(bucket.rows.map((item) => item.vol)),
    }));
  };

  const trainStats = summarize(split.train);
  const validationStats = summarize(split.validation);
  const worstValidation = [...validationStats]
    .filter((item) => item.count > 0 && Number.isFinite(item.mae))
    .sort((left, right) => right.mae - left.mae)[0];

  const summary = worstValidation
    ? `验证集误差最高的是${worstValidation.label}区间（MAE ${formatPercent(worstValidation.mae)}，样本 ${worstValidation.count}），建议该区间优先使用“分波动状态/鲁棒”模型。`
    : '样本不足，暂无法形成波动诊断结论。';

  return {
    trainRange: formatDateRange(split.train),
    validationRange: formatDateRange(split.validation),
    train: trainStats,
    validation: validationStats,
    summary,
  };
}

function fitWeightedLinearWeights(features: number[][], targets: number[], sampleWeights: number[], ridge = 0): number[] | null {
  if (!features.length || features.length !== targets.length || sampleWeights.length !== targets.length) {
    return null;
  }

  const dim = features[0].length;
  const xtx = Array.from({ length: dim }, () => Array(dim).fill(0));
  const xty = Array(dim).fill(0);

  for (let i = 0; i < features.length; i += 1) {
    const x = features[i];
    const y = targets[i];
    const w = Math.max(1e-6, sampleWeights[i]);
    for (let r = 0; r < dim; r += 1) {
      xty[r] += w * x[r] * y;
      for (let c = 0; c < dim; c += 1) {
        xtx[r][c] += w * x[r] * x[c];
      }
    }
  }

  for (let i = 0; i < dim; i += 1) {
    xtx[i][i] += ridge;
  }

  return solveLinearSystem(xtx, xty);
}

function fitSgdWeights(rows: FeatureRow[], learningRate: number, epochs: number, clip: number): [number, number, number] {
  const weights: [number, number, number] = [0, 0.38, 0];
  for (let epoch = 0; epoch < epochs; epoch += 1) {
    const rate = learningRate / Math.sqrt(epoch + 1);
    for (const row of rows) {
      const predicted = weights[0] + weights[1] * row.leadReturn + weights[2] * row.closeGapReturn;
      const residual = Math.max(-clip, Math.min(clip, row.targetReturn - predicted));
      weights[0] += rate * residual;
      weights[1] += rate * residual * row.leadReturn;
      weights[2] += rate * residual * row.closeGapReturn;
    }
  }

  return weights;
}

function buildPathAdjustCandidates(fund: FundViewModel): ResearchCandidate[] {
  const rows = buildFeatureRows(fund);
  if (rows.length < 16) {
    return [];
  }

  const { train, validation } = splitTrainValidationByYear(rows);
  const trainFeatures = train.map((item) => [1, item.leadReturn, item.closeGapReturn]);
  const trainTargets = train.map((item) => item.targetReturn);
  const trainRecent = train.slice(-Math.min(90, train.length));
  const trainFeaturesRecent = trainRecent.map((item) => [1, item.leadReturn, item.closeGapReturn]);
  const trainTargetsRecent = trainRecent.map((item) => item.targetReturn);
  const timeDecayWeights = train.map((_, index) => Math.pow(0.985, train.length - 1 - index));

  const trainFeaturesHuber = train.map((item) => [
    1,
    item.leadReturn,
    item.closeGapReturn,
    item.leadReturn * item.closeGapReturn,
    Math.sign(item.leadReturn) * item.leadReturn * item.leadReturn,
  ]);

  const ols = fitLinearWeights(trainFeatures, trainTargets, 0) ?? [0, 0.38, 0];
  const ridge05 = fitLinearWeights(trainFeatures, trainTargets, 0.5) ?? ols;
  const ridge2 = fitLinearWeights(trainFeatures, trainTargets, 2) ?? ols;
  const recent90 = fitLinearWeights(trainFeaturesRecent, trainTargetsRecent, 0.8) ?? ols;
  const ewls = fitWeightedLinearWeights(trainFeatures, trainTargets, timeDecayWeights, 0.6) ?? ols;
  const huberPoly = fitHuberIrls(trainFeaturesHuber, trainTargets, 0.012, 1.1, 8) ?? [0, 0.38, 0, 0, 0];

  const regimeThreshold = quantile(train.map((item) => Math.abs(item.leadReturn) + 0.8 * Math.abs(item.closeGapReturn)), 0.72);
  const calmRows = train.filter((item) => Math.abs(item.leadReturn) + 0.8 * Math.abs(item.closeGapReturn) < regimeThreshold);
  const volatileRows = train.filter((item) => Math.abs(item.leadReturn) + 0.8 * Math.abs(item.closeGapReturn) >= regimeThreshold);
  const calmWeights = fitLinearWeights(
    calmRows.map((item) => [1, item.leadReturn, item.closeGapReturn]),
    calmRows.map((item) => item.targetReturn),
    0.5,
  ) ?? ridge05;
  const volatileWeights = fitHuberIrls(
    volatileRows.map((item) => [1, item.leadReturn, item.closeGapReturn, item.leadReturn * item.closeGapReturn]),
    volatileRows.map((item) => item.targetReturn),
    0.015,
    1.2,
    8,
  ) ?? [ridge2[0], ridge2[1], ridge2[2], 0];

  const predictCalm = (row: FeatureRow) => calmWeights[0] + calmWeights[1] * row.leadReturn + calmWeights[2] * row.closeGapReturn;
  const predictVolatile = (row: FeatureRow) => volatileWeights[0]
    + volatileWeights[1] * row.leadReturn
    + volatileWeights[2] * row.closeGapReturn
    + volatileWeights[3] * row.leadReturn * row.closeGapReturn;

  const sgdStable = fitSgdWeights(train, 0.08, 60, 0.03);
  const sgdAggressive = fitSgdWeights(train, 0.16, 120, 0.06);
  const mainWeights: [number, number, number] = [fund.model.alpha, fund.model.betaLead, fund.model.betaGap];

  const variants: Array<{ key: string; label: string; predict: (row: FeatureRow) => number }> = [
    { key: 'pa-main', label: '路径校正-当前线上模型', predict: (row) => mainWeights[0] + mainWeights[1] * row.leadReturn + mainWeights[2] * row.closeGapReturn },
    { key: 'pa-ols', label: '路径校正-OLS', predict: (row) => ols[0] + ols[1] * row.leadReturn + ols[2] * row.closeGapReturn },
    { key: 'pa-ridge05', label: '路径校正-Ridge(0.5)', predict: (row) => ridge05[0] + ridge05[1] * row.leadReturn + ridge05[2] * row.closeGapReturn },
    { key: 'pa-ridge2', label: '路径校正-Ridge(2.0)', predict: (row) => ridge2[0] + ridge2[1] * row.leadReturn + ridge2[2] * row.closeGapReturn },
    { key: 'pa-ewls', label: '路径校正-EWLS衰减', predict: (row) => ewls[0] + ewls[1] * row.leadReturn + ewls[2] * row.closeGapReturn },
    { key: 'pa-recent90', label: '路径校正-近期滚动90日', predict: (row) => recent90[0] + recent90[1] * row.leadReturn + recent90[2] * row.closeGapReturn },
    {
      key: 'pa-huber-poly',
      label: '路径校正-Huber鲁棒(非线性)',
      predict: (row) => huberPoly[0]
        + huberPoly[1] * row.leadReturn
        + huberPoly[2] * row.closeGapReturn
        + huberPoly[3] * row.leadReturn * row.closeGapReturn
        + huberPoly[4] * Math.sign(row.leadReturn) * row.leadReturn * row.leadReturn,
    },
    {
      key: 'pa-regime-switch',
      label: '路径校正-分波动状态',
      predict: (row) => {
        const vol = Math.abs(row.leadReturn) + 0.8 * Math.abs(row.closeGapReturn);
        if (vol < regimeThreshold) {
          return predictCalm(row);
        }

        return predictVolatile(row);
      },
    },
    {
      key: 'pa-regime-blend',
      label: '路径校正-波动率门控融合',
      predict: (row) => {
        const vol = Math.abs(row.leadReturn) + 0.8 * Math.abs(row.closeGapReturn);
        const scale = Math.max(1e-4, regimeThreshold * 0.22);
        const gate = 1 / (1 + Math.exp(-(vol - regimeThreshold) / scale));
        return predictCalm(row) * (1 - gate) + predictVolatile(row) * gate;
      },
    },
    { key: 'pa-sgd-stable', label: '路径校正-SGD稳健', predict: (row) => sgdStable[0] + sgdStable[1] * row.leadReturn + sgdStable[2] * row.closeGapReturn },
    { key: 'pa-sgd-fast', label: '路径校正-SGD灵敏', predict: (row) => sgdAggressive[0] + sgdAggressive[1] * row.leadReturn + sgdAggressive[2] * row.closeGapReturn },
  ];

  return variants.map((variant) => {
    const trainPoints = train.map((row) => {
      const predictedReturn = variant.predict(row);
      const predictedNav = row.anchorNav * (1 + predictedReturn);
      const absError = row.actualNav > 0 ? Math.abs(predictedNav / row.actualNav - 1) : 0;
      return { date: row.date, actualNav: row.actualNav, predictedNav, absError };
    });
    const validationPoints = validation.map((row) => {
      const predictedReturn = variant.predict(row);
      const predictedNav = row.anchorNav * (1 + predictedReturn);
      const absError = row.actualNav > 0 ? Math.abs(predictedNav / row.actualNav - 1) : 0;
      return { date: row.date, actualNav: row.actualNav, predictedNav, absError };
    });
    const maeTrain = average(trainPoints.map((item) => item.absError));
    const maeValidation = average(validationPoints.map((item) => item.absError));
    const maeValidation30 = average(validationPoints.slice(-30).map((item) => item.absError));

    return {
      key: variant.key,
      label: variant.label,
      mode: 'path-adjust',
      trainPoints,
      validationPoints,
      maeTrain,
      maeValidation,
      maeValidation30,
    };
  });
}

interface TsRow {
  date: string;
  actualNav: number;
  prevNav: number;
  lag1: number;
  lag2: number;
  ma3: number;
  ewma35: number;
  ewma65: number;
}

function buildTsRows(fund: FundViewModel): TsRow[] {
  const navAsc = [...fund.runtime.navHistory].sort((left, right) => left.date.localeCompare(right.date));
  if (navAsc.length < 10) {
    return [];
  }

  const returns: number[] = [];
  for (let i = 1; i < navAsc.length; i += 1) {
    const prev = navAsc[i - 1].nav;
    const curr = navAsc[i].nav;
    returns.push(prev > 0 ? curr / prev - 1 : 0);
  }

  const ewma35: number[] = [];
  const ewma65: number[] = [];
  let s35 = returns[0] ?? 0;
  let s65 = returns[0] ?? 0;
  for (let i = 0; i < returns.length; i += 1) {
    const r = returns[i] ?? 0;
    s35 = i === 0 ? r : 0.35 * r + 0.65 * s35;
    s65 = i === 0 ? r : 0.65 * r + 0.35 * s65;
    ewma35.push(s35);
    ewma65.push(s65);
  }

  const rows: TsRow[] = [];
  for (let i = 1; i < navAsc.length; i += 1) {
    const returnIndex = i - 1;
    const lastReturns = returns.slice(Math.max(0, returnIndex - 3), returnIndex);
    const ma3 = lastReturns.length ? average(lastReturns) : 0;
    rows.push({
      date: navAsc[i].date,
      actualNav: navAsc[i].nav,
      prevNav: navAsc[i - 1].nav,
      lag1: returnIndex >= 1 ? returns[returnIndex - 1] : 0,
      lag2: returnIndex >= 2 ? returns[returnIndex - 2] : 0,
      ma3,
      ewma35: returnIndex >= 1 ? ewma35[returnIndex - 1] : 0,
      ewma65: returnIndex >= 1 ? ewma65[returnIndex - 1] : 0,
    });
  }

  return rows;
}

function buildPointsByTsModel(rows: TsRow[], predictReturn: (row: TsRow) => number): ResearchPoint[] {
  return rows.map((row) => {
    const predictedNav = row.prevNav * (1 + predictReturn(row));
    const absError = row.actualNav > 0 ? Math.abs(predictedNav / row.actualNav - 1) : 0;
    return {
      date: row.date,
      actualNav: row.actualNav,
      predictedNav,
      absError,
    };
  });
}

function splitResearchPoints(points: ResearchPoint[]) {
  const { train, validation } = splitTrainValidationByYear(points);
  return { trainPoints: train, validationPoints: validation };
}

function buildTimeSeriesCandidates(fund: FundViewModel): ResearchCandidate[] {
  const rows = buildTsRows(fund);
  if (rows.length < 20) {
    return [];
  }

  const split = splitTrainValidationByYear(rows);
  const trainRows = split.train;

  const ar1Weights = fitLinearWeights(
    trainRows.map((row) => [1, row.lag1]),
    trainRows.map((row) => (row.prevNav > 0 ? row.actualNav / row.prevNav - 1 : 0)),
    0.2,
  ) ?? [0, 0];

  const ar2Weights = fitLinearWeights(
    trainRows.map((row) => [1, row.lag1, row.lag2]),
    trainRows.map((row) => (row.prevNav > 0 ? row.actualNav / row.prevNav - 1 : 0)),
    0.4,
  ) ?? [0, 0, 0];

  const tsRegimeThreshold = quantile(trainRows.map((row) => Math.abs(row.lag1) + 0.6 * Math.abs(row.lag2)), 0.7);

  const variants: Array<{ key: string; label: string; predict: (row: TsRow) => number }> = [
    { key: 'ts-naive', label: '时序-持平(naive)', predict: () => 0 },
    { key: 'ts-ma3', label: '时序-SMA3收益', predict: (row) => row.ma3 },
    { key: 'ts-ewma35', label: '时序-EWMA(0.35)', predict: (row) => row.ewma35 },
    { key: 'ts-ewma65', label: '时序-EWMA(0.65)', predict: (row) => row.ewma65 },
    { key: 'ts-ar1', label: '时序-AR1', predict: (row) => ar1Weights[0] + ar1Weights[1] * row.lag1 },
    { key: 'ts-ar2', label: '时序-AR2', predict: (row) => ar2Weights[0] + ar2Weights[1] * row.lag1 + ar2Weights[2] * row.lag2 },
    {
      key: 'ts-regime-switch',
      label: '时序-分波动状态',
      predict: (row) => {
        const vol = Math.abs(row.lag1) + 0.6 * Math.abs(row.lag2);
        return vol >= tsRegimeThreshold ? row.ewma65 : ar1Weights[0] + ar1Weights[1] * row.lag1;
      },
    },
  ];

  return variants.map((variant) => {
    const points = buildPointsByTsModel(rows, variant.predict);
    const { trainPoints, validationPoints } = splitResearchPoints(points);

    return {
      key: variant.key,
      label: variant.label,
      mode: 'time-series',
      trainPoints,
      validationPoints,
      maeTrain: average(trainPoints.map((item) => item.absError)),
      maeValidation: average(validationPoints.map((item) => item.absError)),
      maeValidation30: average(validationPoints.slice(-30).map((item) => item.absError)),
    };
  });
}

function buildResearchCandidates(fund: FundViewModel): ResearchCandidate[] {
  return [...buildPathAdjustCandidates(fund), ...buildTimeSeriesCandidates(fund)]
    .filter((item) => item.trainPoints.length >= 120 && item.validationPoints.length >= 30)
    .sort((left, right) => {
      const leftScore = Number.isFinite(left.maeValidation30) ? left.maeValidation30 : Number.POSITIVE_INFINITY;
      const rightScore = Number.isFinite(right.maeValidation30) ? right.maeValidation30 : Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      const leftVal = Number.isFinite(left.maeValidation) ? left.maeValidation : Number.POSITIVE_INFINITY;
      const rightVal = Number.isFinite(right.maeValidation) ? right.maeValidation : Number.POSITIVE_INFINITY;
      return leftVal - rightVal;
    });
}

function buildAlgoVariants(fund: FundViewModel): AlgoVariant[] {
  const main = {
    key: 'main',
    label: '当前主模型',
    alpha: fund.model.alpha,
    betaLead: fund.model.betaLead,
    betaGap: fund.model.betaGap,
  };

  return [
    main,
    {
      key: 'baseline-v1',
      label: '基线 v1（固定系数）',
      alpha: 0,
      betaLead: 0.38,
      betaGap: 0,
    },
    {
      key: 'stable-v1',
      label: '稳健 v1（低灵敏）',
      alpha: main.alpha * 0.8,
      betaLead: main.betaLead * 0.82,
      betaGap: main.betaGap * 0.7,
    },
    {
      key: 'aggressive-v1',
      label: '激进 v1（高灵敏）',
      alpha: main.alpha,
      betaLead: main.betaLead * 1.15,
      betaGap: main.betaGap * 1.1,
    },
  ];
}

function computeAlgoScores(fund: FundViewModel): AlgoScore[] {
  const variants = buildAlgoVariants(fund);
  const snapshotsByDate = new Map(fund.journal.snapshots.map((item) => [item.estimateDate, item]));
  const settledRows = fund.journal.errors
    .map((errorPoint) => {
      const snapshot = snapshotsByDate.get(errorPoint.date);
      if (!snapshot || !Number.isFinite(errorPoint.actualNav) || errorPoint.actualNav <= 0 || snapshot.anchorNav <= 0) {
        return null;
      }

      return {
        actualNav: errorPoint.actualNav,
        anchorNav: snapshot.anchorNav,
        leadReturn: snapshot.leadReturn,
        closeGapReturn: snapshot.closeGapReturn,
      };
    })
    .filter(
      (item): item is { actualNav: number; anchorNav: number; leadReturn: number; closeGapReturn: number } => Boolean(item),
    );

  const recentRows7 = settledRows.slice(-7);
  const recentRows30 = settledRows.slice(-30);

  return variants
    .map((variant) => {
      const estimateReturn = variant.alpha + variant.betaLead * fund.estimate.leadReturn + variant.betaGap * fund.estimate.closeGapReturn;
      const estimatedNav = fund.estimate.anchorNav > 0 ? fund.estimate.anchorNav * (1 + estimateReturn) : 0;
      const premiumRate = estimatedNav > 0 ? fund.runtime.marketPrice / estimatedNav - 1 : 0;

      const allErrors = settledRows.map((row) => {
        const predictedReturn = variant.alpha + variant.betaLead * row.leadReturn + variant.betaGap * row.closeGapReturn;
        const predictedNav = row.anchorNav * (1 + predictedReturn);
        return Math.abs(predictedNav / row.actualNav - 1);
      });
      const recentErrors = recentRows7.map((row) => {
        const predictedReturn = variant.alpha + variant.betaLead * row.leadReturn + variant.betaGap * row.closeGapReturn;
        const predictedNav = row.anchorNav * (1 + predictedReturn);
        return Math.abs(predictedNav / row.actualNav - 1);
      });
      const last30Errors = recentRows30.map((row) => {
        const predictedReturn = variant.alpha + variant.betaLead * row.leadReturn + variant.betaGap * row.closeGapReturn;
        const predictedNav = row.anchorNav * (1 + predictedReturn);
        return Math.abs(predictedNav / row.actualNav - 1);
      });

      const maeAll = allErrors.length > 0 ? allErrors.reduce((sum, value) => sum + value, 0) / allErrors.length : NaN;
      const mae30 = last30Errors.length > 0 ? last30Errors.reduce((sum, value) => sum + value, 0) / last30Errors.length : NaN;
      const maeRecent = recentErrors.length > 0 ? recentErrors.reduce((sum, value) => sum + value, 0) / recentErrors.length : NaN;

      return {
        variant,
        sampleCount: settledRows.length,
        maeAll,
        mae30,
        maeRecent,
        estimatedNav,
        premiumRate,
      };
    })
    .sort((left, right) => {
      const leftScore = Number.isFinite(left.mae30) ? left.mae30 : Number.POSITIVE_INFINITY;
      const rightScore = Number.isFinite(right.mae30) ? right.mae30 : Number.POSITIVE_INFINITY;
      if (leftScore !== rightScore) {
        return leftScore - rightScore;
      }

      const leftRecent = Number.isFinite(left.maeRecent) ? left.maeRecent : Number.POSITIVE_INFINITY;
      const rightRecent = Number.isFinite(right.maeRecent) ? right.maeRecent : Number.POSITIVE_INFINITY;
      if (leftRecent !== rightRecent) {
        return leftRecent - rightRecent;
      }

      const leftAll = Number.isFinite(left.maeAll) ? left.maeAll : Number.POSITIVE_INFINITY;
      const rightAll = Number.isFinite(right.maeAll) ? right.maeAll : Number.POSITIVE_INFINITY;
      return leftAll - rightAll;
    });
}

function getProxyChange(currentPrice: number, previousClose: number) {
  return previousClose > 0 ? currentPrice / previousClose - 1 : 0;
}

function HomePage({
  funds,
  syncedAt,
  loading,
  error,
  pageCategory,
  trainingMetricsByCode,
  premiumCompareCodes,
  isMember,
  currentUser,
  onRequireMember,
}: {
  funds: FundViewModel[];
  syncedAt: string;
  loading: boolean;
  error: string;
  pageCategory: ViewCategory;
  trainingMetricsByCode: Record<string, TrainingMetricSummary>;
  premiumCompareCodes: Record<string, PremiumCompareCodePayload>;
  isMember: boolean;
  currentUser: AuthUser | null;
  onRequireMember: (code: string) => void;
}) {
  const pageOption = getPageOption(pageCategory);
  const [favoriteCodes, setFavoriteCodes] = useState<string[]>(() => readFavoriteFundCodes());
  const [orderedCodes, setOrderedCodes] = useState<string[]>(() => readFundOrder(pageCategory));
  const [githubTraffic, setGithubTraffic] = useState<GithubTrafficPayload>(() => getDefaultGithubTrafficPayload());
  const [publicTraffic, setPublicTraffic] = useState<PublicTrafficCounter>(() => getDefaultPublicTrafficCounter());

  useEffect(() => {
    setOrderedCodes(readFundOrder(pageCategory));
  }, [pageCategory]);

  useEffect(() => {
    let active = true;

    if (!syncedAt) {
      return () => {
        active = false;
      };
    }

    async function loadGithubTraffic() {
      try {
        const payload = await fetchGeneratedJson<GithubTrafficPayload>('github-traffic.json');
        if (active) {
          setGithubTraffic({
            ...getDefaultGithubTrafficPayload(),
            ...payload,
          });
        }
      } catch {
        if (active) {
          setGithubTraffic(getDefaultGithubTrafficPayload());
        }
      }
    }

    void loadGithubTraffic();

    return () => {
      active = false;
    };
  }, [syncedAt]);

  useEffect(() => {
    let active = true;

    if (!syncedAt) {
      return () => {
        active = false;
      };
    }

    async function refreshPublicTrafficCounter() {
      const payload = await loadPublicTrafficCounter();
      if (active) {
        setPublicTraffic(payload);
      }
    }

    void refreshPublicTrafficCounter();

    return () => {
      active = false;
    };
  }, [syncedAt]);

  const filteredFunds = useMemo(() => {
    if (pageCategory === 'favorites') {
      if (!favoriteCodes.length) {
        return [];
      }

      const fundByCode = new Map(funds.map((item) => [item.runtime.code, item]));
      return favoriteCodes
        .map((code) => fundByCode.get(code))
        .filter((item): item is FundViewModel => Boolean(item));
    }

    if (pageCategory === 'qdii-etf') {
      return funds.filter((item) => isQdiiEtfFund(item));
    }
    if (pageCategory === 'domestic-etf') {
      return funds.filter((item) => item.runtime.pageCategory === 'etf' && !isQdiiEtfFund(item));
    }
    return funds.filter((item) => item.runtime.pageCategory === pageCategory);
  }, [favoriteCodes, funds, pageCategory]);

  const visibleFunds = useMemo(() => {
    if (!orderedCodes.length) {
      return filteredFunds;
    }

    const orderIndex = new Map(orderedCodes.map((code, index) => [code, index]));
    return [...filteredFunds].sort((left, right) => {
      const leftIndex = orderIndex.get(left.runtime.code);
      const rightIndex = orderIndex.get(right.runtime.code);
      const leftDefined = typeof leftIndex === 'number';
      const rightDefined = typeof rightIndex === 'number';

      if (leftDefined && rightDefined) {
        return leftIndex - rightIndex;
      }
      if (leftDefined) {
        return -1;
      }
      if (rightDefined) {
        return 1;
      }

      return left.runtime.priority - right.runtime.priority;
    });
  }, [filteredFunds, orderedCodes]);

  const proxyDrivenCount = visibleFunds.filter((item) => item.runtime.estimateMode === 'proxy').length;
  const syncAgeHours = getHoursSinceSync(syncedAt);
  const untrainedCount = visibleFunds.filter((item) => !trainingMetricsByCode[item.runtime.code]).length;
  const favoriteVisibleCount = visibleFunds.filter((item) => favoriteCodes.includes(item.runtime.code)).length;
  const trafficSnapshots = (githubTraffic.snapshots ?? []).slice(-14);
  const trafficTrendPoints = useMemo(() => {
    if (!trafficSnapshots.length) {
      return '';
    }

    const maxY = Math.max(...trafficSnapshots.map((item) => item.viewUniques || 0), 1);
    const stepX = trafficSnapshots.length > 1 ? 120 / (trafficSnapshots.length - 1) : 0;
    return trafficSnapshots
      .map((item, index) => {
        const x = Number((stepX * index).toFixed(2));
        const y = Number((24 - ((item.viewUniques || 0) / maxY) * 22).toFixed(2));
        return `${x},${y}`;
      })
      .join(' ');
  }, [trafficSnapshots]);
  const latestTrafficDay = trafficSnapshots.length ? trafficSnapshots[trafficSnapshots.length - 1].date : '';
  const recent7Fallback = getRecent7TrafficFallback(githubTraffic);
  const usePublicTrafficFallback = !githubTraffic.available && !trafficSnapshots.length && publicTraffic.available;
  const cumulativeSnapshotUniques = Number(githubTraffic.snapshotSummary?.cumulativeViewUniques)
    || Number(githubTraffic.totals?.viewUniques)
    || trafficSnapshots.reduce((sum, item) => sum + (Number(item?.viewUniques) || 0), 0);
  const recent7UniquesDisplay = String(usePublicTrafficFallback ? publicTraffic.active7UniqueDevices : recent7Fallback.viewUniques);
  const todayUniquesDisplay = String(usePublicTrafficFallback ? publicTraffic.todayUniqueDevices : recent7Fallback.viewUniques);
  const cumulativeUniquesDisplay = usePublicTrafficFallback ? publicTraffic.totalUniqueDevices : cumulativeSnapshotUniques;
  const latestTrafficDateDisplay = usePublicTrafficFallback
    ? (publicTraffic.days.length ? publicTraffic.days[publicTraffic.days.length - 1].date : '')
    : latestTrafficDay;
  const homeTrafficStateText = githubTraffic.available
    ? 'API可用'
    : (trafficSnapshots.length ? '快照可用' : (publicTraffic.available ? '访客计数可用' : '未配置'));
  const eastmoneyPremiumByCode = useMemo(() => {
    const next: Record<string, number | null> = {};
    for (const item of visibleFunds) {
      const compare = premiumCompareCodes[item.runtime.code];
      const eastmoney = compare?.providers?.find((provider) => provider.provider === 'eastmoney-fundgz');
      const rate = eastmoney?.premiumRateCurrent;
      next[item.runtime.code] = typeof rate === 'number' && Number.isFinite(rate) ? rate : null;
    }
    return next;
  }, [premiumCompareCodes, visibleFunds]);

  const handleToggleFavorite = (code: string) => {
    setFavoriteCodes((current) => {
      const next = current.includes(code) ? current.filter((item) => item !== code) : [code, ...current.filter((item) => item !== code)];
      writeFavoriteFundCodes(next);
      return next;
    });
  };

  const handleReorder = (next: string[]) => {
    if (!next.length) {
      return;
    }
    setOrderedCodes(next);
    writeFundOrder(pageCategory, next);
  };

  const handleFavoriteReorder = (next: string[]) => {
    if (!next.length) {
      return;
    }

    setFavoriteCodes(next);
    writeFavoriteFundCodes(next);
  };

  return (
    <DesktopShell
      currentPath={pageOption.path}
      currentUser={currentUser}
      title={pageOption.label}
      subtitle={pageOption.lead}
      actions={<Link className="member-primary-btn" to="/member">{currentUser ? '进入会员中心' : '登录 / 注册'}</Link>}
    >
      {error ? <section className="panel notice-panel">{error}</section> : null}
      {!error && syncAgeHours !== null && syncAgeHours >= 12 ? <section className="panel notice-panel">当前页面数据同步时间偏旧，建议稍后刷新再看。</section> : null}

      <FundTable
        funds={visibleFunds}
        trainingMetricsByCode={trainingMetricsByCode}
        eastmoneyPremiumByCode={eastmoneyPremiumByCode}
        formatCurrency={formatCurrency}
        formatPercent={formatPercent}
        isMember={isMember}
        title={pageOption.tableTitle}
        description={pageOption.tableDescription}
        pagePath={pageOption.path}
        favoriteCodes={favoriteCodes}
        onToggleFavorite={handleToggleFavorite}
        onReorder={pageCategory === 'favorites' ? handleFavoriteReorder : handleReorder}
        onRequireMember={onRequireMember}
      />

    </DesktopShell>
  );
}

function DocsPage() {
  return (
    <DesktopShell currentPath="/docs" currentUser={null} title="说明文档" subtitle="口径定义、误差说明、估值流程与页面规则统一在这里查看。">
      <section className="panel dashboard-hero-card">
        <div className="hero__copy">
          <span className="eyebrow">新手说明 + 口径定义 + 持续更新</span>
          <h1>估值说明文档</h1>
          <p className="hero__lead">
            这个页面专门解释看板里每个指标是什么意思、估值大概怎么做、为什么会和盘中感受有偏差。后续新增规则、口径调整、异常处理都会优先补到这里。
          </p>
        </div>
        <div className="dashboard-overview-grid">
          <div className="hero__fact hero__fact--accent">
            <span>阅读建议</span>
            <strong>先看误差定义，再看估值流程</strong>
            <small className="hero__fact-subtle">这样最容易把“数字”和“结果”对应起来。</small>
          </div>
          <div className="hero__fact">
            <span>更新方式</span>
            <strong>文档随版本持续补充</strong>
            <small className="hero__fact-subtle">每次口径变化会同步到此页。</small>
          </div>
        </div>
      </section>

      <section className="panel docs-section">
        <h2>三个误差指标是什么意思</h2>
        <div className="docs-grid">
          <article className="docs-card">
            <h3>训练误差</h3>
            <p>看模型在离线验证数据上的平均误差，主要用来判断“模型本身的底子”是否靠谱。</p>
            <p>一般来说越小越好，适合看长期能力，不代表今天一定最准。</p>
          </article>
          <article className="docs-card">
            <h3>最近误差</h3>
            <p>最近一个已结算交易日的实际偏差，反映模型刚刚那次估值的命中情况。</p>
            <p>这个值会受单日突发影响比较大，波动通常最大。</p>
          </article>
          <article className="docs-card">
            <h3>30d误差</h3>
            <p>最近 30 个交易日平均绝对误差，用于看近期稳定性。</p>
            <p>可以把它理解为“最近一个月平均偏离多少”。</p>
          </article>
        </div>
      </section>

      <section className="panel docs-section">
        <h2>估值是怎么做出来的（小白版）</h2>
        <ol className="docs-list">
          <li>先用最近一次官方净值作为起点（通常是 T-1 或 T-2）。</li>
          <li>优先看前十大持仓的盘中涨跌，估算基金今天大概涨跌多少。</li>
          <li>如果持仓行情拿不全，就用代理篮子补足缺失信号。</li>
          <li>QDII 基金会叠加汇率变化影响。</li>
          <li>把历史误差学习得到的修正项加进去，减少系统性偏差。</li>
          <li>得到当日估值后，再和场内价格比较，算出溢价率。</li>
        </ol>
      </section>

      <section className="panel docs-section">
        <h2>为什么有时你觉得在跌，表里却显示涨</h2>
        <ul className="docs-list">
          <li>行情有刷新间隔，短时间内可能看到的是上一轮快照。</li>
          <li>不同数据源更新时间不完全一致，分钟级会有错位。</li>
          <li>基金估值是组合信号，不是单一股票涨跌的直接映射。</li>
          <li>若遇到节假日、跨市场休市、临停等情况，误差会放大。</li>
        </ul>
      </section>

      <section className="panel docs-section">
        <h2>刷新与缓存口径</h2>
        <ul className="docs-list">
          <li>公告和持仓结构按日更新，不需要每分钟重抓。</li>
          <li>盘中行情按短周期刷新，当前策略是最多约 5 分钟一轮。</li>
          <li>即使分组同步，也会对全基金统一叠加实时行情覆盖。</li>
        </ul>
      </section>

      <section className="panel notice-panel">
        说明页面会持续补充：例如新增误差口径、特殊基金处理逻辑、以及数据源异常时的兜底策略。你后续提到的解释需求都可以直接加在这里。
      </section>
    </DesktopShell>
  );
}

function TrafficPage() {
  const [githubTraffic, setGithubTraffic] = useState<GithubTrafficPayload>(() => getDefaultGithubTrafficPayload());
  const [publicTraffic, setPublicTraffic] = useState<PublicTrafficCounter>(() => getDefaultPublicTrafficCounter());

  useEffect(() => {
    let active = true;

    async function loadGithubTraffic() {
      try {
        const payload = await fetchGeneratedJson<GithubTrafficPayload>('github-traffic.json');
        if (active) {
          setGithubTraffic({
            ...getDefaultGithubTrafficPayload(),
            ...payload,
          });
        }
      } catch {
        if (active) {
          setGithubTraffic(getDefaultGithubTrafficPayload());
        }
      }
    }

    void loadGithubTraffic();

    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;

    async function refreshPublicTrafficCounter() {
      const payload = await loadPublicTrafficCounter();
      if (active) {
        setPublicTraffic(payload);
      }
    }

    void refreshPublicTrafficCounter();

    return () => {
      active = false;
    };
  }, []);

  const recentTrafficDays = githubTraffic.recent7?.days ?? [];
  const trafficSnapshots = (githubTraffic.snapshots ?? []).slice(-30);
  const snapshotVisitorSeries = trafficSnapshots.map((item) => ({
    label: item.date,
    value: Number(item.viewUniques) || 0,
  }));
  const snapshotViewSeries = trafficSnapshots.map((item) => ({
    label: item.date,
    value: Number(item.viewCount) || 0,
  }));
  const recentVisitorSeries = recentTrafficDays.map((item) => ({
    label: item.date,
    value: Number(item.viewUniques) || 0,
  }));
  const recentViewSeries = recentTrafficDays.map((item) => ({
    label: item.date,
    value: Number(item.viewCount) || 0,
  }));
  const trafficRecent7Fallback = getRecent7TrafficFallback(githubTraffic);
  const usePublicTrafficFallback = !githubTraffic.available && !trafficSnapshots.length && publicTraffic.available;
  const trafficRecent7UvDisplay = String(usePublicTrafficFallback ? publicTraffic.active7UniqueDevices : trafficRecent7Fallback.viewUniques);
  const trafficTodayUvDisplay = String(usePublicTrafficFallback ? publicTraffic.todayUniqueDevices : trafficRecent7Fallback.viewUniques);
  const trafficRecent7PvDisplay = String(usePublicTrafficFallback ? publicTraffic.active7UniqueDevices : trafficRecent7Fallback.viewCount);
  const trafficTotalVisitorsDisplay = usePublicTrafficFallback
    ? publicTraffic.totalUniqueDevices
    : (githubTraffic.snapshotSummary?.cumulativeViewUniques ?? 0);
  const trafficTotalDaysDisplay = usePublicTrafficFallback
    ? publicTraffic.days.filter((item) => item.uniqueDevices > 0).length
    : (githubTraffic.snapshotSummary?.totalDays ?? 0);
  const trafficStateDisplay = githubTraffic.available
    ? '可用'
    : (usePublicTrafficFallback ? '公开计数可用' : '不可用');
  const trafficStateHint = githubTraffic.available
    ? '由 GitHub traffic API 提供'
    : (usePublicTrafficFallback
      ? 'GitHub 不可用时，自动使用访客计数兜底'
      : (githubTraffic.reason || publicTraffic.reason || '未知原因'));

  return (
    <DesktopShell currentPath="/traffic" currentUser={null} title="访客趋势" subtitle="访客 UV/PV、快照趋势和公开计数兜底统一集中查看。">
      <section className="panel dashboard-hero-card">
        <div className="hero__copy">
          <span className="eyebrow">GitHub Traffic 趋势</span>
          <h1>访客趋势页</h1>
          <p className="hero__lead">这里专门看访客趋势和快照口径，不占首页空间。最近 7 天看短期波动，固定时点快照看长期趋势。</p>
        </div>
        <div className="dashboard-overview-grid">
          <div className="hero__fact hero__fact--accent">
            <span>近7日活跃访客(UV)</span>
            <strong>{trafficRecent7UvDisplay}</strong>
            <small className="hero__fact-subtle">今日访客 {trafficTodayUvDisplay}，近7日浏览(PV) {trafficRecent7PvDisplay}</small>
          </div>
          <div className="hero__fact">
            <span>累计访客</span>
            <strong>{trafficTotalVisitorsDisplay}</strong>
            <small className="hero__fact-subtle">已记录天数 {trafficTotalDaysDisplay}</small>
          </div>
          <div className="hero__fact">
            <span>数据状态</span>
            <strong>{trafficStateDisplay}</strong>
            <small className="hero__fact-subtle">{trafficStateHint}</small>
          </div>
        </div>
      </section>

      <section className="panel traffic-detail-panel">
        <div className="traffic-detail-grid">
          <LineChart
            title="每日快照访客趋势（近30天）"
            primary={snapshotVisitorSeries}
            secondary={snapshotViewSeries}
            primaryLabel="访客(UV)"
            secondaryLabel="浏览(PV)"
            valueFormatter={(value) => `${Math.round(value)}`}
          />
          <LineChart
            title="GitHub API 最近7天趋势"
            primary={recentVisitorSeries}
            secondary={recentViewSeries}
            primaryLabel="访客(UV)"
            secondaryLabel="浏览(PV)"
            valueFormatter={(value) => `${Math.round(value)}`}
          />
        </div>

        <ul className="docs-list">
          <li>近7日活跃访客：优先显示 GitHub 口径；不可用时切换到访客计数口径。</li>
          <li>每日访客：同一设备同一天只计一次，避免刷新刷量。</li>
          <li>累计访客：用于观察长期增长，和当日活跃是不同口径。</li>
          <li>快照时间默认北京时间中午，窗口内只记一次，避免同一天重复累计。</li>
        </ul>
      </section>
    </DesktopShell>
  );
}

function DetailPage({ funds, syncedAt, loading }: { funds: FundViewModel[]; syncedAt: string; loading: boolean }) {
  const params = useParams();
  const location = useLocation();
  const fundCode = params.code ?? '';
  const [offlineResearch, setOfflineResearch] = useState<OfflineResearchSummary | null>(null);
  const [premiumCompare, setPremiumCompare] = useState<PremiumCompareCodePayload | null>(null);
  const fund = funds.find((item) => item.runtime.code === params.code);
  const syncAgeHours = getHoursSinceSync(syncedAt);

  useEffect(() => {
    let active = true;

    if (!OFFLINE_RESEARCH_CODES.has(fundCode)) {
      setOfflineResearch(null);
      return () => {
        active = false;
      };
    }

    async function loadOfflineResearch() {
      try {
        const payload = await fetchGeneratedJson<OfflineResearchSummary>(`${fundCode}-offline-research.json`);
        if (active) {
          setOfflineResearch(payload);
        }
      } catch {
        if (active) {
          setOfflineResearch(null);
        }
      }
    }

    void loadOfflineResearch();

    return () => {
      active = false;
    };
  }, [fundCode, syncedAt]);

  useEffect(() => {
    let active = true;

    async function loadPremiumCompare() {
      try {
        const payload = await fetchGeneratedJson<PremiumComparePayload>('premium-compare.json');
        if (!active) {
          return;
        }

        setPremiumCompare(payload?.codes?.[fundCode] ?? null);
      } catch {
        if (active) {
          setPremiumCompare(null);
        }
      }
    }

    void loadPremiumCompare();

    return () => {
      active = false;
    };
  }, [fundCode, syncedAt]);

  if (loading && !fund) {
    return (
      <main className="page">
        <section className="panel notice-panel">基金数据加载中...</section>
      </main>
    );
  }

  if (!fund) {
    return (
      <main className="page">
        <section className="panel notice-panel">
          没找到基金 {params.code || ''} 的详情数据。可能是页面资源还是旧版本、同步数据偏旧，或者这次部署还没完全切换。
        </section>
        <section className="panel notice-panel">
          <Link className="back-link" to="/qdii-lof">
            返回看板
          </Link>
        </section>
      </main>
    );
  }

  const fromPath = new URLSearchParams(location.search).get('from');
  const backPath = PAGE_OPTIONS.some((item) => item.path === fromPath) ? fromPath ?? '/qdii-lof' : '/qdii-lof';
  const driverLabels = getEstimateDriverLabels(fund.runtime);
  const recentProxyQuotes = fund.runtime.proxyQuotes ?? [];

  const historyPoints = fund.journal.errors.slice(-20);
  const estimatedSeries = historyPoints.map((item) => ({ label: item.date, value: item.estimatedNav }));
  const actualSeries = historyPoints.map((item) => ({ label: item.date, value: item.actualNav }));
  const errorSeries = historyPoints.map((item) => ({ label: item.date, value: item.error }));
  const premiumTone = fund.estimate.premiumRate > 0 ? 'positive' : 'negative';
  const actualNavByDate = new Map(fund.runtime.navHistory.map((item) => [item.date, item.nav]));
  const errorByDate = new Map(fund.journal.errors.map((item) => [item.date, item]));
  const recentSnapshots = [...fund.journal.snapshots].slice(-20).reverse();
  const top10WeightPercent = getTop10DisclosedWeightPercent(fund.runtime);
  const currentEstimateDate = fund.runtime.marketDate || fund.runtime.navDate;
  const currentSnapshot = recentSnapshots.find((item) => item.estimateDate === currentEstimateDate) ?? recentSnapshots[0];
  const adaptiveStatusEnabled = fund.runtime.code === '161725' && Boolean(currentSnapshot?.adaptiveUsed);
  const adaptiveShockTriggered = Boolean(currentSnapshot?.adaptiveShockTriggered);
  const showOfflineResearch = OFFLINE_RESEARCH_CODES.has(fund.runtime.code) && offlineResearch && offlineResearch.segmented;
  const offlineChartVersion = offlineResearch?.generatedAt || syncedAt || Date.now().toString();
  const shouldShowPremiumCompareDetails = Boolean(premiumCompare);
  const premiumCompareProviders = premiumCompare?.providers ?? [];
  const providerDailyComparisons = premiumCompare?.providerDailyComparisons ?? {};
  const providerStatsByName = new Map(premiumCompareProviders.map((item) => [item.provider, item]));
  const eastmoneyProvider = premiumCompareProviders.find((item) => item.provider === 'eastmoney-fundgz') ?? null;
  const eastmoneyRows = premiumCompare?.eastmoneyDailyValuations ?? [];
  const eastmoneyProviderRowsRaw = providerDailyComparisons['eastmoney-fundgz'] ?? [];
  const eastmoneyProviderRows = eastmoneyProviderRowsRaw.length > 0
    ? eastmoneyProviderRowsRaw
    : eastmoneyRows.map((item) => ({
      date: item.date,
      time: item.time,
      marketPrice: item.marketPrice,
      providerPremiumRate: item.providerPremiumRate,
      ourReportedPremiumRate: typeof item.ourReportedPremiumRate === 'number' ? item.ourReportedPremiumRate : null,
      status: item.status,
      actualPremiumRate: null,
      providerPremiumError: null,
      ourPremiumError: null,
      premiumErrorDelta: null,
    }));
  const hasEastmoneyRows = eastmoneyProviderRows.length > 0;
  const providersWithRows = Object.entries(providerDailyComparisons)
    .filter((entry) => Array.isArray(entry[1]) && entry[1].length > 0)
    .map((entry) => entry[0]);
  const summaryProviders = premiumCompareProviders.filter((item) => {
    if (item.provider === 'eastmoney-fundgz') {
      return hasEastmoneyRows;
    }
    return providersWithRows.includes(item.provider);
  });
  const otherPremiumProviders = providersWithRows
    .filter((provider) => provider !== 'eastmoney-fundgz')
    .map((provider) => ({
      provider,
      rows: providerDailyComparisons[provider] ?? [],
      stats: providerStatsByName.get(provider) ?? null,
    }));
  const ourPremiumSummary = premiumCompare?.ourPremiumSummary;
  const getPremiumGapDelta = (
    sourceError: number | null | undefined,
    ourError: number | null | undefined,
    fallbackDelta?: number | null,
  ) => {
    if (typeof sourceError === 'number' && Number.isFinite(sourceError)
      && typeof ourError === 'number' && Number.isFinite(ourError)) {
      // Gap is based on absolute error magnitude: our worse => positive, our better => negative.
      return Math.abs(ourError) - Math.abs(sourceError);
    }
    if (typeof fallbackDelta === 'number' && Number.isFinite(fallbackDelta)) {
      return fallbackDelta;
    }
    return null;
  };

  const getPremiumGapDisplay = (delta: number | null | undefined) => {
    if (typeof delta !== 'number' || !Number.isFinite(delta)) {
      return { className: 'muted-text', text: '--' };
    }
    if (Math.abs(delta) < 1e-12) {
      return { className: 'muted-text', text: '--' };
    }
    if (delta > 0) {
      // Our error is larger than source error: up arrow + green.
      return { className: 'tone-negative', text: `↑ ${formatPercent(Math.abs(delta))}` };
    }
    // Our error is smaller than source error: down arrow + red.
    return { className: 'tone-positive', text: `↓ ${formatPercent(Math.abs(delta))}` };
  };

  return (
    <main className="page">
      {syncAgeHours !== null && syncAgeHours >= 12 ? (
        <section className="panel notice-panel">
          当前站点同步时间较旧，最新净值可能尚未刷新；这不是“更新中禁止查看”，而是部署或数据源还没产出更新。
        </section>
      ) : null}

      <section className="detail-header panel">
        <div>
          <Link className="back-link" to={backPath}>返回看板</Link>
          <span className="eyebrow">{fund.runtime.code} 详情</span>
          <h1>{fund.runtime.name}</h1>
          <p>{fund.runtime.benchmark || '该基金已纳入自动同步，但基准文本暂未抓取到。'}</p>
        </div>
        <div className="hero__facts hero__facts--single">
          <div>
            <span>最新净值日期</span>
            <strong>{fund.runtime.navDate || '--'}</strong>
          </div>
          <div>
            <span>自动估值日期</span>
            <strong>{fund.runtime.marketDate || fund.runtime.navDate || '--'}</strong>
          </div>
          <div>
            <span>自动同步时间</span>
            <strong>{syncedAt ? formatDateTime(syncedAt) : '--'}</strong>
          </div>
          <div>
            <span>申购状态</span>
            <strong>{fund.runtime.purchaseStatus || '--'}</strong>
          </div>
          {fund.runtime.purchaseLimit ? (
            <div>
              <span>申购限额</span>
              <strong>{fund.runtime.purchaseLimit}</strong>
            </div>
          ) : null}
        </div>
      </section>

      <section className="metrics-grid">
        <MetricCard label="当日预估净值" value={formatCurrency(fund.estimate.estimatedNav)} hint={`以 ${fund.runtime.navDate || '--'} 最近官方净值为锚`} tone="neutral" />
        <MetricCard label="场内价格" value={formatCurrency(fund.runtime.marketPrice)} hint={formatRuntimeTime(fund.runtime.marketDate, fund.runtime.marketTime)} tone="neutral" />
        <MetricCard label="场内涨跌幅" value={formatPercent(getMarketChangeRate(fund.runtime))} hint={`昨收 ${formatCurrency(fund.runtime.previousClose)}`} tone={getMarketChangeRate(fund.runtime) >= 0 ? 'positive' : 'negative'} />
        <MetricCard label="自动溢价率" value={formatPercent(fund.estimate.premiumRate)} hint={fund.estimate.premiumRate >= 0 ? '价格高于当日预估净值' : '价格低于当日预估净值'} tone={premiumTone} />
      </section>

      <section className="panel summary-strip summary-strip--stacked">
        <div><span>模型 MAE</span><strong>{formatPercent(fund.model.meanAbsError)}</strong></div>
        <div><span>模型样本数</span><strong>{fund.model.sampleCount}</strong></div>
        {adaptiveStatusEnabled ? (
          <div><span>当日波动修正</span><strong className={adaptiveShockTriggered ? 'tone-positive' : 'muted-text'}>{adaptiveShockTriggered ? '已触发极端分支' : '未触发（常规分支）'}</strong></div>
        ) : null}
      </section>

      <section className="panel split-panel">
        <div className="split-panel__column">
          <div className="panel__header">
            <h2>自动模型说明</h2>
            <p>{driverLabels.summary} 它估的是“以最近官方净值为锚的当日预估净值”，不是已经公布出来的官方净值本身。</p>
          </div>
          <div className="coefficient-grid">
            <div><span>alpha</span><strong>{formatBps(fund.model.alpha)}</strong></div>
            <div><span>betaLead</span><strong>{fund.model.betaLead.toFixed(4)}</strong></div>
            <div><span>betaGap</span><strong>{fund.model.betaGap.toFixed(4)}</strong></div>
            <div><span>{driverLabels.primaryFactor}</span><strong>{formatPercent(fund.estimate.leadReturn)}</strong></div>
            <div><span>{driverLabels.secondaryFactor}</span><strong>{formatPercent(fund.estimate.closeGapReturn)}</strong></div>
            <div><span>最近训练</span><strong>{fund.model.lastUpdatedAt ? formatDateTime(fund.model.lastUpdatedAt) : '暂无'}</strong></div>
          </div>
        </div>
        <div className="split-panel__column">
          <div className="panel__header">
            <h2>误差入口</h2>
            <p>这里同时看净值误差和溢价率误差。净值误差口径为 估值 / 真实净值 - 1；已结算日期的场内价会尽量切到该日收盘参考价。</p>
          </div>
          <div className="summary-strip summary-strip--stacked">
            <div><span>历史已结算样本</span><strong>{fund.journal.errors.length}</strong></div>
            <div><span>最近估值误差</span><strong>{historyPoints.length > 0 ? formatPercent(historyPoints[historyPoints.length - 1].error) : '--'}</strong></div>
          </div>
        </div>
      </section>

      <section className="mini-data-grid">
        {!shouldShowPremiumCompareDetails && premiumCompare ? (
          <section className="chart-card">
            <div className="chart-card__header">
              <h3>第三方估值误差</h3>
              <div className="muted-text">当前只在研究中的重点基金详情页展示分网站误差表，其他基金暂不展开。</div>
            </div>
            <div className="mini-data-empty">该基金暂未开启分网站估值误差明细。</div>
          </section>
        ) : null}

        {shouldShowPremiumCompareDetails && premiumCompare ? (
          <section className="chart-card">
            <div className="chart-card__header">
              <h3>第三方误差总表</h3>
              <div className="muted-text">总表汇总最近30条已结算样本；第一行是本站全样本口径，来源行里的“本站误差MAE”按该来源可结算日期对齐计算。</div>
            </div>
            {summaryProviders.length ? (
              <div className="table-scroll table-scroll--window">
                <table className="mini-data-table mini-data-table--summary">
                  <thead>
                    <tr>
                      <th>来源</th>
                      <th>状态</th>
                      <th>当前溢价率</th>
                      <th>命中(60天)</th>
                      <th>已结算(最近30条)</th>
                      <th>来源误差MAE</th>
                      <th>本站误差MAE(同样本)</th>
                      <th>误差差距</th>
                    </tr>
                  </thead>
                  <tbody>
                    <tr>
                      <td>本站(全样本)</td>
                      <td>--</td>
                      <td>--</td>
                      <td>--</td>
                      <td>{typeof ourPremiumSummary?.settledCount30 === 'number' ? ourPremiumSummary.settledCount30 : 0}/{typeof ourPremiumSummary?.settledWindowSize === 'number' ? ourPremiumSummary.settledWindowSize : 30}</td>
                      <td>--</td>
                      <td>{typeof ourPremiumSummary?.avgAbsOurError30 === 'number' ? formatPercent(ourPremiumSummary.avgAbsOurError30) : '--'}</td>
                      <td>--</td>
                    </tr>
                    {summaryProviders.map((providerItem) => (
                      <tr key={`summary-${providerItem.provider}`}>
                        <td>{getPremiumProviderLabel(providerItem.provider)}</td>
                        <td>{providerItem.sourceUrl ? <a className="fund-table__link" href={providerItem.sourceUrl} target="_blank" rel="noreferrer">{providerItem.status}</a> : providerItem.status}</td>
                        <td className={typeof providerItem.premiumRateCurrent === 'number' ? (providerItem.premiumRateCurrent >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof providerItem.premiumRateCurrent === 'number' ? formatPercent(providerItem.premiumRateCurrent) : '--'}</td>
                        <td>{typeof providerItem.hitCount60 === 'number' ? providerItem.hitCount60 : 0}</td>
                        <td>{typeof providerItem.settledCount30 === 'number' ? providerItem.settledCount30 : providerItem.sampleCount30}/{typeof providerItem.settledWindowSize === 'number' ? providerItem.settledWindowSize : 30}</td>
                        <td>{typeof providerItem.avgAbsProviderError30 === 'number' ? formatPercent(providerItem.avgAbsProviderError30) : '--'}</td>
                        <td>{typeof providerItem.avgAbsOurError30 === 'number' ? formatPercent(providerItem.avgAbsOurError30) : '--'}</td>
                        <td className={getPremiumGapDisplay(getPremiumGapDelta(providerItem.avgAbsProviderError30, providerItem.avgAbsOurError30, providerItem.avgAbsDelta30)).className}>{getPremiumGapDisplay(getPremiumGapDelta(providerItem.avgAbsProviderError30, providerItem.avgAbsOurError30, providerItem.avgAbsDelta30)).text}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : <div className="mini-data-empty">暂未抓到可用的第三方来源数据。</div>}
          </section>
        ) : null}

        <section className="chart-card">
          <div className="chart-card__header">
            <h3>本站最近误差</h3>
            <div className="muted-text">未结算日期显示估值快照；结算后自动回填真实净值与溢价误差。净值误差口径：估值 / 真实净值 - 1；溢价率误差口径：估算溢价率 - 实际收盘溢价率。</div>
          </div>
          {recentSnapshots.length > 0 ? (
            <div className="table-scroll table-scroll--window">
              <table className="mini-data-table mini-data-table--snapshot">
                <thead><tr><th>日期</th><th>状态</th><th>估值</th><th>场内价</th><th>口径</th><th>真实净值</th><th>净值误差</th><th>估算溢价</th><th>实收溢价</th><th>溢价误差</th></tr></thead>
                <tbody>
                  {recentSnapshots.map((item) => {
                    const settled = errorByDate.get(item.estimateDate);
                    const actualNav = settled?.actualNav ?? actualNavByDate.get(item.estimateDate);
                    const hasActual = typeof actualNav === 'number';
                    const estimateError = settled?.error;
                    const premiumError = settled?.premiumError;
                    return (
                      <tr key={item.estimateDate}>
                        <td>{item.estimateDate}</td>
                        <td className={hasActual ? 'tone-positive' : 'muted-text'}>{hasActual ? '已结算' : '待净值'}</td>
                        <td>{formatCurrency(item.estimatedNav)}</td>
                        <td>{formatCurrency(item.marketPrice)}</td>
                        <td>{item.marketPriceType === 'close' ? '收盘' : '快照'}</td>
                        <td>{formatOptionalCurrency(actualNav)}</td>
                        <td className={typeof estimateError === 'number' ? (estimateError >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof estimateError === 'number' ? formatPercent(estimateError) : '--'}</td>
                        <td className={item.premiumRate >= 0 ? 'tone-positive' : 'tone-negative'}>{formatPercent(item.premiumRate)}</td>
                        <td className={typeof settled?.actualPremiumRate === 'number' ? ((settled.actualPremiumRate ?? 0) >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof settled?.actualPremiumRate === 'number' ? formatPercent(settled.actualPremiumRate) : '--'}</td>
                        <td className={typeof premiumError === 'number' ? (premiumError >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof premiumError === 'number' ? formatPercent(premiumError) : '--'}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          ) : <div className="mini-data-empty">还没有历史估值记录。</div>}
        </section>

        {shouldShowPremiumCompareDetails && premiumCompare ? (
          <section className="chart-card">
            <div className="chart-card__header"><h3>东财日度误差</h3><div className="muted-text">与其他来源保持一致：展示来源误差、本站误差和误差差距。待结算样本会先展示，结算后自动补齐误差字段。</div></div>
            {eastmoneyProviderRows.length ? (
              <div className="table-scroll table-scroll--window">
                <table className="mini-data-table mini-data-table--compare">
                  <thead><tr><th>日期</th><th>快照</th><th>场内价</th><th>来源溢价</th><th>来源估值</th><th>本站溢价</th><th>状态</th><th>实收溢价</th><th>来源误差</th><th>本站误差</th><th>差距</th></tr></thead>
                  <tbody>
                    {[...eastmoneyProviderRows].reverse().map((item) => {
                      const estimatedNav = getEstimatedNavFromPremium(item.marketPrice, item.providerPremiumRate);
                      return (
                        <tr key={`eastmoney-${item.date}-${item.time || 'na'}`}>
                          <td>{item.date}</td><td>{item.time || '--'}</td><td>{typeof item.marketPrice === 'number' ? formatCurrency(item.marketPrice) : '--'}</td><td>{formatPercent(item.providerPremiumRate)}</td><td>{typeof estimatedNav === 'number' ? formatCurrency(estimatedNav) : '--'}</td>
                          <td className={typeof item.ourReportedPremiumRate === 'number' ? (item.ourReportedPremiumRate >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof item.ourReportedPremiumRate === 'number' ? formatPercent(item.ourReportedPremiumRate) : '--'}</td>
                          <td className={item.status === 'settled' ? 'tone-positive' : 'muted-text'}>{item.status === 'settled' ? '已结算' : '待结算'}</td>
                          <td className={typeof item.actualPremiumRate === 'number' ? (item.actualPremiumRate >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof item.actualPremiumRate === 'number' ? formatPercent(item.actualPremiumRate) : '--'}</td>
                          <td className={typeof item.providerPremiumError === 'number' ? (item.providerPremiumError <= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof item.providerPremiumError === 'number' ? formatPercent(item.providerPremiumError) : '--'}</td>
                          <td className={typeof item.ourPremiumError === 'number' ? (item.ourPremiumError <= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof item.ourPremiumError === 'number' ? formatPercent(item.ourPremiumError) : '--'}</td>
                          <td className={getPremiumGapDisplay(getPremiumGapDelta(item.providerPremiumError, item.ourPremiumError, item.premiumErrorDelta)).className}>{getPremiumGapDisplay(getPremiumGapDelta(item.providerPremiumError, item.ourPremiumError, item.premiumErrorDelta)).text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="mini-data-empty">暂未抓到可用于反算的东财溢价率快照。</div>}
          </section>
        ) : null}

        {shouldShowPremiumCompareDetails && premiumCompare ? otherPremiumProviders.map((item) => (
          <section className="chart-card" key={`provider-card-${item.provider}`}>
            <div className="chart-card__header">
              <h3>{getPremiumProviderLabel(item.provider)}日度误差</h3>
              <div className="muted-text">仅保留最近30条已结算样本，并保留已抓到溢价率但尚未结算的待验证样本。</div>
            </div>
            {item.rows.length ? (
              <div className="table-scroll table-scroll--window">
                <table className="mini-data-table mini-data-table--compare">
                  <thead><tr><th>日期</th><th>快照</th><th>场内价</th><th>来源溢价</th><th>来源估值</th><th>本站溢价</th><th>状态</th><th>实收溢价</th><th>来源误差</th><th>本站误差</th><th>差距</th></tr></thead>
                  <tbody>
                    {[...item.rows].reverse().map((dailyItem) => {
                      const estimatedNav = getEstimatedNavFromPremium(dailyItem.marketPrice, dailyItem.providerPremiumRate);
                      return (
                        <tr key={`${item.provider}-${dailyItem.date}-${dailyItem.time || 'na'}`}>
                          <td>{dailyItem.date}</td><td>{dailyItem.time || '--'}</td><td>{typeof dailyItem.marketPrice === 'number' ? formatCurrency(dailyItem.marketPrice) : '--'}</td><td>{formatPercent(dailyItem.providerPremiumRate)}</td>
                          <td>{typeof estimatedNav === 'number' ? formatCurrency(estimatedNav) : '--'}</td>
                          <td className={typeof dailyItem.ourReportedPremiumRate === 'number' ? (dailyItem.ourReportedPremiumRate >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof dailyItem.ourReportedPremiumRate === 'number' ? formatPercent(dailyItem.ourReportedPremiumRate) : '--'}</td>
                          <td className={dailyItem.status === 'settled' ? 'tone-positive' : 'muted-text'}>{dailyItem.status === 'settled' ? '已结算' : '待结算'}</td>
                          <td className={typeof dailyItem.actualPremiumRate === 'number' ? (dailyItem.actualPremiumRate >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof dailyItem.actualPremiumRate === 'number' ? formatPercent(dailyItem.actualPremiumRate) : '--'}</td>
                          <td className={typeof dailyItem.providerPremiumError === 'number' ? (dailyItem.providerPremiumError <= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof dailyItem.providerPremiumError === 'number' ? formatPercent(dailyItem.providerPremiumError) : '--'}</td>
                          <td className={typeof dailyItem.ourPremiumError === 'number' ? (dailyItem.ourPremiumError <= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{typeof dailyItem.ourPremiumError === 'number' ? formatPercent(dailyItem.ourPremiumError) : '--'}</td>
                          <td className={getPremiumGapDisplay(getPremiumGapDelta(dailyItem.providerPremiumError, dailyItem.ourPremiumError, dailyItem.premiumErrorDelta)).className}>{getPremiumGapDisplay(getPremiumGapDelta(dailyItem.providerPremiumError, dailyItem.ourPremiumError, dailyItem.premiumErrorDelta)).text}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : <div className="mini-data-empty">该来源暂无日度记录。</div>}
          </section>
        )) : null}

        {fund.runtime.proxyBasketName || recentProxyQuotes.length > 0 ? (
          <section className="chart-card">
            <div className="chart-card__header">
              <h3>代理篮子</h3>
              <div className="muted-text">{fund.runtime.proxyBasketName || '代理篮子'} {formatRuntimeTime(fund.runtime.proxyQuoteDate || '', fund.runtime.proxyQuoteTime || '')}</div>
            </div>
            {recentProxyQuotes.length > 0 ? (
              <div className="table-scroll table-scroll--window">
                <table className="mini-data-table">
                  <thead>
                    <tr>
                      <th>代码</th>
                      <th>名称</th>
                      <th>权重</th>
                      <th>涨跌幅</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentProxyQuotes.map((item) => (
                      <tr key={item.ticker}>
                        <td>{item.ticker}</td>
                        <td>{item.name}</td>
                        <td>{formatPercent(item.weight)}</td>
                        <td className={getProxyChange(item.currentPrice, item.previousClose) >= 0 ? 'tone-positive' : 'tone-negative'}>{formatPercent(getProxyChange(item.currentPrice, item.previousClose))}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="mini-data-empty">该基金当前有代理篮子配置，但本次同步未抓到可展示的代理行情明细。</div>
            )}
          </section>
        ) : null}

        {fund.runtime.disclosedHoldings?.length ? (
          <section className="chart-card">
            <div className="chart-card__header">
              <h3>最新前十大持仓公告</h3>
              <div className="muted-text">
                {fund.runtime.disclosedHoldingsTitle || '基金持仓'} {fund.runtime.disclosedHoldingsReportDate ? `截止至 ${fund.runtime.disclosedHoldingsReportDate}` : ''}
                {fund.runtime.disclosedHoldings?.length ? `，前十大持仓合计 ${top10WeightPercent.toFixed(2)}%` : ''}
                {fund.runtime.holdingsQuoteDate ? `，行情时间 ${formatRuntimeTime(fund.runtime.holdingsQuoteDate, fund.runtime.holdingsQuoteTime || '')}` : ''}
              </div>
            </div>
            <div className="table-scroll table-scroll--window">
              <table className="mini-data-table">
                <thead>
                  <tr>
                    <th>代码</th>
                    <th>名称</th>
                    <th>权重</th>
                    <th>现价</th>
                    <th>涨跌幅</th>
                  </tr>
                </thead>
                <tbody>
                  {fund.runtime.disclosedHoldings.map((item) => (
                    <tr key={`${item.ticker}-${item.name}`}>
                      <td>{item.ticker}</td>
                      <td>{item.name}</td>
                      <td>{formatHoldingWeight(item.weight)}</td>
                      <td>{formatOptionalCurrency(item.currentPrice)}</td>
                      <td className={typeof item.changeRate === 'number' ? (item.changeRate >= 0 ? 'tone-positive' : 'tone-negative') : 'muted-text'}>{formatOptionalChangeRate(item.changeRate)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        ) : null}

      </section>

      {showOfflineResearch ? (
        <section className="panel">
          <div className="panel__header">
            <h2>{fund.runtime.code} 离线本地出图研究</h2>
            <p>
              该图由本地脚本在同步后离线生成并写入站点静态文件，避免浏览器端多图叠加造成的可读性问题。
              当前页面只保留按持仓披露期分段训练的结果展示，不再展示双目标对比和时序类试验界面。
            </p>
          </div>

          <div className="table-scroll table-scroll--window">
            <table className="mini-data-table">
              <thead>
                <tr>
                  <th>方案</th>
                  <th>训练 MAE</th>
                  <th>验证 MAE</th>
                  <th>验证近30 MAE</th>
                  <th>验证近30鲁棒 MAE</th>
                  <th>验证加权 MAE</th>
                  <th>补充信息</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>持仓期分段训练</td>
                  <td>{Number.isFinite(offlineResearch.segmented.maeTrain) ? formatPercent(offlineResearch.segmented.maeTrain) : '--'}</td>
                  <td>{Number.isFinite(offlineResearch.segmented.maeValidation) ? formatPercent(offlineResearch.segmented.maeValidation) : '--'}</td>
                  <td>{Number.isFinite(offlineResearch.segmented.maeValidation30) ? formatPercent(offlineResearch.segmented.maeValidation30) : '--'}</td>
                  <td>{Number.isFinite(offlineResearch.segmented.maeValidation30Robust) ? formatPercent(offlineResearch.segmented.maeValidation30Robust || 0) : '--'}</td>
                  <td>{Number.isFinite(offlineResearch.segmented.maeValidation30Weighted) ? formatPercent(offlineResearch.segmented.maeValidation30Weighted || 0) : (Number.isFinite(offlineResearch.segmented.maeValidationWeighted) ? formatPercent(offlineResearch.segmented.maeValidationWeighted || 0) : '--')}</td>
                  <td>{`披露期数 ${offlineResearch.disclosureCount} 个${typeof offlineResearch.avgHoldingCoverage === 'number' ? `，平均覆盖 ${(offlineResearch.avgHoldingCoverage * 100).toFixed(1)}%` : ''}`}</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="research-time-note">
            训练集：{offlineResearch.trainRange}；验证集：{offlineResearch.validationRange}；切分模式：{offlineResearch.splitMode}。
            {offlineResearch.notes}
            {Number.isFinite(offlineResearch.segmented.maeValidation30Robust) ? ' 当前专项优化优先看“验证近30鲁棒 MAE”（剔除已标记异常日并做尾部鲁棒处理）。' : ''}
          </div>

          <div className="offline-research-image-wrap">
            <img
              className="offline-research-image"
              src={`${offlineResearch.chartPath}?ts=${encodeURIComponent(offlineChartVersion)}`}
              alt={`${fund.runtime.code} 离线研究图`}
              loading="lazy"
            />
          </div>
        </section>
      ) : null}

      <section className="chart-grid">
        <LineChart title="估值与真实净值" primary={estimatedSeries} secondary={actualSeries} primaryLabel="昨日估值" secondaryLabel="后续真实净值" valueFormatter={formatCurrency} />
        <LineChart title="估值误差折线" primary={errorSeries} primaryLabel="误差" valueFormatter={formatPercent} />
      </section>
    </main>
  );
}

function MemberGate({ message }: { message: string }) {
  return (
    <main className="page">
      <section className="panel notice-panel">
        <h2>会员权限说明</h2>
        <p>{message}</p>
        <p>注册登录即送 7 天会员；赞赏 5 元 = 30 天，赞赏 10 元 = 90 天，1 个月按 30 天计算。</p>
        <div className="page-tabs">
          <Link className="page-tab page-tab--active" to="/member">前往会员中心</Link>
          <Link className="page-tab" to="/qdii-lof">返回首页</Link>
        </div>
      </section>
    </main>
  );
}

function AuthCallbackPage() {
  const location = useLocation();
  const navigate = useNavigate();
  const [status, setStatus] = useState<'loading' | 'success' | 'error'>('loading');
  const [message, setMessage] = useState('正在处理 Authing 登录回调...');

  useEffect(() => {
    const params = new URLSearchParams(location.search);
    const code = params.get('code');
    const error = params.get('error');
    const errorDescription = params.get('error_description');

    if (error) {
      setStatus('error');
      setMessage(errorDescription || error || 'Authing 登录失败');
      return;
    }

    if (!code) {
      setStatus('error');
      setMessage('没有收到授权 code。请返回会员中心重新发起登录。');
      return;
    }

    setStatus('success');
    setMessage('已成功收到 Authing 授权 code。当前已打通跳转与回调页，下一步只需把 code 提交给 Worker 建立你网站自己的登录态。');
  }, [location.search]);

  return (
    <main className="page">
      <section className="panel notice-panel auth-callback-panel">
        <div className="panel__header">
          <span className="eyebrow">AUTHING CALLBACK</span>
          <h2>{status === 'success' ? '授权回调已接收' : status === 'error' ? '授权回调失败' : '正在处理授权回调'}</h2>
          <p>{message}</p>
        </div>
        <div className="page-tabs">
          <button className="member-primary-btn" type="button" onClick={() => navigate('/member')}>
            返回会员中心
          </button>
          <a className="page-tab" href={buildAuthingAuthorizeUrl('login')}>
            重新发起 Authing 登录
          </a>
        </div>
      </section>
    </main>
  );
}

function MemberCenter({
  currentUser,
  onAuthingLogin,
  onLogout,
  onRedeem,
  onCreateOrder,
  onLoadOrders,
  onLoadEvents,
  onLoadAdminOrders,
  onUpdateOrderOcr,
  onGrantMembership,
  onBlockUser,
  pending,
}: {
  currentUser: AuthUser | null;
  onAuthingLogin: (accessToken: string) => Promise<void>;
  onLogout: () => Promise<void>;
  onRedeem: (code: string) => Promise<void>;
  onCreateOrder: (channel: 'wechat' | 'alipay', amountFen: number, screenshotUrl: string) => Promise<void>;
  onLoadOrders: () => Promise<Array<Record<string, unknown>>>;
  onLoadEvents: () => Promise<Array<Record<string, unknown>>>;
  onLoadAdminOrders: () => Promise<Array<Record<string, unknown>>>;
  onUpdateOrderOcr: (orderNo: string, ocrSummary: string) => Promise<void>;
  onGrantMembership: (accountId: string, days: number, description: string) => Promise<void>;
  onBlockUser: (accountId: string, status: 'blocked' | 'active') => Promise<void>;
  pending: boolean;
}) {
  const [codeLoginForm, setCodeLoginForm] = useState({ email: '', code: '' });
  const [codeSending, setCodeSending] = useState(false);
  const [codeCountdown, setCodeCountdown] = useState(0);
  const [codeNotice, setCodeNotice] = useState('');
  const [redeemCode, setRedeemCode] = useState('');
  const [orderForm, setOrderForm] = useState({ channel: 'wechat' as 'wechat' | 'alipay', amountFen: 500, screenshotUrl: '' });
  const [uploadingScreenshot, setUploadingScreenshot] = useState(false);
  const [orders, setOrders] = useState<Array<Record<string, unknown>>>([]);
  const [events, setEvents] = useState<Array<Record<string, unknown>>>([]);
  const [adminOrders, setAdminOrders] = useState<Array<Record<string, unknown>>>([]);
  const [ocrInput, setOcrInput] = useState<Record<string, string>>({});
  const [grantForm, setGrantForm] = useState({ accountId: '', days: 30, description: '管理员手工赠送会员' });
  const [blockForm, setBlockForm] = useState({ accountId: '', status: 'blocked' as 'blocked' | 'active' });

  useEffect(() => {
    if (!currentUser) return;
    void onLoadOrders().then(setOrders).catch(() => setOrders([]));
    void onLoadEvents().then(setEvents).catch(() => setEvents([]));
    if (currentUser.accountId === 'admin') {
      void onLoadAdminOrders().then(setAdminOrders).catch(() => setAdminOrders([]));
    }
  }, [currentUser, onLoadAdminOrders, onLoadEvents, onLoadOrders]);

  // 验证码倒计时
  useEffect(() => {
    if (codeCountdown <= 0) return;
    const timer = window.setTimeout(() => setCodeCountdown((v) => v - 1), 1000);
    return () => clearTimeout(timer);
  }, [codeCountdown]);

  const handleSendCode = async () => {
    const email = codeLoginForm.email.trim();
    if (!email || codeSending || codeCountdown > 0) return;
    setCodeSending(true);
    try {
      const result = await fetchApi<{ ok: true; message?: string }>('/api/auth/send-code', { method: 'POST', body: JSON.stringify({ email }) });
      setCodeCountdown(60);
      setCodeNotice(result.message || '验证码已发送，请留意邮箱。');
    } catch (error) {
      setCodeNotice(error instanceof Error ? error.message : '验证码发送失败');
      throw error;
    } finally {
      setCodeSending(false);
    }
  };

  const handleCodeLogin = async () => {
    const email = codeLoginForm.email.trim();
    const code = codeLoginForm.code.trim();
    if (!email || !code) return;
    await onAuthingLogin(JSON.stringify({ email, code }));
  };

  const handleScreenshotSelect = async (file: File | null) => {
    if (!file) return;
    setUploadingScreenshot(true);
    try {
      const formData = new FormData();
      formData.append('file', file);
      const response = await fetch(`${getRuntimeApiBase()}/api/order/upload-screenshot`, {
        method: 'POST',
        credentials: 'include',
        body: formData,
      });
      const data = await response.json();
      if (!response.ok || data?.ok === false) {
        throw new Error(data?.error || `http-${response.status}`);
      }
      setOrderForm((current) => ({ ...current, screenshotUrl: data.url || '' }));
    } finally {
      setUploadingScreenshot(false);
    }
  };

  return (
    <DesktopShell currentPath="/member" currentUser={currentUser} title="会员中心" subtitle="">
      <div className="member-shell-inner">
      {!currentUser ? (
        <section className="member-login-center">
          <div className="member-login-card">
            <div className="member-login-card__header">
              <h2 className="member-login-card__title">欢迎使用</h2>
              <p className="member-login-card__desc">输入邮箱，接收验证码后即可登录或自动注册。</p>
            </div>
            <div className="member-login-card__body">
              <label className="member-login-field">
                <span className="member-login-field__label">邮箱地址</span>
                <input
                  className="member-login-field__input"
                  value={codeLoginForm.email}
                  onChange={(e) => setCodeLoginForm((s) => ({ ...s, email: e.target.value }))}
                  placeholder="请输入邮箱"
                  type="email"
                  autoComplete="email"
                />
              </label>
              <label className="member-login-field">
                <span className="member-login-field__label">验证码</span>
                <div className="member-login-code-row">
                  <input
                    className="member-login-field__input"
                    value={codeLoginForm.code}
                    onChange={(e) => setCodeLoginForm((s) => ({ ...s, code: e.target.value }))}
                    placeholder="请输入验证码"
                    maxLength={6}
                    autoComplete="one-time-code"
                  />
                  <button
                    className="member-login-code-btn"
                    type="button"
                    disabled={codeSending || codeCountdown > 0 || !codeLoginForm.email.trim()}
                    onClick={() => void handleSendCode()}
                  >
                    {codeCountdown > 0 ? `${codeCountdown}s` : codeSending ? '发送中...' : '发送验证码'}
                  </button>
                </div>
                {codeNotice ? <small className="member-login-field__hint">{codeNotice}</small> : null}
              </label>
              <button
                className="member-login-submit"
                type="button"
                disabled={pending || !codeLoginForm.email.trim() || !codeLoginForm.code.trim()}
                onClick={() => void handleCodeLogin()}
              >
                登录 / 注册
              </button>
            </div>
          </div>
        </section>
      ) : (
        <>
          <section className="member-dashboard-grid">
            <div className="member-panel member-panel--profile">
              <h3>账户信息</h3>
              <p>账号：{currentUser.accountId}</p>
              <p>昵称：{currentUser.nickname}</p>
              <p>会员到期：{formatMemberExpiry(currentUser.membership.expiresAt)}</p>
              <button className="member-secondary-btn" type="button" disabled={pending} onClick={() => void onLogout()}>退出登录</button>
            </div>
            <div className="member-panel member-panel--redeem">
              <h3>兑换码</h3>
              <input value={redeemCode} onChange={(e) => setRedeemCode(e.target.value)} placeholder="输入兑换码" />
              <button className="member-primary-btn" type="button" disabled={pending} onClick={() => void onRedeem(redeemCode)}>立即兑换</button>
              <p>兑换成功后会员期限自动顺延，过期由服务端时间自动判定。</p>
            </div>
          </section>
          <section className="member-dashboard-grid member-dashboard-grid--wide">
            <div className="member-panel member-panel--sponsor">
              <h3>赞赏开通</h3>
              <select value={String(orderForm.amountFen)} onChange={(e) => setOrderForm((s) => ({ ...s, amountFen: Number(e.target.value) }))}>
                <option value="500">5 元 = 30 天会员</option>
                <option value="1000">10 元 = 90 天会员</option>
              </select>
              <select value={orderForm.channel} onChange={(e) => setOrderForm((s) => ({ ...s, channel: e.target.value as 'wechat' | 'alipay' }))}>
                <option value="wechat">微信赞赏</option>
                <option value="alipay">支付宝</option>
              </select>
              <input type="file" accept="image/*" onChange={(e) => void handleScreenshotSelect(e.target.files?.[0] ?? null)} />
              <input value={orderForm.screenshotUrl} onChange={(e) => setOrderForm((s) => ({ ...s, screenshotUrl: e.target.value }))} placeholder="截图上传后自动回填地址" readOnly />
              <button className="member-primary-btn member-primary-btn--gold" type="button" disabled={pending || uploadingScreenshot || !orderForm.screenshotUrl} onClick={() => void onCreateOrder(orderForm.channel, orderForm.amountFen, orderForm.screenshotUrl)}>{uploadingScreenshot ? '截图上传中...' : '提交待审核订单'}</button>
              <p>当前已支持真实截图上传到云端存储；OCR 结果仍由管理审核页回填。</p>
            </div>
            <div className="member-panel member-panel--rules">
              <h3>规则说明</h3>
              <p>游客仅可查看首页基础内容，无法进入详情页。</p>
              <p>首页对游客隐藏最近误差、30d误差两列。</p>
              <p>被邀请人注册后 7 天内首次赞赏到账，上下级获得同样会员时长。</p>
              <p>1 个月 = 30 天。</p>
            </div>
          </section>
          <section className="member-dashboard-grid member-dashboard-grid--wide">
            <div className="member-panel member-panel--orders">
              <h3>我的订单</h3>
              {orders.length ? orders.map((item) => <p key={String(item.order_no)}>{String(item.order_no)}｜{String(item.status)}｜{String(item.channel)}｜{Number(item.amount_fen || 0) / 100}元</p>) : <p>暂无订单</p>}
            </div>
            <div className="member-panel member-panel--events">
              <h3>会员流水</h3>
              {events.length ? events.map((item, index) => <p key={`${String(item.created_at)}-${index}`}>{String(item.created_at)}｜{String(item.event_type)}｜+{String(item.days)}天｜{String(item.description)}</p>) : <p>暂无流水</p>}
            </div>
          </section>
          {currentUser.accountId === 'admin' ? (
            <section className="member-dashboard-grid member-dashboard-grid--wide">
              <div className="member-panel member-panel--admin member-panel--full">
                <h3>审核后台</h3>
                {adminOrders.length ? adminOrders.map((item) => {
                  const orderNo = String(item.order_no || '');
                  return (
                    <div key={orderNo} className="admin-order-row">
                      <p>{orderNo}｜{String(item.status)}｜OCR：{String(item.ocr_status)}｜{Number(item.amount_fen || 0) / 100}元</p>
                      <input value={ocrInput[orderNo] || ''} onChange={(e) => setOcrInput((s) => ({ ...s, [orderNo]: e.target.value }))} placeholder="回填 OCR 摘要" />
                      <button className="member-secondary-btn" type="button" disabled={pending} onClick={() => void onUpdateOrderOcr(orderNo, ocrInput[orderNo] || '')}>写入 OCR 摘要</button>
                    </div>
                  );
                }) : <p>暂无待审核订单</p>}
              </div>
            </section>
          ) : null}
          {currentUser.accountId === 'admin' ? (
            <section className="member-dashboard-grid member-dashboard-grid--wide">
              <div className="member-panel member-panel--grant">
                <h3>会员补单 / 手工赠送</h3>
                <input value={grantForm.accountId} onChange={(e) => setGrantForm((s) => ({ ...s, accountId: e.target.value }))} placeholder="账号" />
                <input type="number" value={grantForm.days} onChange={(e) => setGrantForm((s) => ({ ...s, days: Number(e.target.value) || 30 }))} placeholder="天数" />
                <input value={grantForm.description} onChange={(e) => setGrantForm((s) => ({ ...s, description: e.target.value }))} placeholder="说明" />
                <button className="member-primary-btn" type="button" disabled={pending} onClick={() => void onGrantMembership(grantForm.accountId, grantForm.days, grantForm.description)}>发放会员</button>
              </div>
              <div className="member-panel member-panel--block">
                <h3>封禁 / 解封账户</h3>
                <input value={blockForm.accountId} onChange={(e) => setBlockForm((s) => ({ ...s, accountId: e.target.value }))} placeholder="账号" />
                <select value={blockForm.status} onChange={(e) => setBlockForm((s) => ({ ...s, status: e.target.value as 'blocked' | 'active' }))}>
                  <option value="blocked">封禁</option>
                  <option value="active">解封</option>
                </select>
                <button className="member-primary-btn member-primary-btn--danger" type="button" disabled={pending} onClick={() => void onBlockUser(blockForm.accountId, blockForm.status)}>{blockForm.status === 'blocked' ? '封禁账户' : '恢复账户'}</button>
              </div>
            </section>
          ) : null}
        </>
      )}
      </div>
    </DesktopShell>
  );
}

export default function App() {
  const [funds, setFunds] = useState<FundViewModel[]>([]);
  const [syncedAt, setSyncedAt] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [toasts, setToasts] = useState<Array<{ id: string; message: string; type: 'error' | 'success' | 'warning' }>>([]);
  const [trainingMetricsByCode, setTrainingMetricsByCode] = useState<Record<string, TrainingMetricSummary>>({});
  const [premiumCompareCodes, setPremiumCompareCodes] = useState<Record<string, PremiumCompareCodePayload>>({});
  const [currentUser, setCurrentUser] = useState<AuthUser | null>(null);
  const [authPending, setAuthPending] = useState(false);

  const showToast = (message: string, type: 'error' | 'success' | 'warning' = 'error') => {
    const id = `${type}-${Date.now()}`;
    setToasts((prev) => {
      if (prev.some((item) => item.message === message && item.type === type)) {
        return prev;
      }
      return [...prev.slice(-2), { id, message, type }];
    });
    setTimeout(() => {
      setToasts((prev) => prev.filter((t) => t.id !== id));
    }, TOAST_AUTO_CLOSE_MS);
  };

  useEffect(() => {
    let active = true;
    async function loadCurrentUser() {
      try {
        const payload = await fetchApi<{ ok: true; user: AuthUser }>('/api/auth/me', { method: 'GET' });
        if (active) setCurrentUser(payload.user);
      } catch {
        if (active) setCurrentUser(null);
      }
    }
    void loadCurrentUser();
    return () => {
      active = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    let timer = 0;
    let loadingRuntime = false;

    async function loadRuntime(options?: { silent?: boolean }) {
      const silent = Boolean(options?.silent);
      if (loadingRuntime) {
        return;
      }
      loadingRuntime = true;
      if (!silent) {
        setLoading(true);
        setError('');
      }

      try {
        let payload: RuntimePayload;
        try {
          payload = await fetchApi<RuntimePayload>('/api/runtime/all', { method: 'GET' });
        } catch {
          const staticPayload = await fetchGeneratedJson<{ syncedAt: string; funds: FundRuntimeData[] }>('funds-runtime.json');
          payload = {
            ok: true,
            syncedAt: staticPayload.syncedAt,
            funds: staticPayload.funds,
            sourceUrl: '',
            stateByCode: {},
          } as RuntimePayload;
        }
        const nextFunds = payload.funds.map((runtime: FundRuntimeData) => {
          const persistedState = payload.stateByCode?.[runtime.code];
          const initialModel = normalizeWatchlistModel(persistedState?.model ?? readWatchlistModel(runtime.code));
          const initialJournal = normalizeFundJournal(persistedState?.journal ?? readFundJournal(runtime.code));
          const reconciled = reconcileJournal(runtime, initialModel, initialJournal);
          const estimate = estimateWatchlistFund(runtime, reconciled.model, reconciled.journal);
          const journal = recordEstimateSnapshot(reconciled.journal, runtime, estimate);

          writeWatchlistModel(runtime.code, reconciled.model);
          writeFundJournal(runtime.code, journal);

          return {
            runtime,
            model: reconciled.model,
            journal,
            estimate,
          };
        });

        nextFunds.sort((left, right) => left.runtime.priority - right.runtime.priority);

        if (!active) {
          return;
        }

        setFunds(nextFunds);
        setSyncedAt(payload.syncedAt);
      } catch (loadError) {
        if (!active) {
          return;
        }

        const errorMsg = loadError instanceof Error ? loadError.message : '同步失败';
        if (isAbortLikeError(loadError)) {
          return;
        }

        if (!silent) {
          setError(errorMsg);
          showToast(errorMsg, 'error');
        }
      } finally {
        loadingRuntime = false;
        if (active && !silent) {
          setLoading(false);
        }
      }
    }

    function scheduleNextRefresh() {
      timer = window.setTimeout(() => {
        void loadRuntime({ silent: true }).finally(() => {
          if (active) {
            scheduleNextRefresh();
          }
        });
      }, getRuntimeRefreshInterval());
    }

    function triggerImmediateRefresh() {
      window.clearTimeout(timer);
      void loadRuntime({ silent: true }).finally(() => {
        if (active) {
          scheduleNextRefresh();
        }
      });
    }

    function handleVisibilityChange() {
      if (document.visibilityState === 'visible') {
        triggerImmediateRefresh();
      }
    }

    void loadRuntime({ silent: false });
    scheduleNextRefresh();
    window.addEventListener('focus', triggerImmediateRefresh);
    window.addEventListener('pageshow', triggerImmediateRefresh);
    document.addEventListener('visibilitychange', handleVisibilityChange);

    return () => {
      active = false;
      window.clearTimeout(timer);
      window.removeEventListener('focus', triggerImmediateRefresh);
      window.removeEventListener('pageshow', triggerImmediateRefresh);
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, []);

  useEffect(() => {
    let active = true;

    if (!syncedAt) {
      setTrainingMetricsByCode({});
      return () => {
        active = false;
      };
    }

    async function loadTrainingMetrics() {
      // 优先从 Worker API 加载训练指标
      try {
        const apiBase = getRuntimeApiBase();
        const response = await fetch(`${apiBase}/api/training/metrics`);
        if (response.ok) {
          const data = await response.json();
          if (data.ok && data.metrics) {
            const next: Record<string, TrainingMetricSummary> = {};
            for (const metric of data.metrics) {
              if (metric && Number.isFinite(metric.maeValidation30)) {
                next[metric.code] = {
                  maeTrain: metric.maeTrain,
                  maeValidation: metric.maeValidation,
                  maeValidation30: metric.maeValidation30Robust ?? metric.maeValidation30,
                  maeValidation30Robust: metric.maeValidation30Robust,
                  generatedAt: metric.generatedAt,
                };
              }
            }
            if (Object.keys(next).length > 0) {
              if (!active) return;
              setTrainingMetricsByCode(next);
              console.log(`[TrainingMetrics] Loaded ${Object.keys(next).length} metrics from Worker API`);
              return;
            }
          }
        }
      } catch (error) {
        console.warn('[TrainingMetrics] Failed to load from Worker API, falling back to local files:', error);
      }

      // 回退到本地 JSON 文件
      const entries = await Promise.all(
        [...OFFLINE_RESEARCH_CODES].map(async (code) => {
          try {
            const payload = await fetchGeneratedJson<OfflineResearchSummary>(`${code}-offline-research.json`);
            const maeValidation30 = Number(payload?.segmented?.maeValidation30);
            const maeValidation30Robust = Number((payload as OfflineResearchSummary & { segmented?: { maeValidation30Robust?: number } })?.segmented?.maeValidation30Robust);
            const maeValidation = Number(payload?.segmented?.maeValidation);
            const maeTrain = Number(payload?.segmented?.maeTrain);
            if (!Number.isFinite(maeValidation30)) {
              return null;
            }

            return [code, {
              maeTrain,
              maeValidation,
              maeValidation30: Number.isFinite(maeValidation30Robust) ? maeValidation30Robust : maeValidation30,
              maeValidation30Robust: Number.isFinite(maeValidation30Robust) ? maeValidation30Robust : undefined,
              generatedAt: payload.generatedAt,
            }] as const;
          } catch {
            return null;
          }
        }),
      );

      if (!active) {
        return;
      }

      const next: Record<string, TrainingMetricSummary> = {};
      for (const item of entries) {
        if (!item) {
          continue;
        }
        next[item[0]] = item[1];
      }
      setTrainingMetricsByCode(next);
    }

    void loadTrainingMetrics();

    return () => {
      active = false;
    };
  }, [syncedAt]);

  const isMember = Boolean(currentUser?.membership.isActive);

  const refreshCurrentUser = async () => {
    try {
      const payload = await fetchApi<{ ok: true; user: AuthUser }>('/api/auth/me', { method: 'GET' });
      setCurrentUser(payload.user);
    } catch {
      setCurrentUser(null);
    }
  };

  const runAuthAction = async (runner: () => Promise<void>) => {
    setAuthPending(true);
    try {
      await runner();
    } catch (error) {
      showToast(error instanceof Error ? error.message : String(error), 'error');
    } finally {
      setAuthPending(false);
    }
  };

  const handleLogin = async (accountId: string, password: string) => runAuthAction(async () => {
    await fetchApi('/api/auth/login', { method: 'POST', body: JSON.stringify({ accountId, password }) });
    await refreshCurrentUser();
    showToast('登录成功', 'success');
  });

  const handleRegister = async (accountId: string, password: string, nickname: string, inviteCode: string) => runAuthAction(async () => {
    await fetchApi('/api/auth/register', { method: 'POST', body: JSON.stringify({ accountId, password, nickname, inviteCode }) });
    await refreshCurrentUser();
    showToast('注册成功，已发放 7 天会员', 'success');
  });

  const handleAuthingLogin = async (payload: string) => runAuthAction(async () => {
    const data = JSON.parse(payload) as { email: string; code: string };
    await fetchApi('/api/auth/code-login', { method: 'POST', body: JSON.stringify(data) });
    await refreshCurrentUser();
    showToast('登录成功', 'success');
  });

  const handleLogout = async () => runAuthAction(async () => {
    await fetchApi('/api/auth/logout', { method: 'POST' });
    setCurrentUser(null);
    showToast('已退出登录', 'success');
  });

  const handleRedeem = async (code: string) => runAuthAction(async () => {
    await fetchApi('/api/redeem/apply', { method: 'POST', body: JSON.stringify({ code }) });
    await refreshCurrentUser();
    showToast('兑换成功', 'success');
  });

  const handleCreateOrder = async (channel: 'wechat' | 'alipay', amountFen: number, screenshotUrl: string) => runAuthAction(async () => {
    await fetchApi('/api/order/create-manual', { method: 'POST', body: JSON.stringify({ channel, amountFen, screenshotUrl }) });
    showToast('订单已提交，等待审核', 'success');
  });

  const handleLoadOrders = async () => {
    const payload = await fetchApi<{ ok: true; orders: Array<Record<string, unknown>> }>('/api/order/my', { method: 'GET' });
    return payload.orders || [];
  };

  const handleLoadEvents = async () => {
    const payload = await fetchApi<{ ok: true; events: Array<Record<string, unknown>> }>('/api/member/events', { method: 'GET' });
    return payload.events || [];
  };

  const handleLoadAdminOrders = async () => {
    const payload = await fetchApi<{ ok: true; orders: Array<Record<string, unknown>> }>('/api/admin/orders', { method: 'GET' });
    return payload.orders || [];
  };

  const handleUpdateOrderOcr = async (orderNo: string, ocrSummary: string) => runAuthAction(async () => {
    await fetchApi('/api/admin/order/ocr', { method: 'POST', body: JSON.stringify({ orderNo, ocrStatus: 'reviewed', ocrSummary }) });
    showToast('OCR 摘要已更新', 'success');
  });

  const handleGrantMembership = async (accountId: string, days: number, description: string) => runAuthAction(async () => {
    await fetchApi('/api/admin/member/grant', { method: 'POST', body: JSON.stringify({ accountId, days, description }) });
    showToast('会员补单成功', 'success');
  });

  const handleBlockUser = async (accountId: string, status: 'blocked' | 'active') => runAuthAction(async () => {
    await fetchApi('/api/admin/user/block', { method: 'POST', body: JSON.stringify({ accountId, status }) });
    showToast(status === 'blocked' ? '账号已封禁' : '账号已恢复', 'success');
  });

  const handleRequireMember = (code: string) => {
    showToast(`${MEMBER_COPY} 基金代码：${code}`, 'warning');
  };

  useEffect(() => {
    let active = true;

    if (!syncedAt) {
      setPremiumCompareCodes({});
      return () => {
        active = false;
      };
    }

    async function loadPremiumCompareCodes() {
      try {
        const payload = await fetchGeneratedJson<PremiumComparePayload>('premium-compare.json');
        if (!active) {
          return;
        }

        setPremiumCompareCodes(payload?.codes ?? {});
      } catch {
        if (active) {
          setPremiumCompareCodes({});
        }
      }
    }

    void loadPremiumCompareCodes();

    return () => {
      active = false;
    };
  }, [syncedAt]);

  return (
    <div className="app-shell">
      <div className="background-orb background-orb--amber" />
      <div className="background-orb background-orb--teal" />
      
      {/* Toast notifications container */}
      <div className="toast-container">
        {toasts.map((toast) => (
          <div key={toast.id} className={`toast toast--${toast.type}`}>
            <span>{toast.message}</span>
            <button
              className="toast__close"
              onClick={() => setToasts((prev) => prev.filter((t) => t.id !== toast.id))}
              aria-label="关闭"
            >
              ×
            </button>
          </div>
        ))}
      </div>

      <AppErrorBoundary>
        <Routes>
          <Route path="/" element={<Navigate to="/qdii-lof" replace />} />
          <Route path="/auth/callback" element={<AuthCallbackPage />} />
          <Route path="/domestic-lof" element={<HomePage funds={funds} syncedAt={syncedAt} loading={loading} error={error} pageCategory="domestic-lof" trainingMetricsByCode={trainingMetricsByCode} premiumCompareCodes={premiumCompareCodes} isMember={isMember} currentUser={currentUser} onRequireMember={handleRequireMember} />} />
          <Route path="/qdii-lof" element={<HomePage funds={funds} syncedAt={syncedAt} loading={loading} error={error} pageCategory="qdii-lof" trainingMetricsByCode={trainingMetricsByCode} premiumCompareCodes={premiumCompareCodes} isMember={isMember} currentUser={currentUser} onRequireMember={handleRequireMember} />} />
          <Route path="/qdii-etf" element={<HomePage funds={funds} syncedAt={syncedAt} loading={loading} error={error} pageCategory="qdii-etf" trainingMetricsByCode={trainingMetricsByCode} premiumCompareCodes={premiumCompareCodes} isMember={isMember} currentUser={currentUser} onRequireMember={handleRequireMember} />} />
          <Route path="/domestic-etf" element={<HomePage funds={funds} syncedAt={syncedAt} loading={loading} error={error} pageCategory="domestic-etf" trainingMetricsByCode={trainingMetricsByCode} premiumCompareCodes={premiumCompareCodes} isMember={isMember} currentUser={currentUser} onRequireMember={handleRequireMember} />} />
          <Route path="/favorites" element={<HomePage funds={funds} syncedAt={syncedAt} loading={loading} error={error} pageCategory="favorites" trainingMetricsByCode={trainingMetricsByCode} premiumCompareCodes={premiumCompareCodes} isMember={isMember} currentUser={currentUser} onRequireMember={handleRequireMember} />} />
          <Route path="/member" element={<MemberCenter currentUser={currentUser} onAuthingLogin={handleAuthingLogin} onLogout={handleLogout} onRedeem={handleRedeem} onCreateOrder={handleCreateOrder} onLoadOrders={handleLoadOrders} onLoadEvents={handleLoadEvents} onLoadAdminOrders={handleLoadAdminOrders} onUpdateOrderOcr={handleUpdateOrderOcr} onGrantMembership={handleGrantMembership} onBlockUser={handleBlockUser} pending={authPending} />} />
          <Route path="/docs" element={<DocsPage />} />
          <Route path="/traffic" element={<TrafficPage />} />
          <Route path="/etf" element={<Navigate to="/qdii-etf" replace />} />
          <Route path="/detail/:code" element={isMember ? <DetailPage funds={funds} syncedAt={syncedAt} loading={loading} /> : <MemberGate message={MEMBER_COPY} />} />
          <Route path="/fund/:code" element={isMember ? <DetailPage funds={funds} syncedAt={syncedAt} loading={loading} /> : <MemberGate message={MEMBER_COPY} />} />
          <Route path="*" element={<Navigate to="/qdii-lof" replace />} />
        </Routes>
      </AppErrorBoundary>
    </div>
  );
}
