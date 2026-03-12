import fs from 'node:fs/promises';
import path from 'node:path';
import { load } from 'cheerio';
import catalog from '../src/data/fundCatalog.json' with { type: 'json' };

const projectRoot = process.cwd();
const outputPath = path.join(projectRoot, 'public', 'generated', 'funds-runtime.json');
const dailyCacheDir = path.join(projectRoot, '.cache', 'fund-sync', 'daily');
const intradayCacheDir = path.join(projectRoot, '.cache', 'fund-sync', 'intraday');
const watchlistStatePath = path.join(projectRoot, '.cache', 'fund-sync', 'watchlist-state.json');
const holdingsDisclosurePath = path.join(projectRoot, '.cache', 'fund-sync', 'holdings-disclosures.json');
const now = new Date();
const today = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
const WATCHLIST_STATE_VERSION = 5;
const MAX_MARKET_MOVE = 0.08;
const MAX_PROXY_MOVE = 0.15;
const MAX_CLOSE_GAP = 0.2;
const MAX_FX_MOVE = 0.05;
const JOURNAL_RETENTION_DAYS = 90;
const HOLDINGS_161128 = [
  { ticker: 'NVDA', name: '英伟达', currency: 'USD' },
  { ticker: 'AAPL', name: '苹果', currency: 'USD' },
  { ticker: 'MSFT', name: '微软', currency: 'USD' },
  { ticker: 'AVGO', name: '博通', currency: 'USD' },
  { ticker: 'PLTR', name: 'Palantir', currency: 'USD' },
  { ticker: 'AMD', name: '超威半导体', currency: 'USD' },
  { ticker: 'ORCL', name: '甲骨文', currency: 'USD' },
  { ticker: 'MU', name: '美光科技', currency: 'USD' },
  { ticker: 'CSCO', name: '思科', currency: 'USD' },
  { ticker: 'IBM', name: 'IBM', currency: 'USD' },
];
const PROXY_BASKETS = {
  'us-tech-large': {
    name: '美股科技篮子',
    components: [
      { ticker: 'QQQ', name: 'Invesco QQQ Trust', weight: 0.7 },
      { ticker: 'XLK', name: 'Technology Select Sector SPDR', weight: 0.3 },
    ],
  },
  'us-semiconductor': {
    name: '半导体篮子',
    components: [{ ticker: 'SOXX', name: 'iShares Semiconductor ETF', weight: 1 }],
  },
  'us-commodities': {
    name: '大宗商品篮子',
    components: [{ ticker: 'DBC', name: 'Invesco DB Commodity Index Tracking Fund', weight: 1 }],
  },
  'us-gold': {
    name: '黄金篮子',
    components: [{ ticker: 'GLD', name: 'SPDR Gold Shares', weight: 1 }],
  },
  'us-silver': {
    name: '白银篮子',
    components: [{ ticker: 'SLV', name: 'iShares Silver Trust', weight: 1 }],
  },
  'us-precious-metals': {
    name: '贵金属篮子',
    components: [
      { ticker: 'GLD', name: 'SPDR Gold Shares', weight: 0.75 },
      { ticker: 'SLV', name: 'iShares Silver Trust', weight: 0.25 },
    ],
  },
  'us-oil': {
    name: '原油篮子',
    components: [
      { ticker: 'USO', name: 'United States Oil Fund', weight: 0.75 },
      { ticker: 'XLE', name: 'Energy Select Sector SPDR', weight: 0.25 },
    ],
  },
  'us-oil-upstream': {
    name: '油气上游篮子',
    components: [
      { ticker: 'XOP', name: 'SPDR S&P Oil & Gas E&P ETF', weight: 0.7 },
      { ticker: 'XLE', name: 'Energy Select Sector SPDR', weight: 0.3 },
    ],
  },
  'us-sandp500': {
    name: '标普500篮子',
    components: [{ ticker: 'SPY', name: 'SPDR S&P 500 ETF Trust', weight: 1 }],
  },
  'us-overseas-tech': {
    name: '海外科技篮子',
    components: [
      { ticker: 'IXN', name: 'iShares Global Tech ETF', weight: 0.35 },
      { ticker: 'XLK', name: 'Technology Select Sector SPDR', weight: 0.65 },
    ],
  },
  'us-nasdaq100': {
    name: '纳指100篮子',
    components: [{ ticker: 'QQQ', name: 'Invesco QQQ Trust', weight: 1 }],
  },
};
let intradayPromise = null;

