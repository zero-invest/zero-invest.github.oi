/**
 * 数据同步引擎 - 使用与本地 sync-funds.mjs 相同的数据源
 * 腾讯行情(qt.gtimg.cn) + 新浪汇率 + 天天基金净值
 */

import rawFundCatalog from '../../../src/data/fundCatalog.json';
import shortNames from '../../../src/data/fund-short-names.json';

const PROXY_BASKET_META = {
  'us-oil': { benchmark: '原油', tickers: ['USO', 'BNO'] },
  'us-oil-upstream': { benchmark: '油气', tickers: ['XOP', 'XLE'] },
  'us-gold': { benchmark: '黄金', tickers: ['GLD', 'IAU'] },
  'us-precious-metals': { benchmark: '黄金', tickers: ['GLD', 'IAU'] },
  'us-commodities': { benchmark: '商品', tickers: ['DBC', 'GSG'] },
  'us-semiconductor': { benchmark: '半导体', tickers: ['SOXX', 'SMH'] },
  'us-sp-info-tech': { benchmark: '美股科技', tickers: ['XLK', 'QQQ'] },
  'us-sandp500': { benchmark: '标普500', tickers: ['SPY', 'IVV'] },
  'us-nasdaq100': { benchmark: '纳斯达克100', tickers: ['QQQ', 'TQQQ'] },
  'us-overseas-tech': { benchmark: '海外科技', tickers: ['QQQ', 'XLK'] },
  'us-silver': { benchmark: '白银', tickers: ['SLV', 'SIVR'], futures: 'nf_SImain' },  // COMEX 白银连续，用于日内估值
  'us-agriculture': { benchmark: '农业', tickers: ['DBA', 'MOO'] },
  'japan-nikkei225': { benchmark: '日经225', tickers: ['EWJ', 'DXJ'] },
  'cn-kr-semiconductor': { benchmark: '半导体', tickers: ['SOXX', 'SMH'] },
  'cn-coal': { benchmark: '煤炭', tickers: ['KOL', 'XLE'] },
  'cn-csi500': { benchmark: '中证500', tickers: ['510500', '159922'] },
  'cn-hs300': { benchmark: '沪深300', tickers: ['510300', '159919'] },
  'cn-giant100': { benchmark: '巨头100', tickers: ['MCHI', 'FXI'] },
  'cn-csi1000': { benchmark: '中证1000', tickers: ['159845', '512100'] },
};

const FUND_CATALOG = Object.fromEntries(
  (Array.isArray(rawFundCatalog) ? rawFundCatalog : [])
    .map((item) => {
      const code = String(item?.code || '').trim();
      if (!code) return null;
      const proxyMeta = PROXY_BASKET_META[String(item?.proxyBasketKey || '').trim()] || null;
      const shortName = shortNames?.[code]?.shortName || shortNames?.[code]?.fullName || '';
      return [code, {
        name: shortName || code,
        benchmark: proxyMeta?.benchmark || shortName || code,
        type: String(item?.pageCategory || 'qdii-lof'),
        estimateMode: String(item?.estimateMode || 'proxy'),
        proxyTickers: Array.isArray(proxyMeta?.tickers) ? proxyMeta.tickers : [],
        proxyBasketKey: String(item?.proxyBasketKey || '').trim(),
        priority: Number(item?.priority || 999),
      }];
    })
    .filter(Boolean),
);

// 5/6开头 -> sh，其他 -> sz（与本地sync-funds.mjs一致）
function getMarketPrefix(code) {
  return (code.startsWith('5') || code.startsWith('6')) ? 'sh' : 'sz';
}

const PROXY_BASKET_WEIGHTS = {
  '原油': { USO: 0.6, BNO: 0.4 },
  '黄金': { GLD: 0.7, IAU: 0.3 },
  '白银': { SLV: 0.8, SIVR: 0.2 },
  '油气': { XOP: 0.5, XLE: 0.5 },
};

const SILVER_REALTIME_PROXY_CODES = new Set(['161226']);
const SILVER_US_PROXY_TICKERS = new Set(['SLV', 'SIVR', 'AGQ']);
const SILVER_REALTIME_CARRY_MAX_MOVE = 0.03;
const SILVER_REALTIME_CARRY_ANOMALY_MOVE = 0.06;

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36';

