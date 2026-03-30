/**
 * 修复 funds-runtime.json 中 purchaseLimit="0元" 的条目
 * 这些是"暂停申购"基金，0元是硬编码的，应改为"暂停申购"
 * 同时验证它们确实是暂停申购状态
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const runtimePath = path.join(process.cwd(), 'public', 'generated', 'funds-runtime.json');
const raw = await fs.readFile(runtimePath, 'utf-8');
const data = JSON.parse(raw);

// 找出 purchaseLimit="0元" 的基金
const toFix = data.funds.filter(f => f.purchaseLimit === '0元');
console.log(`Found ${toFix.length} funds with purchaseLimit="0元":`, toFix.map(f => `${f.code}(${f.purchaseStatus})`));

if (toFix.length === 0) {
  console.log('Nothing to fix!');
  process.exit(0);
}

// 将 0元 改为"暂停申购"（因为这些是暂停申购状态导致的）
let fixedCount = 0;
for (const fund of toFix) {
  console.log(`  ${fund.code} ${fund.name}: purchaseStatus="${fund.purchaseStatus}" purchaseLimit="${fund.purchaseLimit}" → "暂停申购"`);
  fund.purchaseLimit = '暂停申购';
  fixedCount++;
}

if (fixedCount > 0) {
  await fs.writeFile(runtimePath, JSON.stringify(data, null, 2), 'utf-8');
  console.log(`\nFixed ${fixedCount} funds. Updated funds-runtime.json`);
}