function clamp(value, limit) {
  return Math.max(-limit, Math.min(limit, value));
}

function getWeightedProxyReturn(runtime) {
  const proxyQuotes = runtime.proxyQuotes ?? [];
  const totalWeight = proxyQuotes.reduce((sum, item) => sum + item.weight, 0);

  if (totalWeight <= 0) {
    return 0;
  }

  return proxyQuotes.reduce((sum, item) => {
    const localReturn = item.previousClose > 0 ? item.currentPrice / item.previousClose - 1 : 0;
    return sum + localReturn * (item.weight / totalWeight);
  }, 0);
}

function getFxReturn(runtime) {
  const currentRate = runtime.fx?.currentRate ?? 0;
  const previousCloseRate = runtime.fx?.previousCloseRate ?? 0;
  return currentRate > 0 && previousCloseRate > 0 ? currentRate / previousCloseRate - 1 : 0;
}

function toIsoDateWithOffset(days) {
  const value = new Date();
  value.setDate(value.getDate() + days);
  return value.toISOString().slice(0, 10);
}

function pruneJournal(journal) {
  const cutoffDate = toIsoDateWithOffset(-JOURNAL_RETENTION_DAYS);

  return {
    snapshots: (journal.snapshots ?? []).filter((item) => item.estimateDate >= cutoffDate),
    errors: (journal.errors ?? []).filter((item) => item.date >= cutoffDate),
  };
}

function getDefaultWatchlistModel() {
  return {
    alpha: 0,
    betaLead: 0.38,
    betaGap: 0,
    learningRate: 0.24,
    sampleCount: 0,
    meanAbsError: 0,
  };
}

function getDefaultJournal() {
  return {
    snapshots: [],
    errors: [],
  };
}

function normalizePersistedState(entry, sourceVersion) {
  if (!entry) {
    return {
      modelVersion: WATCHLIST_STATE_VERSION,
      model: getDefaultWatchlistModel(),
      journal: getDefaultJournal(),
    };
  }

  return {
    modelVersion: WATCHLIST_STATE_VERSION,
    model: sourceVersion === WATCHLIST_STATE_VERSION ? { ...getDefaultWatchlistModel(), ...(entry.model ?? {}) } : getDefaultWatchlistModel(),
    journal: pruneJournal({
      snapshots: entry.journal?.snapshots ?? [],
      errors: entry.journal?.errors ?? [],
    }),
  };
}

function estimateWatchlistFund(runtime, model) {
  const anchorNav = runtime.officialNavT1;
  const rawLeadReturn = runtime.estimateMode === 'proxy' ? getWeightedProxyReturn(runtime) : runtime.previousClose > 0 ? runtime.marketPrice / runtime.previousClose - 1 : 0;
  const leadReturn = clamp(rawLeadReturn, runtime.estimateMode === 'proxy' ? MAX_PROXY_MOVE : MAX_MARKET_MOVE);
  const rawCloseGapReturn = runtime.estimateMode === 'proxy' ? getFxReturn(runtime) : anchorNav > 0 && runtime.previousClose > 0 ? runtime.previousClose / anchorNav - 1 : 0;
  const closeGapReturn = clamp(rawCloseGapReturn, runtime.estimateMode === 'proxy' ? MAX_FX_MOVE : MAX_CLOSE_GAP);
  const learnedBiasReturn = model.alpha;
  const impliedReturn = learnedBiasReturn + model.betaLead * leadReturn + model.betaGap * closeGapReturn;
  const estimatedNav = anchorNav * (1 + impliedReturn);
  const premiumRate = estimatedNav > 0 ? runtime.marketPrice / estimatedNav - 1 : 0;

  return {
    anchorNav,
    leadReturn,
    closeGapReturn,
    learnedBiasReturn,
    impliedReturn,
    estimatedNav,
    premiumRate,
  };
}