async function fetchWithTimeout(url, options = {}, timeoutMs = 8000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * 腾讯行情 - 批量获取场内基金价格
 * 格式: qt.gtimg.cn/q=sh160723,sh501018,...
 * 返回: Map<code, { marketPrice, previousClose, name }>
 */
async function fetchFundQuotesBatch(codes) {
  const result = new Map();
  try {
    const symbols = codes.map(code => `${getMarketPrefix(code)}${code}`).join(',');
    const url = `https://qt.gtimg.cn/q=${symbols}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    // 腾讯行情返回 GBK，Worker 环境用 TextDecoder 解码
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    // 格式: v_sh160723="1~嘉实原油~160723~99.31~99.31~..."
    for (const line of text.split(';')) {
      const m = line.match(/v_[a-z]{2}(\d{6})="([^"]+)"/);
      if (!m) continue;
      const code = m[1];
      const parts = m[2].split('~');
      const marketPrice = parseFloat(parts[3]) || 0;
      const previousClose = parseFloat(parts[4]) || 0;
      const name = parts[1] || '';
      result.set(code, { marketPrice, previousClose, name });
    }
  } catch (e) {
    console.warn(`[tencent-quote] batch failed: ${e.message}`);
  }
  return result;
}

/**
 * 腾讯行情 - 批量获取美股代理 ETF
 * 格式: qt.gtimg.cn/q=usUSO,usBNO,...
 */
async function fetchUSQuotesBatch(tickers) {
  const result = new Map();
  try {
    const unique = [...new Set(tickers)];
    const symbols = unique.map(t => `us${t}`).join(',');
    const url = `https://qt.gtimg.cn/q=${symbols}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://gu.qq.com/', 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    // 格式: v_usUSO="1~USO~...~currentPrice~...~previousClose~..."
    for (const line of text.split(';')) {
      const m = line.match(/v_us([A-Z]+)="([^"]+)"/);
      if (!m) continue;
      const ticker = m[1];
      const parts = m[2].split('~');
      // 腾讯美股字段: [0]类型 [1]名称 [2]代码 [3]当前价 [4]涨跌额 [5]涨跌% [6]成交量 [7]成交额 [8]昨收 ...
      const currentPrice = parseFloat(parts[3]) || 0;
      const previousClose = parseFloat(parts[8]) || parseFloat(parts[3]) || 0;
      result.set(ticker, { ticker, currentPrice, previousClose });
    }
  } catch (e) {
    console.warn(`[tencent-us] batch failed: ${e.message}`);
  }
  return result;
}

/**
 * 新浪财经 - 获取 USD/CNY 汇率
 */
async function fetchUsdCny() {
  try {
    const res = await fetchWithTimeout(
      'https://hq.sinajs.cn/list=USDCNY,fx_susdcny',
      { headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': UA } }
    );
    if (!res.ok) throw new Error(`status ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    // 取第一个有效汇率
    const m = text.match(/"([67]\.\d+)/);
    if (m) return parseFloat(m[1]);
  } catch (e) {
    console.warn(`[sina-fx] ${e.message}`);
  }
  // 兜底: frankfurter.app
  try {
    const res = await fetchWithTimeout('https://api.frankfurter.app/latest?from=USD&to=CNY');
    if (res.ok) {
      const d = await res.json();
      if (d?.rates?.CNY > 5) return d.rates.CNY;
    }
  } catch { /* ignore */ }
  return 7.25;
}

/**
 * 新浪财经 - 获取商品期货行情（白银 nf_SImain、黄金 nf_GCmain、原油 nf_CLmain）
 * 格式: hq.sinajs.cn/list=nf_SImain,nf_GCmain
 * 返回: Map<code, { currentPrice, previousClose, changeRate }>
 */
async function fetchCommodityFutures(futuresCodes) {
  const result = new Map();
  if (!futuresCodes.length) return result;
  try {
    const url = `https://hq.sinajs.cn/list=${futuresCodes.join(',')}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://finance.sina.com.cn/', 'User-Agent': UA },
    }, 10000);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const buf = await res.arrayBuffer();
    const text = new TextDecoder('gbk').decode(buf);
    for (const line of text.split(';')) {
      const m = line.match(/hq_str_([a-z\d_]+)="([^"]+)"/);
      if (!m) continue;
      const code = m[1];
      const parts = m[2].split(',');
      const currentPrice = parseFloat(parts[1]) || 0;
      const previousClose = parseFloat(parts[2]) || 0;
      const changeRate = previousClose > 0 ? currentPrice / previousClose - 1 : 0;
      result.set(code, { code, currentPrice, previousClose, changeRate });
    }
  } catch (e) {
    console.warn(`[sina-futures] batch failed: ${e.message}`);
  }
  return result;
}

/**
 * 天天基金 - 获取最新官方净值（历史净值接口，非交易时段也有数据）
 */
