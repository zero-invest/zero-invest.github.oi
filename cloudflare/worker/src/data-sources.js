/**
 * Cloudflare Worker 数据源模块
 * 提供与本地脚本相同的数据源访问能力
 */

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

/**
 * 带超时的 fetch 封装
 */
export async function fetchWithTimeout(url, options = {}) {
  const { timeout = 10000, ...fetchOptions } = options;
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeout);
  
  try {
    const response = await fetch(url, {
      ...fetchOptions,
      signal: controller.signal,
      headers: {
        'User-Agent': UA,
        ...fetchOptions.headers,
      },
    });
    return response;
  } finally {
    clearTimeout(timeoutId);
  }
}

/**
 * 天天基金网 - 获取基金实时净值估算
 */
export async function fetchEstimatedNav(code) {
  try {
    const url = `http://fundgz.1234567.com.cn/js/${code}.js?rt=${Date.now()}`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: 'http://fund.eastmoney.com/',
        'User-Agent': UA,
      },
      timeout: 8000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const text = await res.text();
    const m = text.match(/jsonpgz\((\{.*\})\)/);
    if (!m) throw new Error('invalid jsonp');
    
    const data = JSON.parse(m[1]);
    const gsz = parseFloat(data.gsz || 0);
    const dwjz = parseFloat(data.dwjz || 0);
    const gszzl = parseFloat(data.gszzl || 0);
    
    return {
      code: data.fundcode,
      estimatedNav: gsz,
      officialNavT1FromGz: dwjz,
      estimatedNavChangeRate: gszzl / 100 || 0,
      navDateFromGz: data.gztime ? data.gztime.split(' ')[0] : '',
    };
  } catch (e) {
    console.warn(`[eastmoney-gz] ${code}: ${e.message}`);
    return null;
  }
}

/**
 * 天天基金网 - 获取基金官方净值
 */
export async function fetchOfficialNav(code) {
  try {
    const url = `https://fund.eastmoney.com/${code}.html`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: 'https://fund.eastmoney.com/',
        'User-Agent': UA,
      },
      timeout: 10000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const html = await res.text();
    
    // 解析官方净值（昨收）
    const navMatch = html.match(/unitNetValue[^>]*>\s*([\d.]+)/);
    const navDateMatch = html.match(/净值日期[^>]*>\s*(\d{4}-\d{2}-\d{2})/);
    
    return {
      code,
      officialNavT1: navMatch ? parseFloat(navMatch[1]) : 0,
      navDate: navDateMatch ? navDateMatch[1] : '',
    };
  } catch (e) {
    console.warn(`[eastmoney-nav] ${code}: ${e.message}`);
    return null;
  }
}

/**
 * 天天基金网 - 获取基金限购状态
 */
export async function fetchPurchaseStatus(code) {
  try {
    const url = `https://api.fund.eastmoney.com/Fund/GetSingleFundInfo?callback=x&fcode=${code}&fileds=FCODE,ISBUY,ISSALES,MINDT,DTZT,SHORTNAME`;
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: `https://fund.eastmoney.com/${code}.html`,
        'User-Agent': UA,
      },
      timeout: 8000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const text = await res.text();
    const m = text.match(/x\((\{.*\})\)/s);
    if (!m) throw new Error('no callback');
    
    const data = JSON.parse(m[1])?.Data;
    const isbuy = String(data?.ISBUY ?? '').trim();
    const issales = String(data?.ISSALES ?? '').trim();
    
    // ISBUY 映射：4=限大额，1/2/3/8/9=开放申购，其他=暂停申购
    const buyStatus = isbuy === '4' ? '限大额' : ['1','2','3','8','9'].includes(isbuy) ? '开放申购' : isbuy ? '暂停申购' : '';
    const redeemStatus = issales === '1' ? '开放赎回' : issales ? '暂停赎回' : '';
    
    if (!buyStatus && !redeemStatus) {
      console.warn(`[purchase] ${code}: API returned empty status (ISBUY=${isbuy}, ISSALES=${issales})`);
    }
    
    return { buyStatus, redeemStatus };
  } catch (e) {
    console.warn(`[purchase] ${code}: ${e.message}`);
    return { buyStatus: '', redeemStatus: '' };
  }
}

/**
 * 新浪财经 - 获取 LOF 基金实时行情
 */