function reconcileJournal(runtime, currentModel, currentJournal) {
  const actualNavByDate = new Map(runtime.navHistory.map((item) => [item.date, item.nav]));
  const baseJournal = pruneJournal(currentJournal);
  const resolvedDates = new Set(baseJournal.errors.map((item) => item.date));
  let model = { ...getDefaultWatchlistModel(), ...currentModel };
  const nextErrors = [...baseJournal.errors];

  for (const snapshot of baseJournal.snapshots) {
    if (resolvedDates.has(snapshot.estimateDate)) {
      continue;
    }

    const actualNav = actualNavByDate.get(snapshot.estimateDate);
    if (!actualNav) {
      continue;
    }

    const targetReturn = snapshot.anchorNav > 0 ? actualNav / snapshot.anchorNav - 1 : 0;
    const predictedReturn = snapshot.impliedReturn;
    const residualError = targetReturn - predictedReturn;
    const displayError = actualNav > 0 ? snapshot.estimatedNav / actualNav - 1 : 0;
    const nextSampleCount = model.sampleCount + 1;
    const adaptiveRate = model.learningRate / Math.sqrt(nextSampleCount);
    const nextMae =
      model.sampleCount === 0
        ? Math.abs(displayError)
        : (model.meanAbsError * model.sampleCount + Math.abs(displayError)) / nextSampleCount;

    model = {
      ...model,
      alpha: model.alpha + adaptiveRate * residualError,
      betaLead: model.betaLead + adaptiveRate * residualError * snapshot.leadReturn,
      betaGap: model.betaGap + adaptiveRate * residualError * snapshot.closeGapReturn,
      sampleCount: nextSampleCount,
      meanAbsError: nextMae,
      lastUpdatedAt: new Date().toISOString(),
    };

    nextErrors.push({
      date: snapshot.estimateDate,
      estimatedNav: snapshot.estimatedNav,
      actualNav,
      premiumRate: snapshot.premiumRate,
      error: displayError,
      absError: Math.abs(displayError),
    });
    resolvedDates.add(snapshot.estimateDate);
  }

  nextErrors.sort((left, right) => left.date.localeCompare(right.date));

  return {
    model,
    journal: pruneJournal({
      snapshots: baseJournal.snapshots,
      errors: nextErrors,
    }),
  };
}

function recordEstimateSnapshot(journal, runtime, estimate) {
  const estimateDate = runtime.marketDate || new Date().toISOString().slice(0, 10);
  const snapshots = journal.snapshots ?? [];
  if (snapshots.find((item) => item.estimateDate === estimateDate)) {
    return journal;
  }

  return pruneJournal({
    ...journal,
    snapshots: [
      ...snapshots,
      {
        estimateDate,
        estimatedNav: estimate.estimatedNav,
        marketPrice: runtime.marketPrice,
        premiumRate: estimate.premiumRate,
        anchorNav: estimate.anchorNav,
        leadReturn: estimate.leadReturn,
        closeGapReturn: estimate.closeGapReturn,
        impliedReturn: estimate.impliedReturn,
        createdAt: new Date().toISOString(),
      },
    ].sort((left, right) => left.estimateDate.localeCompare(right.estimateDate)),
  });
}

function getQuoteSymbol(code) {
  return `${code.startsWith('5') ? 'sh' : 'sz'}${code}`;
}

async function fetchText(url, headers = {}, encoding = 'utf-8') {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      referer: 'https://fund.eastmoney.com/',
      ...headers,
    },
  });

  if (!response.ok) {
    throw new Error(`Request failed: ${url} (${response.status})`);
  }

  const buffer = await response.arrayBuffer();
  return new TextDecoder(encoding).decode(buffer);
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