async function fetchOfficialNav(code) {
  // 数据源1：东财 chart/lsjz API（最稳定，Worker 环境推荐）
  try {
    const url = `https://api.fund.eastmoney.com/chart/lsjz?callback=GetData&fundCode=${code}&pageIndex=1&pageSize=5&startDate=&endDate=`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://fund.eastmoney.com/', 'User-Agent': UA },
    }, 10000);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const m = text.match(/GetData\((\{[\s\S]+\})\)/);
    if (!m) throw new Error('no callback');
    const data = JSON.parse(m[1]);
    const row = data?.Data?.LSJZList?.[0];
    if (!row) throw new Error('no data');
    const navVal = parseFloat(row.DWJZ) || 0;
    if (navVal > 0) {
      return {
        officialNavT1: navVal,
        navDate: (row.FSRQ || '').slice(0, 10),
      };
    }
    throw new Error(`invalid nav: ${row.DWJZ}`);
  } catch (e) {
    console.warn(`[eastmoney-nav-chart] ${code}: ${e.message}`);
  }

  // 数据源2：东财 f10/lsjz API（备用）
  try {
    const url2 = `https://api.fund.eastmoney.com/f10/lsjz?callback=x&fundCode=${code}&pageIndex=1&pageSize=1&startDate=&endDate=`;
    const res2 = await fetchWithTimeout(url2, {
      headers: { Referer: 'https://fundf10.eastmoney.com/', 'User-Agent': UA },
    }, 10000);
    if (!res2.ok) throw new Error(`status ${res2.status}`);
    const buf2 = await res2.arrayBuffer();
    const text2 = new TextDecoder('utf-8').decode(buf2);
    const m2 = text2.match(/x\((\{[\s\S]+\})\)/);
    if (!m2) throw new Error('no callback');
    const data2 = JSON.parse(m2[1]);
    const row2 = data2?.Data?.LSJZList?.[0];
    if (!row2) throw new Error('no data');
    const navVal2 = parseFloat(row2.DWJZ) || 0;
    if (navVal2 > 0) {
      return {
        officialNavT1: navVal2,
        navDate: (row2.FSRQ || '').slice(0, 10),
      };
    }
    throw new Error(`invalid nav: ${row2.DWJZ}`);
  } catch (e2) {
    console.warn(`[eastmoney-nav-f10] ${code}: ${e2.message}`);
  }

  // 数据源3：东财 pingzhongdata.js（包含净值序列，最终兜底）
  try {
    const url3 = `https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`;
    const res3 = await fetchWithTimeout(url3, {
      headers: { Referer: `https://fund.eastmoney.com/${code}.html`, 'User-Agent': UA },
    }, 12000);
    if (!res3.ok) throw new Error(`status ${res3.status}`);
    const text3 = await res3.text();
    // Data_netWorthTrend 包含 [{x: timestamp, y: nav}, ...]
    const m3 = text3.match(/var\s+Data_netWorthTrend\s*=\s*(\[[\s\S]+?\]);/);
    if (!m3) throw new Error('no trend data');
    const series = JSON.parse(m3[1]);
    if (!Array.isArray(series) || !series.length) throw new Error('empty trend');
    const last = series[series.length - 1];
    const navVal3 = parseFloat(last?.y) || 0;
    const ts = Number(last?.x);
    if (navVal3 > 0 && ts > 0) {
      const dt = new Date(ts);
      const navDate3 = `${dt.getFullYear()}-${String(dt.getMonth() + 1).padStart(2, '0')}-${String(dt.getDate()).padStart(2, '0')}`;
      return { officialNavT1: navVal3, navDate: navDate3 };
    }
    throw new Error('invalid nav from pingzhong');
  } catch (e3) {
    console.warn(`[eastmoney-nav-pingzhong] ${code}: ${e3.message}`);
  }

  return null;
}

/**
 * 天天基金 - 实时估值（交易时段），同时提取昨日官方净值
 * 注意：非交易时段 gsz=0 但 dwjz 仍有效，所以始终返回官方净值字段
 */
async function fetchEstimatedNav(code) {
  try {
    const url = `https://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://fund.eastmoney.com/', 'User-Agent': UA },
    });
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const m = text.match(/jsonpgz\((\{.*?\})\)/);
    if (!m) return null;
    const d = JSON.parse(m[1]);
    // fundgz 的 dwjz 字段是昨日官方净值，始终有效（非交易时段也可靠）
    const officialNavT1FromGz = parseFloat(d.dwjz) || 0;
    const navDateFromGz = (d.jzrq || '').slice(0, 10);
    const estimatedNav = parseFloat(d.gsz) || 0;
    // 始终返回官方净值，即使无实时估值（estimatedNav=0）
    const result = { officialNavT1FromGz, navDateFromGz };
    if (estimatedNav > 0) {
      result.estimatedNav = estimatedNav;
      result.estimatedNavChangeRate = parseFloat(d.gszzl) / 100 || 0;
      result.estimateTime = d.gztime || '';
    }
    return result;
  } catch (e) {
    console.warn(`[eastmoney-gz] ${code}: ${e.message}`);
    return null;
  }
}

/**
 * 天天基金 - 限购状态（增强版：添加容错和日志）
 */
/**
 * 将东财 API MINDT（万元数值）格式化为可读限额字符串。
 * MINDT=10 → "10万元"；MINDT=0.05 → "500元"
 */
function formatMindtLimit(mindt) {
  const val = Number(mindt);
  if (!isFinite(val) || val <= 0) return '';
  if (val < 1) {
    const yuan = Math.round(val * 10000);
    return `${yuan}元`;
  }
  if (Number.isInteger(val)) return `${val}万元`;
  return `${val.toFixed(2).replace(/\.?0+$/, '')}万元`;
}

function mapIsBuyToStatus(value) {
  const code = String(value ?? '').trim();
  if (!code) {
    return '';
  }

  if (code === '4') {
    return '限大额';
  }

  return ['1', '2', '3', '8', '9'].includes(code) ? '开放申购' : '';
}

function mapIsSalesToStatus(value) {
  const code = String(value ?? '').trim();
  if (!code) {
    return '';
  }

  return code === '1' ? '开放赎回' : '暂停赎回';
}

function buildPurchaseStatusText(buyStatus, redeemStatus, pageCategory) {
  if (pageCategory === 'etf') {
    return '场内交易 / 开放赎回';
  }

  return [buyStatus, redeemStatus].filter(Boolean).join(' / ');
}

function formatPurchaseLimit(buyStatus, apiLimitText, pageCategory) {
  if (pageCategory === 'etf') {
    return '不限购';
  }

  const normalizedBuyStatus = String(buyStatus ?? '').trim();
  const normalizedApiLimitText = String(apiLimitText ?? '').trim();

  if (normalizedBuyStatus === '暂停申购') {
    return '暂停申购';
  }

  if (normalizedBuyStatus === '开放申购') {
    return '不限购';
  }

  if (normalizedBuyStatus === '限大额') {
    return normalizedApiLimitText || '限购';
  }

  return '';
}

async function fetchPurchaseStatus(code) {
  try {
    const url = `https://api.fund.eastmoney.com/Fund/GetSingleFundInfo?callback=x&fcode=${code}&fileds=FCODE,ISBUY,ISSALES,MINDT,DTZT,SHORTNAME`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: `https://fund.eastmoney.com/${code}.html`, 'User-Agent': UA },
    }, 10000); // 10 秒超时（第三个参数）
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const m = text.match(/x\((\{.*\})\)/s);
    if (!m) throw new Error('no callback');
    const data = JSON.parse(m[1])?.Data;
    const isbuy = String(data?.ISBUY ?? '').trim();
    const issales = String(data?.ISSALES ?? '').trim();
    
    const buyStatus = mapIsBuyToStatus(isbuy);
    const redeemStatus = mapIsSalesToStatus(issales);
    const mindtLimit = formatMindtLimit(data?.MINDT);
    
    if (!buyStatus && !redeemStatus) {
      console.warn(`[purchase] ${code}: API returned empty status (ISBUY=${isbuy}, ISSALES=${issales})`);
    }
    
    return { buyStatus, redeemStatus, mindtLimit };
  } catch (e) {
    console.warn(`[purchase] ${code}: ${e.message}`);
    return { buyStatus: '', redeemStatus: '', mindtLimit: '' };
  }
}


