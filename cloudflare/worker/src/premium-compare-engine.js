const CLOSE_SNAPSHOT_TIME = '15:00:00';
const PROVIDER_DAILY_ROWS_LIMIT = 120;
const SETTLED_WINDOW_SIZE = 30;
const HISTORY_MAX_ROWS_PER_PROVIDER = 360;
const CACHE_TTL_MS = 10 * 60 * 1000;
const DEFAULT_LIVE_FETCH_LIMIT = 8;

function toFiniteNumber(value) {
  if (value === null || value === undefined) return Number.NaN;
  if (typeof value === 'string' && !value.trim()) return Number.NaN;
  const num = Number(value);
  return Number.isFinite(num) ? num : Number.NaN;
}

function toDateOnly(value) {
  const text = String(value || '').trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : '';
}

function toTimeOnly(value) {
  const text = String(value || '').trim();
  if (!text) return '';
  if (/^\d{2}:\d{2}(:\d{2})?$/.test(text)) return text.length === 5 ? `${text}:00` : text;
  return '';
}

function toDateTimeLabel(date, time) {
  return `${String(date || '').trim()} ${String(time || '').trim()}`.trim();
}

function toCloseDateTimeLabel(date) {
  const left = String(date || '').trim();
  return left ? `${left} ${CLOSE_SNAPSHOT_TIME}` : '';
}

function sortRowsByDateTime(rows) {
  return [...(Array.isArray(rows) ? rows : [])].sort((left, right) => {
    const leftDate = String(left?.date || '');
    const rightDate = String(right?.date || '');
    if (leftDate !== rightDate) return leftDate.localeCompare(rightDate);
    return String(left?.time || '').localeCompare(String(right?.time || ''));
  });
}

function pickCanonicalRowsByDate(rows, targetTime = CLOSE_SNAPSHOT_TIME) {
  const grouped = new Map();
  for (const row of Array.isArray(rows) ? rows : []) {
    const date = toDateOnly(row?.date);
    const time = toTimeOnly(row?.time);
    if (!date || !time) continue;
    if (!grouped.has(date)) grouped.set(date, []);
    grouped.get(date).push(row);
  }
  const selected = [];
  for (const dateRows of grouped.values()) {
    const normalized = sortRowsByDateTime(dateRows);
    let picked = normalized.find((item) => toTimeOnly(item?.time) === targetTime) || null;
    if (!picked) {
      const beforeOrAt = normalized.filter((item) => toTimeOnly(item?.time) <= targetTime);
      if (beforeOrAt.length) picked = beforeOrAt[beforeOrAt.length - 1];
    }
    if (!picked) {
      const after = normalized.filter((item) => toTimeOnly(item?.time) > targetTime);
      if (after.length) picked = after[0];
    }
    if (!picked && normalized.length) picked = normalized[normalized.length - 1];
    if (picked) selected.push(picked);
  }
  return selected.sort((left, right) => String(left?.date || '').localeCompare(String(right?.date || '')));
}

function average(values) {
  if (!values.length) return Number.NaN;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function parsePremiumFromText(text) {
  const input = String(text || '');
  const hit = input.match(/(?:溢价率|折溢价率|premium[^\d-]*)\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*%/i);
  if (!hit) return Number.NaN;
  const value = Number(hit[1]);
  return Number.isFinite(value) ? value / 100 : Number.NaN;
}

function normalizeProviderStatus(status) {
  const text = String(status || '').trim();
  if (!text) return '';
  if (text.includes('Too many subrequests by single Worker invocation')) {
    return 'deferred-live-refresh';
  }
  return text;
}

async function safeFetchText(url, referer = '') {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      ...(referer ? { referer } : {}),
    },
  });
  if (!response.ok) throw new Error(`http-${response.status}`);
  return response.text();
}

async function safeFetchJson(url, referer = '') {
  const raw = await safeFetchText(url, referer);
  return JSON.parse(raw);
}

function getSecidByCode(code) {
  return code.startsWith('5') ? `1.${code}` : `0.${code}`;
}

