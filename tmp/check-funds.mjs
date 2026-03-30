import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('public/generated/funds-runtime.json', 'utf-8'));
const codes = ['160216', '160644', '161124', '161126', '161127', '161128'];

for (const code of codes) {
  const fund = data.funds.find(f => f.code === code);
  if (!fund) {
    console.log(`${code}: NOT FOUND`);
    continue;
  }
  console.log(`${code}: officialNavT1=${fund.officialNavT1}, navDate=${fund.navDate}, marketPrice=${fund.marketPrice}, purchaseLimit=${fund.purchaseLimit}`);
  // Check disclosedHoldings
  const holdings = fund.disclosedHoldings || [];
  const withPrice = holdings.filter(h => h.currentPrice > 0);
  console.log(`  Holdings: total=${holdings.length}, with price=${withPrice.length}`);
}