/**
 * 天天基金 - 净值历史（f10/lsjz，最近 60 条）
 * 返回: [{date: "YYYY-MM-DD", nav: number}]，最新在前
 */
async function fetchNavHistory(code) {
  try {
    const endDate = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const startDate = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
    const url = `https://api.fund.eastmoney.com/f10/lsjz?callback=x&fundCode=${code}&pageIndex=1&pageSize=60&startDate=${startDate}&endDate=${endDate}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://fundf10.eastmoney.com/', 'User-Agent': UA },
    }, 12000);
    if (!res.ok) throw new Error(`status ${res.status}`);
    const text = await res.text();
    const m = text.match(/x\((\{[\s\S]+\})\)/);
    if (!m) throw new Error('no callback');
    const data = JSON.parse(m[1]);
    const list = data?.Data?.LSJZList || [];
    return list
      .map(row => ({ date: (row.FSRQ || '').slice(0, 10), nav: parseFloat(row.DWJZ) || 0 }))
      .filter(item => item.date && item.nav > 0);
  } catch (e) {
    console.warn(`[nav-history] ${code}: ${e.message}`);
    return [];
  }
}

// ─── Holdings Disclosure (regex-based, no cheerio) ───────────────────────────

function stripHtmlTags(html) {
  return String(html || '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

function isHoldingTicker(value) {
  return /^[0-9A-Z._-]{1,12}$/.test(String(value || '').toUpperCase().trim());
}

function isUsHoldingTicker(value) {
  return /^[A-Z]{1,5}(?:\.[A-Z])?$/.test(String(value || '').toUpperCase().trim());
}

/**
 * 从 FundArchivesDatas.aspx 响应中提取 apidata.content（HTML 字符串）
 */
function extractFundArchivesContent(text) {
  // 格式: var apidata={content:"<html>...",records:N,...}
  const m = String(text || '').match(/content:"((?:[^"\\]|\\.)*?)"/);
  if (!m) return null;
  return m[1]
    .replace(/\\"/g, '"')
    .replace(/\\n/g, '\n')
    .replace(/\\r/g, '\r')
    .replace(/\\t/g, '\t')
    .replace(/\\\\/g, '\\');
}

/**
 * 解析持仓 HTML 表格（无 cheerio，用正则）
 * 返回: { disclosedHoldingsTitle, disclosedHoldingsReportDate, disclosedHoldings[] }
 */
function parseHoldingsFromHtml(html) {
  const empty = { disclosedHoldingsTitle: '', disclosedHoldingsReportDate: '', disclosedHoldings: [] };
  if (!html) return empty;
  // 提取报告标题和截止日期
  const reportMatch = html.match(/(\d{4}年[1-4]季度股票投资明细)[^]*?截止至[：:]\s*(\d{4}-\d{2}-\d{2})/);
  const disclosedHoldingsTitle = reportMatch?.[1] || '';
  const disclosedHoldingsReportDate = reportMatch?.[2] || '';
  // 逐行解析 <tr>
  const rowRegex = /<tr[^>]*>([\s\S]*?)<\/tr>/gi;
  const disclosedHoldings = [];
  let rowMatch;
  while ((rowMatch = rowRegex.exec(html)) !== null && disclosedHoldings.length < 10) {
    const rowHtml = rowMatch[1];
    const tdRegex = /<td[^>]*>([\s\S]*?)<\/td>/gi;
    const cells = [];
    let tdMatch;
    while ((tdMatch = tdRegex.exec(rowHtml)) !== null) {
      cells.push(stripHtmlTags(tdMatch[1]));
    }
    if (cells.length < 6 || !/^\d+$/.test(cells[0]) || !isHoldingTicker(cells[1])) continue;
    const ticker = cells[1].toUpperCase().trim();
    disclosedHoldings.push({
      ticker,
      name: cells[2] || '',
      weight: parseFloat(String(cells[cells.length - 3] || '').replace(/,/g, '')) || 0,
      shares: parseFloat(String(cells[cells.length - 2] || '').replace(/,/g, '')) || 0,
      marketValue: parseFloat(String(cells[cells.length - 1] || '').replace(/,/g, '')) || 0,
      currentPrice: 0,
      changeRate: 0,
    });
  }
  return { disclosedHoldingsTitle, disclosedHoldingsReportDate, disclosedHoldings };
}

/**
 * 为 A 股持仓获取行情（push2.eastmoney.com）
 * secid: sh60xxxx→1.xxxxxx, sz00/30xxxx→0.xxxxxx
 */
async function fetchAshareHoldingQuotes(tickers) {
  const result = new Map();
  const ashares = tickers.filter(t => /^\d{6}$/.test(t));
  if (!ashares.length) return result;
  const secids = ashares.map(t => {
    if (/^6/.test(t)) return `1.${t}`;
    if (/^[03]/.test(t)) return `0.${t}`;
    return null;
  }).filter(Boolean);
  if (!secids.length) return result;
  try {
    const url = `https://push2.eastmoney.com/api/qt/ulist.np/get?fltt=2&invt=2&fields=f2,f3,f12,f13&ut=267f9ad526dbe6b0262ab19316f5a25b&secids=${secids.join(',')}`;
    const res = await fetchWithTimeout(url, {
      headers: { Referer: 'https://fundf10.eastmoney.com/', 'User-Agent': UA },
    }, 10000);
    if (!res.ok) return result;
    const data = await res.json();
    for (const item of data?.data?.diff || []) {
      if (!item?.f12) continue;
      result.set(String(item.f12), {
        currentPrice: Number(item.f2) || 0,
        changeRate: (Number(item.f3) || 0) / 100,
      });
    }
  } catch (e) {
    console.warn(`[ashare-holding-quotes] ${e.message}`);
  }
  return result;
}