function parseFundGzJsonp(rawText) {
  const text = String(rawText || '').trim();
  const matched = text.match(/^jsonpgz\((\{.*\})\);?$/);
  if (!matched) return null;
  try {
    return JSON.parse(matched[1]);
  } catch {
    return null;
  }
}

async function fetchFromEastmoneyFundgz(code, marketPrice) {
  const apiUrl = `https://fundgz.1234567.com.cn/js/${code}.js`;
  try {
    const raw = await safeFetchText(apiUrl, `https://fund.eastmoney.com/${code}.html`);
    const payload = parseFundGzJsonp(raw);
    const estimatedNav = Number(payload?.gsz);
    if (!Number.isFinite(estimatedNav) || estimatedNav <= 0 || !Number.isFinite(marketPrice) || marketPrice <= 0) {
      return { provider: 'eastmoney-fundgz', sourceUrl: apiUrl, status: 'gsz-unavailable', premiumRate: null };
    }
    return { provider: 'eastmoney-fundgz', sourceUrl: apiUrl, status: 'ok', premiumRate: marketPrice / estimatedNav - 1 };
  } catch (error) {
    return { provider: 'eastmoney-fundgz', sourceUrl: apiUrl, status: error instanceof Error ? error.message : 'request-failed', premiumRate: null };
  }
}

async function fetchFromEastmoneyQuotePremium(code) {
  const secidCandidates = [getSecidByCode(code), `1.${code}`, `0.${code}`].filter((item, idx, arr) => arr.indexOf(item) === idx);
  let lastStatus = 'premium-unavailable';
  let lastUrl = 'https://push2.eastmoney.com/';
  for (const secid of secidCandidates) {
    const referer = `https://quote.eastmoney.com/${secid}.html`;
    const apiUrl = `https://push2.eastmoney.com/api/qt/stock/get?invt=2&fltt=2&secid=${secid}&fields=f57,f58,f193,f194`;
    lastUrl = apiUrl;
    try {
      const payload = await safeFetchJson(apiUrl, referer);
      const premiumPercent = Number(payload?.data?.f193);
      if (Number.isFinite(premiumPercent)) {
        return { provider: 'eastmoney-quote', sourceUrl: apiUrl, status: 'ok', premiumRate: premiumPercent / 100 };
      }
      lastStatus = 'premium-unavailable';
    } catch (error) {
      lastStatus = error instanceof Error ? error.message : 'request-failed';
    }
  }
  return { provider: 'eastmoney-quote', sourceUrl: lastUrl, status: lastStatus, premiumRate: null };
}

async function fetchFromEtfpro(code) {
  const candidates = [`https://etfpro.cn/${code}`, `https://etfpro.cn/fund/${code}`, `https://etfpro.cn/?code=${code}`];
  for (const url of candidates) {
    try {
      const html = await safeFetchText(url, 'https://etfpro.cn/');
      const parsed = parsePremiumFromText(html);
      if (Number.isFinite(parsed)) return { provider: 'etfpro', sourceUrl: url, status: 'ok', premiumRate: parsed };
    } catch {
      continue;
    }
  }
  return { provider: 'etfpro', sourceUrl: 'https://etfpro.cn/', status: 'unavailable-or-blocked', premiumRate: null };
}

async function fetchFromXueqiu(code) {
  const symbols = [`SZ${code}`, `SH${code}`];
  for (const symbol of symbols) {
    const url = `https://xueqiu.com/S/${symbol}`;
    try {
      const html = await safeFetchText(url, 'https://xueqiu.com/');
      const parsed = parsePremiumFromText(html);
      if (Number.isFinite(parsed)) return { provider: 'xueqiu', sourceUrl: url, status: 'ok', premiumRate: parsed };
    } catch {
      continue;
    }
  }
  return { provider: 'xueqiu', sourceUrl: 'https://xueqiu.com/', status: 'unavailable-or-blocked', premiumRate: null };
}