async function writeJson(filePath, payload) {
  await fs.mkdir(path.dirname(filePath), { recursive: true });
  await fs.writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

function stripHtml(value) {
  return value.replace(/<[^>]+>/g, '').replace(/\s+/g, ' ').trim();
}

function extractField(html, label) {
  const pattern = new RegExp(`${label}<\/th><td[^>]*>([\s\S]{0,500}?)<\/td>`, 'i');
  const match = html.match(pattern);
  return match ? stripHtml(match[1]) : '';
}

function parsePurchaseStatus(html) {
  const compact = html.replace(/\s+/g, ' ');
  const match = compact.match(
    /交易状态：<\/span><span class="staticCell">([^<]+?)(?:\s*\(<span>([^<]+)<\/span>\))?<\/span><span class="staticCell">([^<]+)<\/span>/i,
  );

  if (!match) {
    return {
      purchaseStatus: '',
      purchaseLimit: '',
    };
  }

  const baseStatus = stripHtml(match[1]);
  const limitText = stripHtml(match[2] ?? '');
  const redeemStatus = stripHtml(match[3]);
  const purchaseStatus = [baseStatus, redeemStatus].filter(Boolean).join(' / ');

  return {
    purchaseStatus,
    purchaseLimit: limitText,
  };
}

function parseBasicInfo(html, fallbackName) {
  const titleMatch = html.match(/<title>(.*?)<\/title>/i);
  const titleName = titleMatch
    ? stripHtml(titleMatch[1]).replace(/基金基本概况.*$/u, '').replace(/ _ 基金档案.*$/u, '').trim()
    : '';

  return {
    name: titleName || fallbackName,
    fundType: extractField(html, '基金类型'),
    benchmark: extractField(html, '业绩比较基准'),
  };
}

function parseNumber(value) {
  const normalized = value.replace(/,/g, '').replace(/--/g, '').trim();
  const parsed = Number(normalized.replace(/%$/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function parseHoldingsDisclosure(html) {
  const $ = load(html);
  const compactText = $.root().text().replace(/\s+/g, ' ').trim();
  const reportMatch = compactText.match(/(\d{4}年[1-4]季度股票投资明细).*?截止至：\s*(\d{4}-\d{2}-\d{2})/);
  const table = $('table').first();

  if (!table.length) {
    return {
      disclosedHoldingsTitle: '',
      disclosedHoldingsReportDate: '',
      disclosedHoldings: [],
    };
  }

  const disclosedHoldings = table
    .find('tr')
    .map((_, row) => {
      const cells = $(row)
        .find('td')
        .map((__, cell) => $(cell).text().replace(/\s+/g, ' ').trim())
        .get()
        .filter(Boolean);

      if (cells.length < 6 || !/^\d+$/.test(cells[0])) {
        return null;
      }

      return {
        ticker: cells[1],
        name: cells[2],
        currentPrice: cells.length >= 9 ? parseNumber(cells[3]) : undefined,
        weight: parseNumber(cells[cells.length - 3]),
        shares: parseNumber(cells[cells.length - 2]),
        marketValue: parseNumber(cells[cells.length - 1]),
      };
    })
    .get()
    .filter(Boolean)
    .slice(0, 10);

  return {
    disclosedHoldingsTitle: reportMatch?.[1] ?? '',
    disclosedHoldingsReportDate: reportMatch?.[2] ?? '',
    disclosedHoldings,
  };
}

function updateDisclosureHistory(historyByCode, runtime) {
  if (!runtime.disclosedHoldings?.length || !runtime.disclosedHoldingsReportDate) {
    return historyByCode;
  }

  const current = historyByCode[runtime.code] ?? [];
  const alreadyRecorded = current.some(
    (item) => item.reportDate === runtime.disclosedHoldingsReportDate && item.title === runtime.disclosedHoldingsTitle,
  );

  if (alreadyRecorded) {
    return historyByCode;
  }

  return {
    ...historyByCode,
    [runtime.code]: [
      ...current,
      {
        reportDate: runtime.disclosedHoldingsReportDate,
        title: runtime.disclosedHoldingsTitle,
        holdings: runtime.disclosedHoldings,
        capturedAt: new Date().toISOString(),
      },
    ].sort((left, right) => left.reportDate.localeCompare(right.reportDate)).slice(-8),
  };
}

function formatLocalDate(timestamp) {
  const date = new Date(timestamp);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function parsePingzhongData(content) {
  const nameMatch = content.match(/var\s+fS_name\s*=\s*"([^"]+)"/);
  const netWorthMatch = content.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]*?\]);/);
  const name = nameMatch ? nameMatch[1].trim() : '';

  if (!netWorthMatch) {
    return { name, navHistory: [] };
  }

  const series = JSON.parse(netWorthMatch[1]);
  const navHistory = series
    .map((item) => ({
      date: formatLocalDate(item.x),
      nav: Number(item.y) || 0,
    }))
    .filter((item) => item.date && item.nav > 0)
    .slice(-60)
    .reverse();

  return { name, navHistory };
}

