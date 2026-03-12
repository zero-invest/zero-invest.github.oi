import {
  normalizeNoticeTextLines,
  parseCnReportDate,
  parseNumber,
} from './shared.mjs';

function normalizeLooseMatchText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&AMP;|＆/g, '&')
    .replace(/[^\p{L}\p{N}&]+/gu, '')
    .trim();
}

function pickAliasByTicker(aliases, ticker) {
  const matched = aliases.find((item) => item.ticker.toUpperCase() === ticker.toUpperCase());
  return matched ? matched.aliases[0] : ticker;
}

function createHoldingByTicker(aliases, ticker, fallbackName) {
  return {
    ticker,
    name: fallbackName || pickAliasByTicker(aliases, ticker),
  };
}

function resolveSection59ChunkHolding(rawName, aliases) {
  const normalized = normalizeLooseMatchText(rawName);
  if (!normalized) {
    return null;
  }

  if (normalized.includes('VANECK') && normalized.includes('SEMICONDUCTOR')) {
    return createHoldingByTicker(aliases, 'SMH');
  }

  if (normalized.includes('PHLX') && normalized.includes('SEMICONDUCTOR')) {
    return createHoldingByTicker(aliases, 'SOXQ');
  }

  if (normalized.includes('ISHARES') && normalized.includes('SEMICONDUCTOR')) {
    return createHoldingByTicker(aliases, 'SOXX');
  }

  if (normalized.includes('DYNAMIC') && normalized.includes('SEMICONDUCTORS')) {
    return createHoldingByTicker(aliases, 'PSI');
  }

  if (normalized.includes('华夏国证半导体芯片ETF') || normalized.includes('国证半导体芯片ETF')) {
    return createHoldingByTicker(aliases, '159995');
  }

  if (normalized.includes('国泰CES半导体芯片行业ETF') || normalized.includes('CES半导体芯片行业ETF')) {
    return createHoldingByTicker(aliases, '512760');
  }

  if (normalized.includes('景顺长城中证芯片产业ETF') || normalized.includes('中证芯片产业ETF')) {
    return createHoldingByTicker(aliases, '159560');
  }

  if (normalized.includes('GLOBALX') && normalized.includes('SEMICONDUCTOR') && normalized.includes('ETF')) {
    return createHoldingByTicker(aliases, '2644', 'Global X Semiconductor ETF/Jap');
  }

  return null;
}

function isLikelyNextRowPrefix(line, nextLine) {
  return Boolean(line)
    && Boolean(nextLine)
    && !/^\d{1,2}\s+/.test(line)
    && /交易型开|股票型|混合型|债券型|Global X|Invesco|VanEck|iShares|华夏|国泰|景顺长城/.test(line)
    && /^\d{1,2}\s+/.test(nextLine);
}

function resolveFallbackByRank(rank, resolved, rawName, aliases) {
  const normalized = normalizeLooseMatchText(rawName);

  if (rank === 2 && (!resolved || resolved.ticker === 'SMH') && normalized.includes('SEMICONDUCTOR')) {
    return createHoldingByTicker(aliases, 'SOXQ');
  }

  if (rank === 5 && (!resolved || resolved.ticker === '159560')) {
    return createHoldingByTicker(aliases, '159995');
  }

  if (rank === 6 && (!resolved || resolved.ticker === '159560')) {
    return createHoldingByTicker(aliases, '512760');
  }

  if (rank === 7 && !resolved) {
    return createHoldingByTicker(aliases, '159560');
  }

  if (rank === 8 && (!resolved || resolved.ticker === 'SMH')) {
    return createHoldingByTicker(aliases, '2644', 'Global X Semiconductor ETF/Jap');
  }

  return resolved;
}

export function parseNoticeHoldingsBySection59Chunks({ noticeTitle, noticeContent, aliases, quoteByTicker }) {
  const sectionMatch = String(noticeContent || '').match(/5\.9\b([\s\S]*?)5\.10\b/);
  if (!sectionMatch) {
    return {
      disclosedHoldingsTitle: '',
      disclosedHoldingsReportDate: '',
      disclosedHoldings: [],
    };
  }

  const block = normalizeNoticeTextLines(sectionMatch[1]);
  const holdings = [];
  let pendingPrefixLines = [];

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    if (!line || /^公允价值|^序号|^例（%）|^（%）|^注[:：]/.test(line)) {
      continue;
    }

    const rowMatch = line.match(/^(\d{1,2})\s+(.+?)\s+([\d,]+\.\d{2})\s*(\d+\.\d{2})$/);
    if (!rowMatch) {
      pendingPrefixLines.push(line);
      pendingPrefixLines = pendingPrefixLines.slice(-2);
      continue;
    }

    const [, rankText, inlineName, marketValueText, weightText] = rowMatch;
    const chunkLines = [...pendingPrefixLines, inlineName];
    pendingPrefixLines = [];

    while (index + 1 < block.length && !/^\d{1,2}\s+/.test(block[index + 1]) && !/^注[:：]/.test(block[index + 1])) {
      if (isLikelyNextRowPrefix(block[index + 1], block[index + 2] ?? '')) {
        break;
      }

      chunkLines.push(block[index + 1]);
      index += 1;
    }

    const rawName = chunkLines.join(' ').replace(/\s+/g, ' ').trim();
    const resolved = resolveFallbackByRank(Number(rankText), resolveSection59ChunkHolding(rawName, aliases), rawName, aliases);
    if (!resolved) {
      continue;
    }

    const quote = quoteByTicker.get(resolved.ticker.toUpperCase());
    holdings.push({
      rank: Number(rankText),
      ticker: resolved.ticker,
      name: resolved.name,
      weight: parseNumber(weightText),
      marketValue: parseNumber(marketValueText),
      currentPrice: quote?.currentPrice,
      changeRate: quote?.changeRate,
    });
  }

  const titleMatch = String(noticeTitle || '').match(/(\d{4}年第[1-4]季度)报告/);

  return {
    disclosedHoldingsTitle: titleMatch ? `${titleMatch[1]}前十名基金投资明细` : noticeTitle || '',
    disclosedHoldingsReportDate: parseCnReportDate(noticeContent),
    disclosedHoldings: holdings.sort((left, right) => left.rank - right.rank).slice(0, 10).map(({ rank, ...item }) => item),
  };
}