/**
 * 天天基金 - 持仓披露（FundArchivesDatas.aspx 季报）
 * 仅拉取最近 2 年的数据，找到有效持仓即停止
 */
async function fetchHoldingsDisclosure(code) {
  const empty = { disclosedHoldingsTitle: '', disclosedHoldingsReportDate: '', disclosedHoldings: [] };
  const currentYear = new Date(Date.now() + 8 * 60 * 60 * 1000).getFullYear();
  for (const year of [currentYear, currentYear - 1]) {
    try {
      const url = `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=${year}&month=&rt=${Date.now()}`;
      const res = await fetchWithTimeout(url, {
        headers: { Referer: `https://fundf10.eastmoney.com/ccmx_${code}.html`, 'User-Agent': UA },
      }, 12000);
      if (!res.ok) continue;
      const text = await res.text();
      const htmlContent = extractFundArchivesContent(text);
      if (!htmlContent) continue;
      const parsed = parseHoldingsFromHtml(htmlContent);
      if (!parsed.disclosedHoldings.length) continue;
      // 拉行情：A 股 + 美股
      const allTickers = parsed.disclosedHoldings.map(h => h.ticker);
      const usTickers = allTickers.filter(isUsHoldingTicker);
      const [ashareQuotes, usQuotesMap] = await Promise.all([
        fetchAshareHoldingQuotes(allTickers),
        usTickers.length ? fetchUSQuotesBatch(usTickers) : Promise.resolve(new Map()),
      ]);
      const disclosedHoldings = parsed.disclosedHoldings.map(h => {
        const ashare = ashareQuotes.get(h.ticker);
        if (ashare) return { ...h, ...ashare };
        const us = usQuotesMap.get(h.ticker);
        if (us && us.currentPrice > 0) {
          const changeRate = us.previousClose > 0 ? us.currentPrice / us.previousClose - 1 : 0;
          return { ...h, currentPrice: us.currentPrice, changeRate };
        }
        return h;
      });
      return {
        disclosedHoldingsTitle: parsed.disclosedHoldingsTitle,
        disclosedHoldingsReportDate: parsed.disclosedHoldingsReportDate,
        disclosedHoldings,
      };
    } catch (e) {
      console.warn(`[holdings-disclosure] ${code}/${year}: ${e.message}`);
    }
  }
  return empty;
}