function parseQuote(raw) {
  const match = raw.match(/="([^"]+)"/);
  if (!match) {
    return {
      marketPrice: 0,
      previousClose: 0,
      marketDate: '',
      marketTime: '',
      marketSource: '腾讯行情',
    };
  }

  const fields = match[1].split('~');
  const dateTimeRaw = fields.find((field) => /^\d{14}$/.test(field)) || '';

  return {
    marketPrice: Number(fields[3]) || 0,
    previousClose: Number(fields[4]) || 0,
    marketDate: dateTimeRaw.length >= 8 ? `${dateTimeRaw.slice(0, 4)}-${dateTimeRaw.slice(4, 6)}-${dateTimeRaw.slice(6, 8)}` : '',
    marketTime: dateTimeRaw.length >= 14 ? `${dateTimeRaw.slice(8, 10)}:${dateTimeRaw.slice(10, 12)}:${dateTimeRaw.slice(12, 14)}` : '',
    marketSource: '腾讯行情',
  };
}

function parseFxQuote(raw) {
  const currentMatch = raw.match(/var hq_str_fx_susdcny="([^"]+)"/);
  const backupMatch = raw.match(/var hq_str_USDCNY="([^"]+)"/);
  const fields = (currentMatch?.[1] || backupMatch?.[1] || '').split(',');

  if (fields.length < 9) {
    return {
      pair: 'USD/CNY',
      currentRate: 0,
      previousCloseRate: 0,
      quoteDate: '',
      quoteTime: '',
      source: '新浪外汇',
    };
  }

  return {
    pair: 'USD/CNY',
    currentRate: Number(fields[1]) || 0,
    previousCloseRate: Number(fields[2]) || 0,
    quoteDate: fields[fields.length - 1] || '',
    quoteTime: fields[0] || '',
    source: '新浪外汇',
  };
}

function parseUsQuoteRow(rawRow) {
  const fields = rawRow.split('~');
  const dateTime = fields[30] || '';

  return {
    name: fields[1] || '',
    ticker: fields[2]?.split('.')[0] || '',
    currentPrice: Number(fields[3]) || 0,
    previousClose: Number(fields[4]) || 0,
    quoteDate: dateTime.split(' ')[0] || '',
    quoteTime: dateTime.split(' ')[1] || '',
  };
}

function parseUsQuotes(raw) {
  return raw
    .split(';')
    .map((row) => row.trim())
    .filter(Boolean)
    .map((row) => {
      const match = row.match(/="([^"]+)"/);
      return match ? parseUsQuoteRow(match[1]) : null;
    })
    .filter(Boolean);
}

async function pruneIntradayCache() {
  await fs.mkdir(intradayCacheDir, { recursive: true });
  const entries = await fs.readdir(intradayCacheDir);
  const cutoff = Date.now() - 3 * 24 * 60 * 60 * 1000;

  for (const entry of entries) {
    const fullPath = path.join(intradayCacheDir, entry);
    const stat = await fs.stat(fullPath);
    if (stat.mtimeMs < cutoff) {
      await fs.rm(fullPath, { force: true });
    }
  }
}

