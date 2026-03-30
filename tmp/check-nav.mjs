import fs from 'node:fs';

const data = JSON.parse(fs.readFileSync('public/generated/funds-runtime.json', 'utf-8'));
const zeroNavFunds = data.funds.filter(f => !f.officialNavT1 || f.officialNavT1 === 0);
console.log('Zero nav funds:', zeroNavFunds.map(f => ({code: f.code, nav: f.officialNavT1, navDate: f.navDate})));
console.log('Total zero nav:', zeroNavFunds.length);
console.log('Total funds:', data.funds.length);

// Check for stale nav dates
const staleNavFunds = data.funds.filter(f => f.navDate && f.navDate < '2026-03-25');
console.log('\nStale nav funds (before 2026-03-25):', staleNavFunds.map(f => ({code: f.code, nav: f.officialNavT1, navDate: f.navDate})));

// Check estimate values
const zeroEstimate = data.funds.filter(f => !f.marketPrice || f.marketPrice === 0);
console.log('\nZero market price funds:', zeroEstimate.length);