function calcProxyReturn(config, quotesMap, futuresMap = new Map()) {
  const benchmark = config.benchmark;
  const proxyMeta = PROXY_BASKET_META[config.proxyBasketKey] || {};
  const futuresCode = proxyMeta.futures;
  
  // 优先使用期货数据（日内交易时段）
  if (futuresCode && futuresMap.has(futuresCode)) {
    const futures = futuresMap.get(futuresCode);
    if (futures.previousClose > 0) {
      const changeRate = futures.changeRate;
      return {
        proxyReturn: changeRate,
        proxyQuotes: [{
          ticker: futuresCode,
          name: '期货连续',
          weight: 1,
          currentPrice: futures.currentPrice,
          previousClose: futures.previousClose,
          changeRate,
        }],
        mode: 'futures',
      };
    }
  }
  
  // 否则使用美股 ETF 代理篮子
  const fallbackWeights = PROXY_BASKET_WEIGHTS[benchmark];
  const tickers = Array.isArray(config.proxyTickers) ? config.proxyTickers.filter(Boolean) : [];
  const derivedWeights = tickers.length
    ? Object.fromEntries(tickers.map((ticker) => [ticker, 1 / tickers.length]))
    : null;
  const weights = fallbackWeights || derivedWeights;
  if (!weights) return { proxyReturn: 0, proxyQuotes: [] };
  let totalReturn = 0, totalWeight = 0;
  const proxyQuotes = [];
  for (const [ticker, weight] of Object.entries(weights)) {
    const q = quotesMap.get(ticker);
    const currentPrice = q?.currentPrice || 0;
    const previousClose = q?.previousClose || 0;
    const changeRate = previousClose > 0 ? currentPrice / previousClose - 1 : 0;
    proxyQuotes.push({ ticker, weight, currentPrice, previousClose, changeRate });
    if (previousClose > 0) { totalReturn += changeRate * weight; totalWeight += weight; }
  }
  return {
    proxyReturn: totalWeight > 0 ? totalReturn / totalWeight : 0,
    proxyQuotes,
    mode: 'etf',
  };
}

function getFundIntradayReturn(quote) {
  const marketPrice = Number(quote?.marketPrice || 0);
  const previousClose = Number(quote?.previousClose || 0);
  if (!(marketPrice > 0) || !(previousClose > 0)) {
    return null;
  }
  const value = marketPrice / previousClose - 1;
  return Number.isFinite(value) ? value : null;
}

function applySilverRealtimeCarryToProxyQuotes(code, proxyQuotes, fundQuote) {
  if (!SILVER_REALTIME_PROXY_CODES.has(code) || !Array.isArray(proxyQuotes) || proxyQuotes.length === 0) {
    return proxyQuotes;
  }

  const anchorReturnRaw = getFundIntradayReturn(fundQuote);
  if (!Number.isFinite(anchorReturnRaw)) {
    return proxyQuotes;
  }

  if (Math.abs(anchorReturnRaw) > SILVER_REALTIME_CARRY_ANOMALY_MOVE) {
    return proxyQuotes;
  }

  const carryReturn = Math.max(-SILVER_REALTIME_CARRY_MAX_MOVE, Math.min(SILVER_REALTIME_CARRY_MAX_MOVE, anchorReturnRaw));
  return proxyQuotes.map((item) => {
    const ticker = String(item?.ticker || '').toUpperCase();
    const previousClose = Number(item?.previousClose || 0);
    const currentPrice = Number(item?.currentPrice || 0);
    if (!SILVER_US_PROXY_TICKERS.has(ticker) || !(previousClose > 0) || !(currentPrice > 0)) {
      return item;
    }

    const carriedCurrent = currentPrice * (1 + carryReturn);
    if (!Number.isFinite(carriedCurrent) || carriedCurrent <= 0) {
      return item;
    }

    return {
      ...item,
      currentPrice: carriedCurrent,
      changeRate: carriedCurrent / previousClose - 1,
    };
  });
}

