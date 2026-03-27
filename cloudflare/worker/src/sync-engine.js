/**
 * 数据同步引擎 - 直接从数据源抓取基金数据
 * 支持：天天基金网、新浪财经、Yahoo Finance
 */

const FUND_CATALOG = {
  '160723': { name: '嘉实原油', benchmark: '原油', type: 'qdii-lof', proxyTickers: ['USO', 'BNO'] },
  '501018': { name: '南方原油', benchmark: '原油', type: 'qdii-lof', proxyTickers: ['USO', 'BNO'] },
  '161129': { name: '易方达原油', benchmark: '原油', type: 'qdii-lof', proxyTickers: ['USO', 'BNO'] },
  '160416': { name: '华安石油', benchmark: '油气', type: 'qdii-lof', proxyTickers: ['XOP', 'XLE'] },
  '162719': { name: '广发道琼斯石油', benchmark: '油气', type: 'qdii-lof', proxyTickers: ['XOP', 'XLE'] },
  '162411': { name: '华宝油气', benchmark: '油气', type: 'qdii-lof', proxyTickers: ['XOP', 'XLE'] },
  '163208': { name: '诺安油气', benchmark: '油气', type: 'qdii-lof', proxyTickers: ['XLE', 'SLB'] },
  '160216': { name: '国泰黄金', benchmark: '黄金', type: 'qdii-lof', proxyTickers: ['GLD', 'IAU'] },
  '160719': { name: '嘉实黄金', benchmark: '黄金', type: 'qdii-lof', proxyTickers: ['GLD', 'IAU'] },
  '161116': { name: '易方达黄金', benchmark: '黄金', type: 'qdii-lof', proxyTickers: ['GLD', 'UGL'] },
  '164701': { name: '汇添富黄金', benchmark: '黄金', type: 'qdii-lof', proxyTickers: ['GLD', 'IAU'] },
  '159518': { name: '华夏原油', benchmark: '原油', type: 'qdii-etf', proxyTickers: ['USO', 'BNO'] },
};

const PROXY_BASKET_WEIGHTS = {
  '原油': { USO: 0.6, BNO: 0.4 },
  '黄金': { GLD: 0.7, IAU: 0.3 },
  '油气': { XOP: 0.5, XLE: 0.5 },
};

const UA = 'Mozilla/5.0 (compatible; lof-premium-rate-web-worker/1.0)';

/** 带超时的 fetch */
async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/** 天天基金网 - 估算净值 */
async function fetchFundFromEastmoney(code) {
  try {
    const url = `http://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'http://fund.eastmoney.com/', 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const match = text.match(/jsonpgz\((\{.*?\})\)/);
    if (!match) throw new Error('no jsonpgz');
    const d = JSON.parse(match[1]);
    return {
      name: d.name || '',
      estimatedNav: parseFloat(d.gsz) || 0,
      estimatedNavChangeRate: parseFloat(d.gszzl) / 100 || 0,
      officialNavT1: parseFloat(d.dwjz) || 0,
      navDate: (d.jzrq || '').slice(0, 10),
      estimateTime: d.gztime || '',
    };
  } catch (e) {
    console.warn(`[eastmoney] ${code}: ${e.message}`);
    return null;
  }
}

/** 新浪财经 - 场内行情 */
async function fetchFundFromSina(code) {
  try {
    const sinaCode = (code.startsWith('5') || code.startsWith('1')) ? `sh${code}` : `sz${code}`;
    const url = `https://hq.sinajs.cn/list=${sinaCode}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const match = text.match(/="([^"]+)"/);
    if (!match || !match[1]) throw new Error('empty response');
    const parts = match[1].split(',');
    if (parts.length < 4) throw new Error('too few fields');
    return {
      name: parts[0] || '',
      marketPrice: parseFloat(parts[3]) || 0,   // 当前价（盘中用 parts[3]=当前价）
      open: parseFloat(parts[1]) || 0,
      previousClose: parseFloat(parts[2]) || 0,
      high: parseFloat(parts[4]) || 0,
      low: parseFloat(parts[5]) || 0,
    };
  } catch (e) {
    console.warn(`[sina] ${code}: ${e.message}`);
    return null;
  }
}

