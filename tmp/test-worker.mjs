import https from 'node:https';

function fetchUrl(url) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: { 'user-agent': 'Mozilla/5.0' }
    }, (res) => {
      let d = '';
      res.on('data', c => d += c);
      res.on('end', () => resolve(d));
    });
    req.on('error', reject);
    req.end();
  });
}

async function main() {
  console.log('Fetching Worker API...');
  const raw = await fetchUrl('https://lof-premium-rate-web-api.987144016.workers.dev/api/runtime/all');
  console.log('Response length:', raw.length);
  try {
    const j = JSON.parse(raw);
    console.log('ok:', j.ok, 'syncedAt:', j.syncedAt);
    const fund = j.funds && j.funds.find(f => f.code === '160216');
    if (fund) {
      console.log('160216:', JSON.stringify({
        officialNavT1: fund.officialNavT1,
        navDate: fund.navDate,
        marketPrice: fund.marketPrice,
        purchaseLimit: fund.purchaseLimit
      }));
    } else {
      console.log('160216 NOT FOUND');
    }
  } catch(e) {
    console.log('parse error:', e.message);
    console.log('first 300:', raw.slice(0, 300));
  }
}

main().catch(console.error);
