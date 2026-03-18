import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const runtimePath = path.join(projectRoot, 'public', 'generated', 'funds-runtime.json');
const outputPath = path.join(projectRoot, 'public', 'generated', 'premium-compare.json');
const historyPath = path.join(projectRoot, '.cache', 'fund-sync', 'premium-compare-history.json');

const HISTORY_KEEP_DAYS = 90;

function toDateTimeLabel(date, time) {
  const left = String(date || '').trim();
  const right = String(time || '').trim();
  return `${left} ${right}`.trim();
}

function parsePremiumFromText(text) {
  const input = String(text || '');
  const hit = input.match(/(?:溢价率|折溢价率|premium[^\d-]*)\s*[:：]?\s*(-?\d+(?:\.\d+)?)\s*%/i);
  if (!hit) {
    return Number.NaN;
  }
  const value = Number(hit[1]);
  return Number.isFinite(value) ? value / 100 : Number.NaN;
}

async function safeFetchText(url, referer = '') {
  const response = await fetch(url, {
    headers: {
      'user-agent': 'Mozilla/5.0',
      ...(referer ? { referer } : {}),
    },
  });

  if (!response.ok) {
    throw new Error(`http-${response.status}`);
  }

  return response.text();
}

function getSecidByCode(code) {
  return code.startsWith('5') ? `1.${code}` : `0.${code}`;
}

function parseFundGzJsonp(rawText) {
  const text = String(rawText || '').trim();
  const matched = text.match(/^jsonpgz\((\{.*\})\);?$/);
  if (!matched) {
    return null;
  }

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
      return {
        provider: 'eastmoney-fundgz',
        sourceUrl: apiUrl,
        status: 'gsz-unavailable',
        premiumRate: null,
      };
    }

    return {
      provider: 'eastmoney-fundgz',
      sourceUrl: apiUrl,
      status: 'ok',
      premiumRate: marketPrice / estimatedNav - 1,
    };
  } catch (error) {
    return {
      provider: 'eastmoney-fundgz',
      sourceUrl: apiUrl,
      status: error instanceof Error ? error.message : 'request-failed',
      premiumRate: null,
    };
  }
}