/** Yahoo Finance - 美股/ETF 行情，返回 { currentPrice, previousClose } */
async function fetchUSQuote(ticker) {
  try {
    const url = `https://query1.finance.yahoo.com/v8/finance/chart/${ticker}?interval=1d&range=2d`;
    const res = await fetchWithTimeout(url, { headers: { 'User-Agent': UA } });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const data = await res.json();
    const result = data?.chart?.result?.[0];
    if (!result) throw new Error('no result');
    const meta = result.meta;
    const currentPrice = meta.regularMarketPrice || meta.previousClose || 0;
    const previousClose = meta.previousClose || meta.chartPreviousClose || 0;
    return { ticker, currentPrice, previousClose };
  } catch (e) {
    console.warn(`[yahoo] ${ticker}: ${e.message}`);
    return null;
  }
}

/** 汇率 USD/CNY - 多源兜底 */
async function fetchUsdCny() {
  // 源1: frankfurter.app（免费，无需 key）
  try {
    const res = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD&to=CNY');
    if (res.ok) {
      const d = await res.json();
      const rate = d?.rates?.CNY;
      if (rate && rate > 5) return rate;
    }
  } catch { /* fallthrough */ }

  // 源2: open.er-api.com（免费，无需 key）
  try {
    const res = await fetchWithTimeout('https://open.er-api.com/v6/latest/USD');
    if (res.ok) {
      const d = await res.json();
      const rate = d?.rates?.CNY;
      if (rate && rate > 5) return rate;
    }
  } catch { /* fallthrough */ }

  return 7.25; // 最终兜底
}

/** 批量抓取美股行情，去重后并发 */
async function fetchUSQuotesBatch(tickers) {
  const unique = [...new Set(tickers)];
  const results = await Promise.all(unique.map(fetchUSQuote));
  const map = {};
  for (const r of results) {
    if (r) map[r.ticker] = r;
  }
  return map;
}

/** 计算代理篮子加权涨跌幅 */
function calcProxyReturn(benchmark, quotesMap) {
  const weights = PROXY_BASKET_WEIGHTS[benchmark];
  if (!weights) return { proxyReturn: 0, proxyQuotes: [] };

  let totalReturn = 0;
  let totalWeight = 0;
  const proxyQuotes = [];

  for (const [ticker, weight] of Object.entries(weights)) {
    const q = quotesMap[ticker];
    const currentPrice = q?.currentPrice || 0;
    const previousClose = q?.previousClose || 0;
    const changeRate = previousClose > 0 ? (currentPrice / previousClose - 1) : 0;
    proxyQuotes.push({ ticker, weight, currentPrice, previousClose, changeRate });
    if (previousClose > 0) {
      totalReturn += changeRate * weight;
      totalWeight += weight;
    }
  }

  return {
    proxyReturn: totalWeight > 0 ? totalReturn / totalWeight : 0,
    proxyQuotes,
  };
}

/** 同步单个基金 */
async function syncSingleFund(code, config, quotesMap, fxRate) {
  const fundInfo = await fetchFundFromEastmoney(code);
  const marketData = await fetchFundFromSina(code);
  const { proxyReturn, proxyQuotes } = calcProxyReturn(config.benchmark, quotesMap);

  const officialNavT1 = fundInfo?.officialNavT1 || 0;
  const estimatedNav = fundInfo?.estimatedNav || (officialNavT1 > 0 ? officialNavT1 * (1 + proxyReturn) : 0);
  const marketPrice = marketData?.marketPrice || 0;
  const previousClose = marketData?.previousClose || fundInfo?.officialNavT1 || 0;
  const premiumRate = estimatedNav > 0 && marketPrice > 0 ? marketPrice / estimatedNav - 1 : null;

  return {
    code,
    name: config.name,
    benchmark: config.benchmark,
    pageCategory: config.type,
    fundType: config.type.includes('etf') ? 'ETF' : 'LOF',
    estimateMode: 'proxy',

    officialNavT1,
    navDate: fundInfo?.navDate || '',
    estimatedNav,
    estimatedNavChangeRate: fundInfo?.estimatedNavChangeRate || proxyReturn,
    navHistory: [],
    disclosedHoldings: [],
    holdingQuotes: [],

    marketPrice,
    previousClose,
    marketDate: new Date().toISOString().slice(0, 10),
    marketTime: new Date().toISOString().slice(11, 19),

    premiumRate,

    proxyBasketName: config.benchmark,
    proxyQuotes,
    proxyQuoteDate: new Date().toISOString().slice(0, 10),
    proxyQuoteTime: new Date().toISOString().slice(11, 19),

    fx: {
      pair: 'USD/CNY',
      currentRate: fxRate,
      previousCloseRate: fxRate,
    },

    updatedAt: new Date().toISOString(),
  };
}

