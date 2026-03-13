import {
  normalizeNoticeTextLines,
  parseCnReportDate,
  parseNumber,
  resolveSupplementalHolding,
} from './shared.mjs';

export const parserId = 'section-5-9-rows';

export function parseNoticeHoldingsBySection59Rows({ noticeTitle, noticeContent, aliases, quoteByTicker }) {
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

  for (let index = 0; index < block.length; index += 1) {
    const line = block[index];
    if (!line || /^公允价值|^序号|^（%）|^注[:：]/.test(line)) {
      continue;
    }

    const rankMatch = line.match(/^(\d{1,2})\s+(.+)$/);
    if (!rankMatch) {
      continue;
    }

    const rankText = rankMatch[1];
    const rowParts = [rankMatch[2]];

    while (index + 1 < block.length && !/^\d{1,2}\s+/.test(block[index + 1]) && !/^注[:：]/.test(block[index + 1])) {
      rowParts.push(block[index + 1]);
      index += 1;
    }

    const rowText = rowParts.join(' ').replace(/\s+/g, ' ').trim();
    const rowMatch = rowText.match(/^(.*)\s+([\d,]+(?:\.\d+)?)\s+(\d+(?:\.\d+)?)(?:\s*%?)?$/);
    if (!rowMatch) {
      continue;
    }

    const [, rawName, marketValueText, weightText] = rowMatch;
    const resolved = resolveSupplementalHolding(rawName, aliases);
    const ticker = resolved?.ticker ?? `UNMAPPED_${rankText}`;
    const name = resolved?.name ?? rawName;
    const quote = resolved ? quoteByTicker.get(resolved.ticker.toUpperCase()) : undefined;
    holdings.push({
      rank: Number(rankText),
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
    disclosedHoldings: holdings.sort((left, right) => left.rank - right.rank).slice(0, 10).map(({ rank, ...item }) => item),
  };
}