async function fetchFromEtfpro(code) {
  const candidates = [
    `https://etfpro.cn/${code}`,
    `https://etfpro.cn/fund/${code}`,
    `https://etfpro.cn/?code=${code}`,
  ];

  for (const url of candidates) {
    try {
      const html = await safeFetchText(url, 'https://etfpro.cn/');
      const parsed = parsePremiumFromText(html);
      if (Number.isFinite(parsed)) {
        return {
          provider: 'etfpro',
          sourceUrl: url,
          status: 'ok',
          premiumRate: parsed,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    provider: 'etfpro',
    sourceUrl: 'https://etfpro.cn/',
    status: 'unavailable-or-blocked',
    premiumRate: null,
  };
}

async function fetchFromXueqiu(code) {
  const symbols = [`SZ${code}`, `SH${code}`];
  for (const symbol of symbols) {
    const url = `https://xueqiu.com/S/${symbol}`;
    try {
      const html = await safeFetchText(url, 'https://xueqiu.com/');
      const parsed = parsePremiumFromText(html);
      if (Number.isFinite(parsed)) {
        return {
          provider: 'xueqiu',
          sourceUrl: url,
          status: 'ok',
          premiumRate: parsed,
        };
      }
    } catch {
      continue;
    }
  }

  return {
    provider: 'xueqiu',
    sourceUrl: 'https://xueqiu.com/',
    status: 'unavailable-or-blocked',
    premiumRate: null,
  };
}

async function fetchFromSina(code) {
  const symbol = code.startsWith('5') ? `sh${code}` : `sz${code}`;
  const url = `https://hq.sinajs.cn/list=${symbol}`;
  try {
    const raw = await safeFetchText(url, 'https://finance.sina.com.cn/');
    const parsed = parsePremiumFromText(raw);
    if (Number.isFinite(parsed)) {
      return {
        provider: 'sina',
        sourceUrl: url,
        status: 'ok',
        premiumRate: parsed,
      };
    }

    return {
      provider: 'sina',
      sourceUrl: url,
      status: 'no-premium-field',
      premiumRate: null,
    };
  } catch {
    return {
      provider: 'sina',
      sourceUrl: url,
      status: 'unavailable-or-blocked',
      premiumRate: null,
    };
  }
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function sanitizeHistory(history) {
  const cutoff = new Date();
  cutoff.setDate(cutoff.getDate() - HISTORY_KEEP_DAYS);
  const cutoffDate = cutoff.toISOString().slice(0, 10);

  return Object.fromEntries(
    Object.entries(history || {}).map(([code, providerMap]) => [
      code,
      Object.fromEntries(
        Object.entries(providerMap || {}).map(([provider, rows]) => [
          provider,
          (Array.isArray(rows) ? rows : [])
            .filter((item) => String(item?.date || '') >= cutoffDate && Number.isFinite(item?.providerPremiumRate))
            .slice(-240),
        ]),
      ),
    ]),
  );
}

async function main() {
  const runtime = await readJson(runtimePath, { funds: [], syncedAt: '' });
  const historyRaw = await readJson(historyPath, {});
  const history = sanitizeHistory(historyRaw);
  const fundByCode = new Map((runtime.funds || []).map((item) => [item.code, item]));
  const stateByCode = runtime?.stateByCode && typeof runtime.stateByCode === 'object' ? runtime.stateByCode : {};

  const codes = [...new Set((runtime.funds || []).map((item) => String(item?.code || '')).filter(Boolean))];
  const outputByCode = {};

  for (const code of codes) {
    const fund = fundByCode.get(code);
    const marketPrice = Number(fund?.marketPrice);
    const officialNav = Number(fund?.officialNavT1);
    const ourPremiumRate = marketPrice > 0 && officialNav > 0 ? marketPrice / officialNav - 1 : Number.NaN;
    const marketDate = String(fund?.marketDate || fund?.navDate || '');
    const marketTime = String(fund?.marketTime || '');

    const providers = await Promise.all([
      fetchFromEastmoneyFundgz(code, marketPrice),
      fetchFromEtfpro(code),
      fetchFromXueqiu(code),
      fetchFromSina(code),
    ]);

    for (const provider of providers) {
      if (!Number.isFinite(provider.premiumRate)) {
        continue;
      }
      if (!Number.isFinite(ourPremiumRate) || !marketDate) {
        continue;
      }

      if (!history[code]) {
        history[code] = {};
      }
      if (!history[code][provider.provider]) {
        history[code][provider.provider] = [];
      }

      history[code][provider.provider].push({
        date: marketDate,
        time: marketTime,
        marketPrice,
        ourPremiumRate,
        providerPremiumRate: provider.premiumRate,
      });
    }

    // 用最新的结算真实净值来验证当前所有来源（包括第三方和本站）的溢价率误差
    const allErrors = stateByCode?.[code]?.journal?.errors ?? [];
    const latestError = allErrors.length > 0 ? allErrors[allErrors.length - 1] : null;
    
    if (!latestError) {
      continue;  // 没有可用的真实净值参考
    }

    const latestMarketPrice = Number(latestError?.marketPrice);
    const latestEstimatedNav = Number(latestError?.estimatedNav);
    const latestActualNav = Number(latestError?.actualNav);
    
    if (!Number.isFinite(latestMarketPrice) || !Number.isFinite(latestActualNav) || latestActualNav <= 0) {
      continue;
    }

    const latestActualPremium = latestMarketPrice / latestActualNav - 1;
    
    // 本站在该日期的溢价率报价和误差
    let ourReportedPremium = Number.NaN;
    if (Number.isFinite(latestEstimatedNav) && latestEstimatedNav > 0) {
      ourReportedPremium = latestMarketPrice / latestEstimatedNav - 1;
    }
    const ourPremiumError = Number.isFinite(ourReportedPremium) ? ourReportedPremium - latestActualPremium : Number.NaN;

    // 第三方溢价率（用最新采集的）与真实净值的对比
    const providerStats = [];
    
    for (const provider of providers) {
      if (!Number.isFinite(provider.premiumRate)) {
        continue;
      }

      // 平台的溢价率误差 = 平台报的溢价率 - 真实溢价率
      const providerPremiumError = provider.premiumRate - latestActualPremium;
      
      // 与本站的差距
      const delta = Number.isFinite(ourPremiumError) ? providerPremiumError - ourPremiumError : Number.NaN;

      providerStats.push({
        provider: provider.provider,
        sourceUrl: provider.sourceUrl,
        status: provider.status,
        avgAbsProviderError30: Math.abs(providerPremiumError),
        avgAbsOurError30: Number.isFinite(ourPremiumError) ? Math.abs(ourPremiumError) : null,
        avgAbsDelta30: Number.isFinite(delta) ? Math.abs(delta) : null,
        sampleCount30: 1,  // 单点对比
      });
    }

    outputByCode[code] = {
      code,
      name: String(fund?.name || code),
      snapshotAt: toDateTimeLabel(marketDate, marketTime),
      ourPremiumRate: Number.isFinite(ourPremiumRate) ? ourPremiumRate : null,
      providers: providerStats,
    };
  }

  const sanitized = sanitizeHistory(history);
  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(historyPath, `${JSON.stringify(sanitized, null, 2)}\n`, 'utf8');
  await fs.writeFile(outputPath, `${JSON.stringify({ generatedAt: new Date().toISOString(), syncedAt: runtime.syncedAt || '', codes: outputByCode }, null, 2)}\n`, 'utf8');

  console.log(`[sync:premium-compare] generated ${outputPath}`);
}

main().catch((error) => {
  console.error(`[sync:premium-compare] failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