async function syncSingleFund(code, config, fundQuotesMap, usQuotesMap, fxRate, futuresMap, existingFundData = null) {
  // 判断是否需要刷新持仓（季报数据，每 6 小时刷新一次）
  const existingHoldings = existingFundData?.disclosedHoldings || [];
  const holdingsFetchedAt = existingFundData?.holdingsFetchedAt || '';
  const holdingsAge = holdingsFetchedAt ? Date.now() - new Date(holdingsFetchedAt).getTime() : Infinity;
  const needHoldings = existingHoldings.length === 0 || holdingsAge > 6 * 60 * 60 * 1000;

  // 判断是否需要刷新净值历史（每天刷新一次）
  const todayCst = new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10);
  const existingNavHistory = existingFundData?.navHistory || [];
  const needNavHistory = existingNavHistory.length === 0 || existingFundData?.navHistoryDate !== todayCst;

  // 并发获取净值 + 限购状态 + 持仓（按需） + 净值历史（按需）
  const [navData, gzData, purchaseData, holdingsData, navHistoryResult] = await Promise.all([
    fetchOfficialNav(code),
    fetchEstimatedNav(code),
    fetchPurchaseStatus(code),
    needHoldings ? fetchHoldingsDisclosure(code) : Promise.resolve(null),
    needNavHistory ? fetchNavHistory(code) : Promise.resolve(null),
  ]);

  // gzData.officialNavT1FromGz 在非交易时段也有效（已修复 fetchEstimatedNav）
  const officialNavT1 = navData?.officialNavT1 || gzData?.officialNavT1FromGz || 0;
  const navDate = navData?.navDate || gzData?.navDateFromGz || '';
  const estimatedNavFromGz = gzData?.estimatedNav || 0;
  const estimatedNavChangeRateFromGz = gzData?.estimatedNavChangeRate || 0;

  const quote = fundQuotesMap.get(code);
  const marketPrice = quote?.marketPrice || 0;
  const previousClose = quote?.previousClose || officialNavT1 || 0;
  const name = quote?.name || config.name;

  const proxyCalc = calcProxyReturn(config, usQuotesMap, futuresMap);
  const proxyQuotes = applySilverRealtimeCarryToProxyQuotes(code, proxyCalc.proxyQuotes, quote);
  const proxyWeightSum = proxyQuotes.reduce((sum, item) => sum + Math.max(0, Number(item?.weight) || 0), 0);
  const proxyReturn = proxyWeightSum > 0
    ? proxyQuotes.reduce((sum, item) => sum + (Number(item?.changeRate) || 0) * ((Number(item?.weight) || 0) / proxyWeightSum), 0)
    : proxyCalc.proxyReturn;
  const marketReturn = previousClose > 0 && marketPrice > 0 ? marketPrice / previousClose - 1 : 0;
  const signalReturn = config.estimateMode === 'market' ? marketReturn : proxyReturn;
  
  // 优先使用天天基金的估算净值（如果有），否则使用 proxy 计算
  // 如果 officialNavT1 缺失，则使用 previousClose 作为兜底基数，避免 estimatedNav/premiumRate 退化为 0
  const navBase = officialNavT1 > 0 ? officialNavT1 : (previousClose > 0 ? previousClose : 0);
  const effectiveEstimatedNav = estimatedNavFromGz > 0
    ? estimatedNavFromGz
    : (navBase > 0 ? navBase * (1 + signalReturn) : 0);
  const effectiveEstimatedNavChangeRate = estimatedNavFromGz > 0
    ? estimatedNavChangeRateFromGz
    : signalReturn;

  const normalizedBuyStatus = String(purchaseData.buyStatus || '').trim();
  const normalizedRedeemStatus = String(purchaseData.redeemStatus || '').trim();
  const purchaseStatus = buildPurchaseStatusText(normalizedBuyStatus, normalizedRedeemStatus, config.type);
  const purchaseLimit = formatPurchaseLimit(normalizedBuyStatus, purchaseData.mindtLimit, config.type);

  // 只有当 marketPrice 和 effectiveEstimatedNav 都大于 0 时才计算溢价率
  const premiumRate = (effectiveEstimatedNav > 0 && marketPrice > 0)
    ? (marketPrice / effectiveEstimatedNav - 1)
    : 0;

  // 净值历史：使用新拉取的或沿用已有缓存
  const navHistory = navHistoryResult ?? existingNavHistory;
  const navHistoryDate = navHistoryResult ? todayCst : (existingFundData?.navHistoryDate || '');

  // 持仓披露：使用新拉取的或沿用已有缓存
  const disclosedHoldings = holdingsData?.disclosedHoldings ?? existingHoldings;
  const disclosedHoldingsTitle = holdingsData?.disclosedHoldingsTitle ?? existingFundData?.disclosedHoldingsTitle ?? '';
  const disclosedHoldingsReportDate = holdingsData?.disclosedHoldingsReportDate ?? existingFundData?.disclosedHoldingsReportDate ?? '';
  const holdingsFetchedAtNew = holdingsData ? new Date().toISOString() : holdingsFetchedAt;

  // Ensure all critical fields have valid values
  const validatedName = name || config.name || code;
  const validatedBenchmark = config.benchmark || validatedName;
  const validatedOfficialNavT1 = officialNavT1 || 0;
  const validatedMarketPrice = marketPrice || 0;
  const validatedPreviousClose = previousClose || validatedOfficialNavT1 || 0;
  const validatedPremiumRate = premiumRate || 0;
  const validatedPurchaseStatus = purchaseStatus || '';
  const validatedRedeemStatus = normalizedRedeemStatus || '';

  return {
    code,
    priority: config.priority,
    detailMode: 'summary',
    name: validatedName,
    benchmark: validatedBenchmark,
    pageCategory: config.type,
    fundType: config.type.includes('etf') ? 'ETF' : 'LOF',
    estimateMode: config.estimateMode || 'proxy',

    officialNavT1: validatedOfficialNavT1,
    navDate: navDate || '',
    estimatedNav: effectiveEstimatedNav,
    estimatedNavChangeRate: effectiveEstimatedNavChangeRate,
    navHistory,
    navHistoryDate,
    disclosedHoldings,
    disclosedHoldingsTitle,
    disclosedHoldingsReportDate,
    holdingsFetchedAt: holdingsFetchedAtNew,
    holdingQuotes: [],

    marketPrice: validatedMarketPrice,
    previousClose: validatedPreviousClose,
    marketDate: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
    marketTime: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(11, 19),
    marketSource: 'tencent-qt',

    premiumRate: validatedPremiumRate,

    proxyBasketName: config.benchmark || '',
    proxyQuotes: proxyQuotes || [],
    proxyQuoteDate: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(0, 10),
    proxyQuoteTime: new Date(Date.now() + 8 * 60 * 60 * 1000).toISOString().slice(11, 19),

    fx: { pair: 'USD/CNY', currentRate: fxRate, previousCloseRate: fxRate },
    purchaseStatus: validatedPurchaseStatus,
    purchaseLimit,
    redeemStatus: validatedRedeemStatus,
    updatedAt: new Date().toISOString(),
  };
}

