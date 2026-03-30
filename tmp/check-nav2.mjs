import fs from 'node:fs/promises';
const d = JSON.parse(await fs.readFile('public/generated/funds-runtime.json', 'utf-8'));

// 只看 0元 的情况
const zeroLimited = d.funds.filter(f => f.purchaseLimit === '0元');
console.log('purchaseLimit=0元 的基金:', zeroLimited.length);
zeroLimited.forEach(f => console.log(`  ${f.code}: purchaseStatus="${f.purchaseStatus}" purchaseLimit="${f.purchaseLimit}"`));

// 暂停申购的
const suspended = d.funds.filter(f => f.purchaseLimit === '暂停申购');
console.log('\npurchaseLimit=暂停申购 的基金:', suspended.length);
suspended.forEach(f => console.log(`  ${f.code}: purchaseStatus="${f.purchaseStatus}"`));

// 净值日期
const dateCounts = {};
d.funds.forEach(f => { const dt = f.navDate||'null'; dateCounts[dt]=(dateCounts[dt]||0)+1; });
console.log('\n净值日期分布:');
Object.entries(dateCounts).sort().forEach(([d2,c]) => console.log(`  ${d2}: ${c}个`));

// 看看哪些净值日期还是 2026-03-26
const old26 = d.funds.filter(f=>f.navDate==='2026-03-26').slice(0,5);
console.log('\n净值为2026-03-26的前5个(QDII?):', old26.map(f=>`${f.code} ${f.fundType||''}`));
