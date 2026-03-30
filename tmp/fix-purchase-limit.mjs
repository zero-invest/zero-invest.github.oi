/**
 * 修复 funds-runtime.json 中 purchaseLimit = "限购" 的条目
 * 通过天天基金 MINDT 字段获取实际限额金额
 */
import fs from 'node:fs/promises';
import https from 'node:https';
import path from 'node:path';

const runtimePath = path.join(process.cwd(), 'public', 'generated', 'funds-runtime.json');
const dailyCacheDir = path.join(process.cwd(), '.cache', 'fund-sync', 'daily');

function fetchUrl(url, referer) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'user-agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        'referer': referer || 'https://fund.eastmoney.com/',
      }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.setTimeout(10000, () => { req.destroy(); reject(new Error('timeout')); });
    req.on('error', reject);
    req.end();
  });
}

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

async function fetchMindtForCode(code) {
  try {
    const url = `https://api.fund.eastmoney.com/Fund/GetSingleFundInfo?callback=x&fcode=${code}&fileds=FCODE,ISBUY,ISSALES,MINDT`;
    const raw = await fetchUrl(url, `https://fund.eastmoney.com/${code}.html`);
    const m = raw.match(/x\((\{[\s\S]*?\})\)/);
    if (!m) return null;
    const data = JSON.parse(m[1])?.Data;
    const isbuy = String(data?.ISBUY ?? '').trim();
    const mindtVal = data?.MINDT;
    return { isbuy, mindtLimit: formatMindtLimit(mindtVal) };
  } catch (e) {
    console.warn(`[mindt] ${code}: ${e.message}`);
    return null;
  }
}

async function main() {
  const raw = await fs.readFile(runtimePath, 'utf-8');
  const data = JSON.parse(raw);
  
  // 找出所有 purchaseLimit = "限购" 的基金
  const toFix = data.funds.filter(f => f.purchaseLimit === '限购');
  console.log(`Found ${toFix.length} funds with purchaseLimit="限购":`, toFix.map(f => f.code));
  
  if (toFix.length === 0) {
    console.log('Nothing to fix!');
    return;
  }
  
  let fixedCount = 0;
  for (const fund of toFix) {
    console.log(`Fetching MINDT for ${fund.code}...`);
    const result = await fetchMindtForCode(fund.code);
    if (result && result.mindtLimit) {
      console.log(`  ${fund.code}: ISBUY=${result.isbuy}, MINDT → "${result.mindtLimit}"`);
      fund.purchaseLimit = result.mindtLimit;
      
      // 同步更新日缓存
      const cachePath = path.join(dailyCacheDir, `${fund.code}.json`);
      try {
        const cacheRaw = await fs.readFile(cachePath, 'utf-8');
        const cacheData = JSON.parse(cacheRaw);
        cacheData.purchaseLimit = result.mindtLimit;
        await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
      } catch { /* cache may not exist */ }
      
      fixedCount++;
    } else {
      console.log(`  ${fund.code}: could not get MINDT (keeping "限购")`);
    }
    // 小延迟避免频率限制
    await new Promise(r => setTimeout(r, 300));
  }
  
  if (fixedCount > 0) {
    await fs.writeFile(runtimePath, JSON.stringify(data, null, 2), 'utf-8');
    console.log(`\nFixed ${fixedCount} funds. Updated funds-runtime.json`);
  }
}

main().catch(console.error);