export async function syncAllFunds(db, options = {}) {
  const force = options.force || false;
  // 增加批次大小，从12增加到63（全部基金），确保一次同步所有基金
  const batchSize = Math.max(1, Number(options.batchSize || 63));
  const startTime = Date.now();

  // 减少同步间隔，从5分钟减少到1分钟，确保数据更及时
  if (!force) {
    const lastSync = await db.prepare('SELECT synced_at FROM runtime_runs ORDER BY id DESC LIMIT 1').first();
    if (lastSync?.synced_at) {
      const elapsed = (startTime - new Date(lastSync.synced_at).getTime()) / 60000;
      if (elapsed < 1) return { ok: true, skipped: true, reason: 'Too soon', lastSyncAt: lastSync.synced_at };
    }
  }

  try {
    const allCodes = Object.keys(FUND_CATALOG).sort((left, right) => {
      const leftPriority = Number(FUND_CATALOG[left]?.priority || 999);
      const rightPriority = Number(FUND_CATALOG[right]?.priority || 999);
      if (leftPriority !== rightPriority) return leftPriority - rightPriority;
      return left.localeCompare(right);
    });
    if (!allCodes.length) throw new Error('Fund catalog is empty');
    const cursorRow = await db.prepare('SELECT next_index FROM sync_engine_cursor WHERE id = 1').first();
    const cursorStart = force ? 0 : Math.max(0, Number(cursorRow?.next_index || 0));
    const selectedCodes = [];
    for (let i = 0; i < Math.min(batchSize, allCodes.length); i += 1) {
      selectedCodes.push(allCodes[(cursorStart + i) % allCodes.length]);
    }
    const allUsTickers = [...new Set(selectedCodes.flatMap((code) => FUND_CATALOG[code]?.proxyTickers || []))];
    
    // 收集需要期货的品种（白银、黄金、原油等）
    const needFutures = selectedCodes.some(code => {
      const config = FUND_CATALOG[code];
      const proxyMeta = PROXY_BASKET_META[config?.proxyBasketKey];
      return proxyMeta?.futures;
    });
    
    // 并发抓取：场内行情 + 美股行情 + 汇率 + 期货
    const [fundQuotesMap, usQuotesMap, fxRate, futuresMap] = await Promise.all([
      fetchFundQuotesBatch(selectedCodes),
      fetchUSQuotesBatch(allUsTickers),
      fetchUsdCny(),
      needFutures ? fetchCommodityFutures(['nf_SImain', 'nf_GCmain', 'nf_CLmain']) : Promise.resolve(new Map()),
    ]);

    console.log(`[SyncEngine] selected: ${selectedCodes.length}/${allCodes.length}, fund quotes: ${fundQuotesMap.size}, US quotes: ${usQuotesMap.size}, USD/CNY: ${fxRate}, futures: ${futuresMap?.size || 0}`);

    // 读取已有数据用于缓存持仓/净值历史
    const existingFundsMap = new Map();
    try {
      const placeholders = selectedCodes.map(() => '?').join(',');
      const existingRows = await db.prepare(
        `SELECT code, runtime_json FROM latest_fund_runtime WHERE code IN (${placeholders})`
      ).bind(...selectedCodes).all();
      for (const row of existingRows?.results || []) {
        try { existingFundsMap.set(row.code, JSON.parse(row.runtime_json)); } catch { /* ignore */ }
      }
    } catch (e) {
      console.warn('[SyncEngine] failed to load existing fund data:', e.message);
    }

    // 逐个同步（净值接口串行，避免限流）
    const funds = [];
    for (const code of selectedCodes) {
      const config = FUND_CATALOG[code];
      const fundData = await syncSingleFund(code, config, fundQuotesMap, usQuotesMap, fxRate, futuresMap, existingFundsMap.get(code) || null);
      if (fundData) funds.push(fundData);
      await new Promise(r => setTimeout(r, 100));
    }

    if (!funds.length) throw new Error('No funds synced');

    const syncedAt = new Date().toISOString();
    const nextIndex = (cursorStart + selectedCodes.length) % allCodes.length;
    const totalRow = await db.prepare('SELECT COUNT(*) as total FROM latest_fund_runtime').first();
    const currentTotal = Number(totalRow?.total || 0);
    const finalCount = Math.max(currentTotal, funds.length);
    const stmts = [
      db.prepare('INSERT INTO runtime_runs (synced_at, fund_count, source_url) VALUES (?, ?, ?)')
        .bind(syncedAt, finalCount, `sync-engine-auto-batch(${selectedCodes.length}/${allCodes.length})`),
      db.prepare(
        `INSERT INTO sync_engine_cursor (id, next_index, updated_at)
         VALUES (1, ?, ?)
         ON CONFLICT(id) DO UPDATE SET
           next_index = excluded.next_index,
           updated_at = excluded.updated_at`,
      ).bind(nextIndex, syncedAt),
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
    console.log(`[SyncEngine] Done: ${funds.length} funds in ${duration}ms, cursor=${nextIndex}`);
    return {
      ok: true,
      skipped: false,
      syncedAt,
      fundCount: finalCount,
      syncedBatchCount: funds.length,
      selectedBatchCount: selectedCodes.length,
      catalogCount: allCodes.length,
      nextCursor: nextIndex,
      duration,
      funds: funds.map(f => f.code),
    };
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
  const row = await db.prepare('SELECT code, synced_at, runtime_json FROM latest_fund_runtime WHERE code = ?').bind(code).first();
  if (!row) return null;
  try {
    const fund = JSON.parse(row.runtime_json);
    fund.syncedAt = row.synced_at;
    return fund;
  } catch { return null; }
}
