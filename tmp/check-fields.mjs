import fs from 'node:fs/promises';
const d = JSON.parse(await fs.readFile('public/generated/funds-runtime.json', 'utf-8'));
const f = d.funds[0];
console.log('第一个基金字段列表:', Object.keys(f).join(', '));
console.log('buyStatus:', f.buyStatus);
console.log('redeemStatus:', f.redeemStatus);
console.log('purchaseLimit:', f.purchaseLimit);

// 检查有0元的基金
const zeroLimited = d.funds.filter(x => x.purchaseLimit === '0元');
console.log('\npurchaseLimit=0元 的基金:', zeroLimited.length, zeroLimited.map(x=>x.code));

// 检查净值最新日期
const latest = d.funds.filter(x => x.navDate === '2026-03-27');
console.log('\n净值为2026-03-27的基金数:', latest.length);
const older = d.funds.filter(x => x.navDate <= '2026-03-26');
console.log('净值为2026-03-26或更旧:', older.length, older.map(x=>x.code+':'+x.navDate));