async function fetchFromSina(code) {
  const symbol = code.startsWith('5') ? `sh${code}` : `sz${code}`;
  const url = `https://hq.sinajs.cn/list=${symbol}`;
  try {
    const raw = await safeFetchText(url, 'https://finance.sina.com.cn/');
    const parsed = parsePremiumFromText(raw);
    if (Number.isFinite(parsed)) return { provider: 'sina', sourceUrl: url, status: 'ok', premiumRate: parsed };
    return { provider: 'sina', sourceUrl: url, status: 'no-premium-field', premiumRate: null };
  } catch {
    return { provider: 'sina', sourceUrl: url, status: 'unavailable-or-blocked', premiumRate: null };
  }
}

function parseRuntimeRow(row) {
  if (!row?.runtime_json) return null;
  try {
    return JSON.parse(String(row.runtime_json));
  } catch {
    return null;
  }
}

async function loadRuntimeFunds(db) {
  const result = await db.prepare('SELECT code, runtime_json FROM latest_fund_runtime ORDER BY code').all();
  return (result?.results || []).map(parseRuntimeRow).filter((item) => item && item.code);
}

async function loadPremiumHistory(db, codes) {
  if (!codes.length) return {};
  const placeholders = codes.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT code, provider, date, time, market_price, our_premium_rate, provider_premium_rate, source_url, status FROM premium_compare_history WHERE code IN (${placeholders}) ORDER BY date, time`)
    .bind(...codes)
    .all();
  const map = {};
  for (const row of result?.results || []) {
    const code = String(row.code || '');
    const provider = String(row.provider || '');
    if (!code || !provider) continue;
    if (!map[code]) map[code] = {};
    if (!map[code][provider]) map[code][provider] = [];
    map[code][provider].push({
      date: toDateOnly(row.date),
      time: toTimeOnly(row.time),
      marketPrice: toFiniteNumber(row.market_price),
      ourPremiumRate: toFiniteNumber(row.our_premium_rate),
      providerPremiumRate: toFiniteNumber(row.provider_premium_rate),
      sourceUrl: String(row.source_url || ''),
      status: String(row.status || ''),
    });
  }
  return map;
}

async function loadManualEntries(db, codes) {
  if (!codes.length) return [];
  const placeholders = codes.map(() => '?').join(',');
  const result = await db
    .prepare(`SELECT code, provider, date, premium_rate, source_url, status, time FROM manual_premium_entries WHERE code IN (${placeholders})`)
    .bind(...codes)
    .all();
  return (result?.results || []).map((item) => ({
    code: String(item.code || ''),
    provider: String(item.provider || ''),
    date: toDateOnly(item.date),
    time: toTimeOnly(item.time) || CLOSE_SNAPSHOT_TIME,
    premiumRate: toFiniteNumber(item.premium_rate),
    sourceUrl: String(item.source_url || ''),
    status: String(item.status || 'manual-input'),
  })).filter((item) => item.code && item.provider && item.date && Number.isFinite(item.premiumRate));
}

function appendHistoryRow(rows, nextRow) {
  const merged = Array.isArray(rows) ? [...rows] : [];
  const date = toDateOnly(nextRow?.date);
  const time = toTimeOnly(nextRow?.time) || CLOSE_SNAPSHOT_TIME;
  const providerPremiumRate = toFiniteNumber(nextRow?.providerPremiumRate);
  if (!date || !Number.isFinite(providerPremiumRate)) return merged;
  const key = `${date}|${time}`;
  const index = merged.findIndex((item) => `${toDateOnly(item?.date)}|${toTimeOnly(item?.time)}` === key);
  const normalized = {
    date,
    time,
    marketPrice: toFiniteNumber(nextRow?.marketPrice),
    ourPremiumRate: toFiniteNumber(nextRow?.ourPremiumRate),
    providerPremiumRate,
    sourceUrl: String(nextRow?.sourceUrl || ''),
    status: String(nextRow?.status || ''),
  };
  if (index >= 0) merged[index] = normalized;
  else merged.push(normalized);
  return merged;
}

function isTimeOnOrAfter(leftTime, rightTime) {
  const left = toTimeOnly(leftTime);
  const right = toTimeOnly(rightTime);
  return Boolean(left && right && left >= right);
}

async function readCache(db) {
  const row = await db.prepare('SELECT generated_at, synced_at, payload_json FROM premium_compare_cache WHERE id = 1').first();
  if (!row?.payload_json) return null;
  try {
    return {
      generatedAt: String(row.generated_at || ''),
      syncedAt: String(row.synced_at || ''),
      payload: JSON.parse(String(row.payload_json)),
    };
  } catch {
    return null;
  }
}

async function writeCache(db, payload, syncedAt) {
  const generatedAt = new Date().toISOString();
  await db.prepare(
    `INSERT INTO premium_compare_cache (id, generated_at, synced_at, payload_json, updated_at)
     VALUES (1, ?, ?, ?, ?)
     ON CONFLICT(id) DO UPDATE SET
       generated_at = excluded.generated_at,
       synced_at = excluded.synced_at,
       payload_json = excluded.payload_json,
       updated_at = excluded.updated_at`,
  ).bind(generatedAt, syncedAt, JSON.stringify(payload), generatedAt).run();
}

async function insertHistoryRows(db, rows) {
  if (!rows.length) return;
  const statements = rows.map((item) =>
    db.prepare(
      `INSERT INTO premium_compare_history
       (code, provider, date, time, market_price, our_premium_rate, provider_premium_rate, source_url, status, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(code, provider, date, time) DO UPDATE SET
         market_price = excluded.market_price,
         our_premium_rate = excluded.our_premium_rate,
         provider_premium_rate = excluded.provider_premium_rate,
         source_url = excluded.source_url,
         status = excluded.status,
         updated_at = excluded.updated_at`,
    ).bind(
      item.code,
      item.provider,
      item.date,
      item.time,
      Number.isFinite(item.marketPrice) ? item.marketPrice : null,
      Number.isFinite(item.ourPremiumRate) ? item.ourPremiumRate : null,
      item.providerPremiumRate,
      item.sourceUrl || '',
      item.status || '',
      new Date().toISOString(),
    ),
  );
  await db.batch(statements);
}

export async function buildPremiumComparePayload(db, options = {}) {
  const latest = await db.prepare('SELECT synced_at FROM runtime_runs ORDER BY id DESC LIMIT 1').first();
  const latestSyncedAt = String(latest?.synced_at || '');
  const cache = await readCache(db);
  if (!options.force && cache?.payload && cache.syncedAt === latestSyncedAt) {
    const generatedMs = Date.parse(cache.generatedAt);
    if (!Number.isNaN(generatedMs) && Date.now() - generatedMs <= CACHE_TTL_MS) {
      return cache.payload;
    }
  }

  const funds = await loadRuntimeFunds(db);
  const codes = funds.map((item) => String(item.code || '')).filter(Boolean);
  const liveFetchLimitRaw = Number.parseInt(String(options.liveFetchLimit ?? DEFAULT_LIVE_FETCH_LIMIT), 10);
  const liveFetchLimit = Number.isFinite(liveFetchLimitRaw) && liveFetchLimitRaw > 0 ? liveFetchLimitRaw : DEFAULT_LIVE_FETCH_LIMIT;
  const liveFetchCodeSet = new Set(codes.slice(0, liveFetchLimit));
  const fundByCode = new Map(funds.map((item) => [String(item.code), item]));
  const history = await loadPremiumHistory(db, codes);
  const manualEntries = await loadManualEntries(db, codes);

  for (const entry of manualEntries) {
    if (!history[entry.code]) history[entry.code] = {};
    if (!history[entry.code][entry.provider]) history[entry.code][entry.provider] = [];
    history[entry.code][entry.provider] = appendHistoryRow(history[entry.code][entry.provider], {
      date: entry.date, time: entry.time, marketPrice: Number.NaN, ourPremiumRate: Number.NaN, providerPremiumRate: entry.premiumRate, sourceUrl: entry.sourceUrl, status: entry.status,
    });
  }

  const outputByCode = {};
  const pendingHistoryRows = [];
  for (const code of codes) {
    const fund = fundByCode.get(code);
    const marketPrice = Number(fund?.marketPrice);
    const estimatedNav = Number(fund?.estimatedNav);
    const ourPremiumRate = marketPrice > 0 && estimatedNav > 0 ? marketPrice / estimatedNav - 1 : Number.NaN;
    const marketDate = String(fund?.marketDate || fund?.navDate || '');
    const marketTime = String(fund?.marketTime || '');

    const providers = liveFetchCodeSet.has(code)
      ? await Promise.all([
        fetchFromEastmoneyFundgz(code, marketPrice),
        fetchFromEastmoneyQuotePremium(code),
        fetchFromEtfpro(code),
        fetchFromXueqiu(code),
        fetchFromSina(code),
      ])
      : [];

    for (const provider of providers) {
      if (!Number.isFinite(provider.premiumRate) || !Number.isFinite(ourPremiumRate) || !marketDate) continue;
      if (!history[code]) history[code] = {};
      if (!history[code][provider.provider]) history[code][provider.provider] = [];
      history[code][provider.provider] = appendHistoryRow(history[code][provider.provider], {
        date: marketDate, time: marketTime, marketPrice, ourPremiumRate, providerPremiumRate: provider.premiumRate, sourceUrl: provider.sourceUrl, status: provider.status,
      });
      pendingHistoryRows.push({
        code,
        provider: provider.provider,
        date: marketDate,
        time: toTimeOnly(marketTime) || CLOSE_SNAPSHOT_TIME,
        marketPrice,
        ourPremiumRate,
        providerPremiumRate: provider.premiumRate,
        sourceUrl: provider.sourceUrl,
        status: provider.status,
      });
      if (isTimeOnOrAfter(marketTime, CLOSE_SNAPSHOT_TIME)) {
        history[code][provider.provider] = appendHistoryRow(history[code][provider.provider], {
          date: marketDate, time: CLOSE_SNAPSHOT_TIME, marketPrice, ourPremiumRate, providerPremiumRate: provider.premiumRate, sourceUrl: provider.sourceUrl, status: `${provider.status || 'ok'}|close-benchmark`,
        });
        pendingHistoryRows.push({
          code,
          provider: provider.provider,
          date: marketDate,
          time: CLOSE_SNAPSHOT_TIME,
          marketPrice,
          ourPremiumRate,
          providerPremiumRate: provider.premiumRate,
          sourceUrl: provider.sourceUrl,
          status: `${provider.status || 'ok'}|close-benchmark`,
        });
      }
    }

    const navHistoryRows = Array.isArray(fund?.navHistory) ? fund.navHistory : [];
    const actualPremiumByDate = new Map();
    for (const row of navHistoryRows) {
      const date = String(row?.date || '').trim();
      const nav = toFiniteNumber(row?.nav);
      if (date && Number.isFinite(nav) && nav > 0 && Number.isFinite(marketPrice) && marketPrice > 0 && date === marketDate) {
        actualPremiumByDate.set(date, marketPrice / nav - 1);
      }
    }
    const providerSet = new Set([...providers.map((item) => item.provider), ...Object.keys(history?.[code] || {})]);
    const providerStats = [...providerSet].map((providerName) => {
      const runtimeProvider = providers.find((item) => item.provider === providerName) || null;
      const providerHistoryRows = sortRowsByDateTime(history?.[code]?.[providerName] ?? []).slice(-HISTORY_MAX_ROWS_PER_PROVIDER);
      const canonicalRows = pickCanonicalRowsByDate(providerHistoryRows);
      const latestHistoryRow = providerHistoryRows.length ? providerHistoryRows[providerHistoryRows.length - 1] : null;
      const settledRows = canonicalRows
        .map((row) => {
          const date = String(row?.date || '').trim();
          const providerPremiumRate = toFiniteNumber(row?.providerPremiumRate);
          const ourReportedPremiumRate = toFiniteNumber(row?.ourPremiumRate);
          const actualPremiumRate = toFiniteNumber(actualPremiumByDate.get(date));
          if (!date || !Number.isFinite(providerPremiumRate) || !Number.isFinite(actualPremiumRate) || !Number.isFinite(ourReportedPremiumRate)) return null;
          return {
            absProviderPremiumError: Math.abs(providerPremiumRate - actualPremiumRate),
            absOurPremiumError: Math.abs(ourReportedPremiumRate - actualPremiumRate),
          };
        })
        .filter(Boolean)
        .slice(-SETTLED_WINDOW_SIZE);
      const providerMae30 = average(settledRows.map((item) => item.absProviderPremiumError));
      const ourMae30 = average(settledRows.map((item) => item.absOurPremiumError));
      const deltaMae30 = Number.isFinite(providerMae30) && Number.isFinite(ourMae30) ? providerMae30 - ourMae30 : Number.NaN;
      return {
        provider: providerName,
        sourceUrl: runtimeProvider?.sourceUrl || String(latestHistoryRow?.sourceUrl || ''),
        status: normalizeProviderStatus(runtimeProvider?.status || String(latestHistoryRow?.status || (latestHistoryRow ? 'manual-only' : 'unavailable'))),
        premiumRateCurrent: Number.isFinite(toFiniteNumber(runtimeProvider?.premiumRate))
          ? toFiniteNumber(runtimeProvider?.premiumRate)
          : (Number.isFinite(toFiniteNumber(latestHistoryRow?.providerPremiumRate)) ? toFiniteNumber(latestHistoryRow?.providerPremiumRate) : null),
        hitCount60: canonicalRows.slice(-60).length,
        avgAbsProviderError30: Number.isFinite(providerMae30) ? providerMae30 : null,
        avgAbsOurError30: Number.isFinite(ourMae30) ? ourMae30 : null,
        avgAbsDelta30: Number.isFinite(deltaMae30) ? deltaMae30 : null,
        settledCount30: settledRows.length,
        sampleCount30: settledRows.length,
        settledWindowSize: SETTLED_WINDOW_SIZE,
      };
    }).sort((left, right) => String(left.provider).localeCompare(String(right.provider)));

    const providerDailyComparisons = Object.fromEntries(
      [...providerSet].map((providerName) => {
        const rows = pickCanonicalRowsByDate(history?.[code]?.[providerName] ?? [])
          .map((row) => ({
            date: String(row?.date || ''),
            time: String(row?.time || ''),
            marketPrice: Number.isFinite(toFiniteNumber(row?.marketPrice)) ? toFiniteNumber(row?.marketPrice) : null,
            providerPremiumRate: toFiniteNumber(row?.providerPremiumRate),
            ourReportedPremiumRate: Number.isFinite(toFiniteNumber(row?.ourPremiumRate)) ? toFiniteNumber(row?.ourPremiumRate) : null,
            status: Number.isFinite(toFiniteNumber(actualPremiumByDate.get(String(row?.date || '')))) ? 'settled' : 'pending',
            actualPremiumRate: Number.isFinite(toFiniteNumber(actualPremiumByDate.get(String(row?.date || '')))) ? toFiniteNumber(actualPremiumByDate.get(String(row?.date || ''))) : null,
            providerPremiumError: null,
            ourPremiumError: null,
            premiumErrorDelta: null,
          }))
          .filter((item) => item.date && Number.isFinite(item.providerPremiumRate))
          .slice(-PROVIDER_DAILY_ROWS_LIMIT);
        return [providerName, rows];
      }),
    );

    outputByCode[code] = {
      code,
      name: String(fund?.name || code),
      snapshotAt: toCloseDateTimeLabel(marketDate),
      snapshotAtLive: toDateTimeLabel(marketDate, marketTime),
      ourPremiumRate: Number.isFinite(ourPremiumRate) ? ourPremiumRate : null,
      ourPremiumSummary: {
        settledCount30: 0,
        settledWindowSize: SETTLED_WINDOW_SIZE,
        avgAbsOurError30: null,
      },
      eastmoneyDailyValuations: [],
      providerDailyComparisons,
      providers: providerStats,
    };
  }

  await insertHistoryRows(db, pendingHistoryRows);
  const payload = { generatedAt: new Date().toISOString(), syncedAt: latestSyncedAt, codes: outputByCode };
  await writeCache(db, payload, latestSyncedAt);
  return payload;
}