export async function fetchFundQuote(code) {
  try {
    const sinaCode = code.startsWith('5') ? `sh${code}` : `sz${code}`;
    const url = `https://hq.sinajs.cn/list=${sinaCode}`;
    
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': UA,
      },
      timeout: 8000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const text = await res.text();
    const m = text.match(/="([^"]+)"/);
    if (!m) throw new Error('invalid response');
    
    const parts = m[1].split(',');
    if (parts.length < 5) throw new Error('incomplete data');
    
    const [name, currentPrice, open, previousClose, high, low] = parts;
    
    return {
      code,
      name: name || code,
      marketPrice: parseFloat(currentPrice) || 0,
      open: parseFloat(open) || 0,
      previousClose: parseFloat(previousClose) || 0,
      high: parseFloat(high) || 0,
      low: parseFloat(low) || 0,
    };
  } catch (e) {
    console.warn(`[sina-fund] ${code}: ${e.message}`);
    return null;
  }
}

/**
 * 新浪财经 - 批量获取美股 ETF 行情
 */
export async function fetchUSQuotes(tickers) {
  const result = new Map();
  if (tickers.length === 0) return result;
  
  try {
    // 美股代码前缀：gb_
    const symbols = tickers.map(t => `gb_${t.toLowerCase()}`).join(',');
    const url = `https://hq.sinajs.cn/list=${symbols}`;
    
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': UA,
      },
      timeout: 15000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const text = await res.text();
    for (const line of text.split(';')) {
      const m = line.match(/hq_str_gb_([a-z\d]+)="([^"]+)"/);
      if (!m) continue;
      
      const ticker = m[1].toUpperCase();
      const parts = m[2].split(',');
      
      // 美股格式：[0] 名称 [1] 当前价 [2] 昨收 [3] 开盘 [4] 最高 [5] 最低
      const currentPrice = parseFloat(parts[1]) || 0;
      const previousClose = parseFloat(parts[2]) || 0;
      const changeRate = previousClose > 0 ? currentPrice / previousClose - 1 : 0;
      
      result.set(ticker, {
        ticker,
        currentPrice,
        previousClose,
        changeRate,
      });
    }
  } catch (e) {
    console.warn(`[sina-us] batch failed: ${e.message}`);
  }
  
  return result;
}

/**
 * 腾讯财经 - 获取 USD/CNY 汇率
 */
export async function fetchUsdCny() {
  try {
    const url = 'https://qt.gtimg.cn/q=USDCNY';
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: 'https://gu.qq.com/',
        'User-Agent': UA,
      },
      timeout: 8000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const text = await res.text();
    const m = text.match(/="[^"]*~([\d.]+)~/);
    if (!m) throw new Error('invalid response');
    
    return parseFloat(m[1]) || 7.25;
  } catch (e) {
    console.warn(`[tencent-fx] ${e.message}`);
    return 7.25;
  }
}

/**
 * 新浪财经 - 获取商品期货行情（白银、黄金、原油等）
 */
export async function fetchCommodityFutures(futuresCodes) {
  const result = new Map();
  if (futuresCodes.length === 0) return result;
  
  try {
    const symbols = futuresCodes.join(',');
    const url = `https://hq.sinajs.cn/list=${symbols}`;
    
    const res = await fetchWithTimeout(url, {
      headers: {
        Referer: 'https://finance.sina.com.cn/',
        'User-Agent': UA,
      },
      timeout: 10000,
    });
    
    if (!res.ok) throw new Error(`status ${res.status}`);
    
    const text = await res.text();
    for (const line of text.split(';')) {
      const m = line.match(/hq_str_([a-z\d]+)="([^"]+)"/);
      if (!m) continue;
      
      const code = m[1];
      const parts = m[2].split(',');
      
      // 期货格式：[0] 名称 [1] 当前价 [2] 昨收
      const currentPrice = parseFloat(parts[1]) || 0;
      const previousClose = parseFloat(parts[2]) || 0;
      const changeRate = previousClose > 0 ? currentPrice / previousClose - 1 : 0;
      
      result.set(code, {
        code,
        currentPrice,
        previousClose,
        changeRate,
      });
    }
  } catch (e) {
    console.warn(`[sina-futures] batch failed: ${e.message}`);
  }
  
  return result;
}
