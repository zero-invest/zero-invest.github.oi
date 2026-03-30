import https from 'node:https';

function fetchUrl(url, referer) {
  return new Promise((resolve, reject) => {
    const req = https.get(url, {
      headers: {
        'user-agent': 'Mozilla/5.0',
        'referer': referer || 'https://fund.eastmoney.com/',
      }
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
  const code = '160723';
  const raw = await fetchUrl(
    `https://api.fund.eastmoney.com/Fund/GetSingleFundInfo?callback=x&fcode=${code}&fileds=FCODE,ISBUY,ISSALES,MINDT,DTZT,SHORTNAME`,
    `https://fund.eastmoney.com/${code}.html`
  );
  console.log('raw first 800:', raw.slice(0, 800));
  
  // Test fundgz API
  const fundgz = await fetchUrl(
    `https://fundgz.1234567.com.cn/js/${code}.js`,
    `https://fund.eastmoney.com/${code}.html`
  );
  console.log('fundgz:', fundgz.slice(0, 400));
  
  // Test nav API
  const navRaw = await fetchUrl(
    `https://api.fund.eastmoney.com/f10/lsjz?callback=x&fundCode=${code}&pageIndex=1&pageSize=5&startDate=2026-03-01&endDate=2026-03-30`,
    'https://fundf10.eastmoney.com/'
  );
  console.log('nav api:', navRaw.slice(0, 400));
}

main().catch(console.error);