/** 批量同步所有基金 */
export async function syncAllFunds(db, options = {}) {
  const force = options.force || false;
  const startTime = Date.now();

  // 检查同步间隔
  if (!force) {
    const lastSync = await db.prepare(
      'SELECT synced_at FROM runtime_runs ORDER BY id DESC LIMIT 1'
    ).first();
    if (lastSync?.synced_at) {
      const elapsed = (startTime - new Date(lastSync.synced_at).getTime()) / 60000;
      if (elapsed < 5) {
        return { ok: true, skipped: true, reason: 'Too soon since last sync', lastSyncAt: lastSync.synced_at };
      }
    }
  }

  try {
    // 1. 收集所有需要的美股代理 ticker
    const allTickers = [];
    for (const config of Object.values(FUND_CATALOG)) {
      allTickers.push(...(config.proxyTickers || []));
    }

    // 2. 并发抓取：美股行情 + 汇率
    const [quotesMap, fxRate] = await Promise.all([
      fetchUSQuotesBatch(allTickers),
      fetchUsdCny(),
    ]);

    console.log(`[SyncEngine] US quotes: ${Object.keys(quotesMap).length} tickers, USD/CNY: ${fxRate}`);

    // 3. 逐个同步基金（天天基金+新浪串行，避免触发限流）
    const funds = [];
    for (const [code, config] of Object.entries(FUND_CATALOG)) {
      const fundData = await syncSingleFund(code, config, quotesMap, fxRate);
      if (fundData) funds.push(fundData);
      await new Promise(r => setTimeout(r, 150));
    }

    if (!funds.length) throw new Error('No funds synced');

    // 4. 写入 D1
    const syncedAt = new Date().toISOString();
    const stmts = [
      db.prepare('INSERT INTO runtime_runs (synced_at, fund_count, source_url) VALUES (?, ?, ?)')
        .bind(syncedAt, funds.length, 'sync-engine-auto'),
    ];
    for (const fund of funds) {
      stmts.push(
        db.prepare(
          `INSERT INTO latest_fund_runtime (code, synced_at, runtime_json)
           VALUES (?, ?, ?)
           ON CONFLICT(code) DO UPDATE SET synced_at=excluded.synced_at, runtime_json=excluded.runtime_json`
        ).bind(fund.code, syncedAt, JSON.stringify(fund))
      );
    }
    await db.batch(stmts);

    const duration = Date.now() - startTime;
    console.log(`[SyncEngine] Done: ${funds.length} funds in ${duration}ms`);
    return { ok: true, skipped: false, syncedAt, fundCount: funds.length, duration, funds: funds.map(f => f.code) };
  } catch (error) {
    console.error('[SyncEngine] Failed:', error);
    return { ok: false, error: error.message, duration: Date.now() - startTime };
  }
}

export async function getAllFunds(db) {
  const result = await db.prepare('SELECT code, runtime_json FROM latest_fund_runtime ORDER BY code').all();
  return (result.results || []).map(row => {
    try { return JSON.parse(row.runtime_json); } catch { return null; }
  }).filter(Boolean);
}

export async function getFundByCode(db, code) {
  const row = await db.prepare(
    'SELECT code, synced_at, runtime_json FROM latest_fund_runtime WHERE code = ?'
  ).bind(code).first();
  if (!row) return null;
  try {
    const fund = JSON.parse(row.runtime_json);
    fund.syncedAt = row.synced_at;
    return fund;
  } catch { return null; }
}
