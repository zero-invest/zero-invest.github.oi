import fs from 'node:fs/promises';
import path from 'node:path';

const runtimePath = path.join(process.cwd(), 'public', 'generated', 'funds-runtime.json');
const raw = await fs.readFile(runtimePath, 'utf-8');
const data = JSON.parse(raw);
const funds = data.funds;

console.log('=== 基金数据质量检查 ===');
console.log('总基金数:', funds.length);

// 检查限购金额
const limited = funds.filter(f => f.purchaseLimit && f.purchaseLimit !== '');
console.log('\n有限购金额的基金:', limited.length);
limited.forEach(f => console.log(`  ${f.code} ${f.purchaseLimit}`));

// 检查"限购"字样
const rawLimited = funds.filter(f => f.purchaseLimit === '限购');
console.log('\npurchaseLimit="限购"（未解析金额）:', rawLimited.length);

// 检查净值数据
const noNav = funds.filter(f => !f.officialNavT1 || f.officialNavT1 === 0);
console.log('\n净值为空/0:', noNav.length, noNav.map(f => f.code + ' navDate:' + f.navDate));

// 检查净值日期分布
const dateCounts = {};
funds.forEach(f => {
  const d = f.navDate || 'null';
  dateCounts[d] = (dateCounts[d] || 0) + 1;
});
console.log('\n净值日期分布:');
Object.entries(dateCounts).sort().forEach(([d, c]) => console.log(`  ${d}: ${c}个基金`));

// 检查买入状态
const buyStatuses = {};
funds.forEach(f => {
  const s = f.buyStatus || 'null';
  buyStatuses[s] = (buyStatuses[s] || 0) + 1;
});
console.log('\n买入状态分布:');
Object.entries(buyStatuses).forEach(([s, c]) => console.log(`  ${s}: ${c}个`));
