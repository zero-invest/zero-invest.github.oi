import fs from 'node:fs/promises';
const d = JSON.parse(await fs.readFile('.cache/fund-sync/daily/161226.json', 'utf-8'));
console.log('purchaseStatus:', d.purchaseStatus);
console.log('purchaseLimit:', d.purchaseLimit);
console.log('cacheVersion:', d.cacheVersion);
console.log('fetchedDate:', d.fetchedDate);