async function getDailyFundData(entry) {
  const cachePath = path.join(dailyCacheDir, `${entry.code}.json`);
  const cached = await readJson(cachePath, null);
  if (cached?.fetchedDate === today) {
    return { ...cached, cacheMode: 'daily-cache' };
  }

  const [basicHtml, pingzhongData, fundHtml, holdingsHtml] = await Promise.all([
    fetchText(`https://fundf10.eastmoney.com/jbgk_${entry.code}.html`, {}, 'utf-8'),
    fetchText(`https://fund.eastmoney.com/pingzhongdata/${entry.code}.js?v=${Date.now()}`, {
      referer: `https://fund.eastmoney.com/${entry.code}.html`,
    }, 'gb18030'),
    fetchText(`https://fund.eastmoney.com/${entry.code}.html`, {}, 'utf-8'),
    fetchText(`https://fundf10.eastmoney.com/ccmx_${entry.code}.html`, {}, 'utf-8').catch(() => ''),
  ]);

  const pingzhong = parsePingzhongData(pingzhongData);
  const basic = parseBasicInfo(basicHtml, pingzhong.name);
  const purchase = parsePurchaseStatus(fundHtml);
  const holdingsDisclosure = parseHoldingsDisclosure(holdingsHtml);
  const latestNav = pingzhong.navHistory[0] ?? { date: '', nav: 0 };
  const payload = {
    fetchedDate: today,
    name: basic.name || entry.code,
    fundType: basic.fundType,
    benchmark: basic.benchmark,
    officialNavT1: latestNav.nav,
    navDate: latestNav.date,
    navHistory: pingzhong.navHistory,
    purchaseStatus: purchase.purchaseStatus,
    purchaseLimit: purchase.purchaseLimit,
    disclosedHoldingsTitle: holdingsDisclosure.disclosedHoldingsTitle,
    disclosedHoldingsReportDate: holdingsDisclosure.disclosedHoldingsReportDate,
    disclosedHoldings: holdingsDisclosure.disclosedHoldings,
  };

  await writeJson(cachePath, payload);
  return { ...payload, cacheMode: 'fresh' };
}

