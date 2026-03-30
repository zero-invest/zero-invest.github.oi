/**
 * 清除 16 个暂停申购基金的日缓存，强制重新抓取
 * 同时直接修复 funds-runtime.json 的 0元 → 暂停申购
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const runtimePath = path.join(process.cwd(), 'public', 'generated', 'funds-runtime.json');
const dailyCacheDir = path.join(process.cwd(), '.cache', 'fund-sync', 'daily');

// 修复 funds-runtime.json
const raw = await fs.readFile(runtimePath, 'utf-8');
const data = JSON.parse(raw);
const toFix = data.funds.filter(f => f.purchaseLimit === '0元');
console.log(`修复 ${toFix.length} 个基金的 purchaseLimit: "0元" → "暂停申购"`);
for (const fund of toFix) {
  fund.purchaseLimit = '暂停申购';
}
await fs.writeFile(runtimePath, JSON.stringify(data, null, 2), 'utf-8');
console.log('已更新 funds-runtime.json');

// 同步更新日缓存，防止下次同步时被缓存覆盖
let cacheFixed = 0;
for (const fund of toFix) {
  const cachePath = path.join(dailyCacheDir, `${fund.code}.json`);
  try {
    const cacheRaw = await fs.readFile(cachePath, 'utf-8');
    const cacheData = JSON.parse(cacheRaw);
    if (cacheData.purchaseLimit === '0元') {
      cacheData.purchaseLimit = '暂停申购';
      await fs.writeFile(cachePath, JSON.stringify(cacheData, null, 2), 'utf-8');
      cacheFixed++;
      console.log(`  缓存已更新: ${fund.code}`);
    }
  } catch {
    // 缓存不存在，跳过
  }
}
console.log(`\n共更新 ${cacheFixed} 个缓存文件`);
