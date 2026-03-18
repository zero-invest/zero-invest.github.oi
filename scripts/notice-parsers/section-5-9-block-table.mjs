import {
  normalizeNoticeTextLines,
  parseCnReportDate,
  parseNumber,
  resolveSupplementalHolding,
} from './shared.mjs';

export function parseNoticeHoldingsBySection59BlockTable({ noticeTitle, noticeContent, aliases, quoteByTicker }) {
  const sectionMatch = String(noticeContent || '').match(/5\.9\b([\s\S]*?)5\.10\b/);
  if (!sectionMatch) {
    return {
      disclosedHoldingsTitle: '',
      disclosedHoldingsReportDate: '',
      disclosedHoldings: [],
    };
  }

  const lines = normalizeNoticeTextLines(sectionMatch[1]);
  const holdings = [];

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (!/^\d{1,2}$/.test(line)) {
      continue;
    }

    const rank = Number(line);
    const rowParts = [];
    let marketValueText = '';
    let weightText = '';

    for (let cursor = index + 1; cursor < lines.length; cursor += 1) {
      const current = lines[cursor];

      if (/^\d{1,2}$/.test(current)) {
        index = cursor - 1;
        break;
      }

      if (/^(序号|基金名称|基金类型|运作方式|管理人|公允价值|占基金资产|净值比例|（%）)/.test(current)) {
        continue;
      }

      const spacedNumberMatch = current.match(/([\d,]+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)/);
      const compactNumberMatch = current.match(/([\d,]+\.\d{2})(\d+\.\d+)$/);
      const numberMatch = spacedNumberMatch || compactNumberMatch;
      if (numberMatch) {
        marketValueText = numberMatch[1];
        weightText = numberMatch[2];
        index = cursor;
        break;
      }

      rowParts.push(current);
      index = cursor;
    }

    if (!marketValueText || !weightText) {
      continue;
    }

    const rawNameCandidate = rowParts.join(' ').replace(/\s+/g, ' ').trim();
    const rawName = rawNameCandidate
      .split(/(?:指数型|股票型|债券型|混合型|交易型|开放式|资产管理|有限公司|基金管理人)/)[0]
      .trim();
    const resolved = resolveSupplementalHolding(rawName, aliases);
    const ticker = resolved?.ticker ?? `UNMAPPED_${rank}`;
    const name = resolved?.name ?? rawName;
    const quote = resolved ? quoteByTicker.get(resolved.ticker.toUpperCase()) : undefined;

    holdings.push({
      rank,
      ticker,
      name,
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
    disclosedHoldings: holdings
      .sort((left, right) => left.rank - right.rank)
      .slice(0, 10)
      .map(({ rank, ...item }) => item),
  };
}