async function loadIntradayData() {
  const cachePath = path.join(intradayCacheDir, `${today}.json`);
  const cached = await readJson(cachePath, { funds: {}, fx: null, holdings161128: [], proxyQuotes: [] });

  try {
    const fundSymbols = catalog.map((item) => getQuoteSymbol(item.code)).join(',');
    const holdingSymbols = HOLDINGS_161128.map((item) => `us${item.ticker}`).join(',');
    const proxySymbols = [...new Set(Object.values(PROXY_BASKETS).flatMap((item) => item.components.map((component) => `us${component.ticker}`)))].join(',');
    const [fundQuotesRaw, fxRaw, holdingsRaw, proxyRaw] = await Promise.all([
      fetchText(`https://qt.gtimg.cn/q=${fundSymbols}`, { referer: 'https://gu.qq.com/' }, 'gb18030'),
      fetchText('https://hq.sinajs.cn/list=USDCNY,fx_susdcny', { referer: 'https://finance.sina.com.cn/' }, 'gb18030'),
      fetchText(`https://qt.gtimg.cn/q=${holdingSymbols}`, { referer: 'https://gu.qq.com/' }, 'gb18030'),
      fetchText(`https://qt.gtimg.cn/q=${proxySymbols}`, { referer: 'https://gu.qq.com/' }, 'gb18030'),
    ]);

    const funds = {};
    for (const row of fundQuotesRaw.split(';')) {
      const trimmed = row.trim();
      if (!trimmed) {
        continue;
      }

      const codeMatch = trimmed.match(/^v_(?:sz|sh)(\d+)="/);
      if (!codeMatch) {
        continue;
      }

      funds[codeMatch[1]] = parseQuote(trimmed);
    }

    const payload = {
      fetchedAt: new Date().toISOString(),
      funds,
      fx: parseFxQuote(fxRaw),
      holdings161128: parseUsQuotes(holdingsRaw).map((item) => ({
        ...item,
        currency: 'USD',
      })),
      proxyQuotes: parseUsQuotes(proxyRaw).map((item) => ({
        ...item,
        currency: 'USD',
      })),
    };

    await writeJson(cachePath, payload);
    await pruneIntradayCache();
    return { ...payload, cacheMode: 'fresh' };
  } catch {
    return { ...cached, cacheMode: 'intraday-cache' };
  }
}

async function getIntradayData() {
  if (!intradayPromise) {
    intradayPromise = loadIntradayData().finally(() => {
      intradayPromise = null;
    });
  }

  return intradayPromise;
}

async function syncFund(entry) {
  const [dailyData, intradayData] = await Promise.all([getDailyFundData(entry), getIntradayData()]);
  const quote = intradayData.funds?.[entry.code] ?? {
    marketPrice: 0,
    previousClose: 0,
    marketDate: '',
    marketTime: '',
    marketSource: '腾讯行情',
  };
  const holdingQuotes = entry.code === '161128' ? intradayData.holdings161128 ?? [] : [];
  const holdingsMeta = holdingQuotes[0] ?? null;
  const proxyConfig = entry.proxyBasketKey ? PROXY_BASKETS[entry.proxyBasketKey] : null;
  const proxyQuotes = proxyConfig
    ? proxyConfig.components
        .map((component) => {
          const matched = (intradayData.proxyQuotes ?? []).find((item) => item.ticker.toUpperCase() === component.ticker.toUpperCase());
          if (!matched) {
            return null;
          }

          return {
            ...matched,
            name: component.name,
            weight: component.weight,
          };
        })
        .filter(Boolean)
    : [];
  const proxyMeta = proxyQuotes[0] ?? null;

  return {
    code: entry.code,
    priority: entry.priority,
    detailMode: entry.detailMode,
    pageCategory: entry.pageCategory,
    estimateMode: entry.estimateMode,
    name: dailyData.name || entry.code,
    fundType: dailyData.fundType,
    benchmark: dailyData.benchmark,
    officialNavT1: dailyData.officialNavT1,
    navDate: dailyData.navDate,
    navHistory: dailyData.navHistory,
    marketPrice: quote.marketPrice,
    previousClose: quote.previousClose,
    marketDate: quote.marketDate,
    marketTime: quote.marketTime,
    marketSource: quote.marketSource,
    purchaseStatus: dailyData.purchaseStatus,
    purchaseLimit: dailyData.purchaseLimit,
    disclosedHoldingsTitle: dailyData.disclosedHoldingsTitle,
    disclosedHoldingsReportDate: dailyData.disclosedHoldingsReportDate,
    disclosedHoldings: dailyData.disclosedHoldings,
    fx: intradayData.fx,
    holdingQuotes,
    holdingsQuoteDate: holdingsMeta?.quoteDate || '',
    holdingsQuoteTime: holdingsMeta?.quoteTime || '',
    proxyBasketName: proxyConfig?.name || '',
    proxyQuotes,
    proxyQuoteDate: proxyMeta?.quoteDate || '',
    proxyQuoteTime: proxyMeta?.quoteTime || '',
    cacheMode: intradayData.cacheMode === 'intraday-cache' ? 'intraday-cache' : dailyData.cacheMode,
  };
}

async function main() {
  await fs.mkdir(dailyCacheDir, { recursive: true });
  await fs.mkdir(intradayCacheDir, { recursive: true });

  const funds = [];
  const rawStateCache = await readJson(watchlistStatePath, {});
  let holdingsHistoryByCode = await readJson(holdingsDisclosurePath, {});
  const sourceVersion = rawStateCache.__meta?.version ?? 1;
  const stateByCode = {};

  for (const entry of catalog) {
    try {
      const runtime = await syncFund(entry);
      const currentState = normalizePersistedState(rawStateCache[entry.code], sourceVersion);
      const reconciled = reconcileJournal(runtime, currentState.model, currentState.journal);
      const estimate = estimateWatchlistFund(runtime, reconciled.model);
      const journal = recordEstimateSnapshot(reconciled.journal, runtime, estimate);

      funds.push(runtime);
      holdingsHistoryByCode = updateDisclosureHistory(holdingsHistoryByCode, runtime);
      stateByCode[entry.code] = {
        modelVersion: WATCHLIST_STATE_VERSION,
        model: reconciled.model,
        journal,
      };
    } catch (error) {
      console.error(`Sync failed for ${entry.code}:`, error instanceof Error ? error.message : error);
    }
  }

  funds.sort((left, right) => left.priority - right.priority);

  if (funds.length === 0) {
    throw new Error('Sync produced 0 funds. Aborting publish to avoid overwriting the site with an empty runtime payload.');
  }

  await writeJson(watchlistStatePath, {
    __meta: {
      version: WATCHLIST_STATE_VERSION,
      updatedAt: new Date().toISOString(),
    },
    ...stateByCode,
  });

  await writeJson(holdingsDisclosurePath, holdingsHistoryByCode);

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(
    outputPath,
    JSON.stringify(
      {
        syncedAt: new Date().toISOString(),
        funds,
        stateByCode,
      },
      null,
      2,
    ),
    'utf8',
  );

  console.log(`Synced ${funds.length} funds to ${path.relative(projectRoot, outputPath)}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
