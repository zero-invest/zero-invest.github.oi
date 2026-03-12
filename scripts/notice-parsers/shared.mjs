function parseNumber(value) {
  const normalized = String(value || '').replace(/,/g, '').replace(/--/g, '').trim();
  const parsed = Number(normalized.replace(/%$/g, ''));
  return Number.isFinite(parsed) ? parsed : 0;
}

function normalizeNoticeTextLines(text) {
  return String(text || '')
    .replace(/(?=§\d)/g, '\n')
    .replace(/(?=5\.\d\b)/g, '\n')
    .replace(/([0-9])\s+(?=[0-9,.])/g, '$1')
    .replace(/([,.])\s+(?=[0-9])/g, '$1')
    .split(/\r?\n/)
    .map((line) => line.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

function normalizeAsciiWords(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&AMP;|＆/g, ' & ')
    .replace(/[^A-Z0-9&]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeLooseMatchText(value) {
  return String(value || '')
    .toUpperCase()
    .replace(/&AMP;|＆/g, '&')
    .replace(/[^\p{L}\p{N}&]+/gu, '')
    .trim();
}

function matchesAliasByWordOrder(rawName, alias) {
  const normalizedLooseAlias = normalizeLooseMatchText(alias);
  const normalizedLooseName = normalizeLooseMatchText(rawName);
  if (/[^\x00-\x7F]/.test(alias)) {
    return Boolean(normalizedLooseAlias) && normalizedLooseName.includes(normalizedLooseAlias);
  }

  const normalizedName = normalizeAsciiWords(rawName);
  const words = normalizeAsciiWords(alias).split(' ').filter(Boolean);
  if (!normalizedName || !words.length) {
    return false;
  }

  let cursor = 0;
  for (const word of words) {
    const index = normalizedName.indexOf(word, cursor);
    if (index < 0) {
      return false;
    }

    cursor = index + word.length;
  }

  return true;
}

function resolveSupplementalHolding(rawName, candidates) {
  const matched = candidates
    .flatMap((candidate) => candidate.aliases.map((alias) => ({ candidate, alias })))
    .filter((entry) => matchesAliasByWordOrder(rawName, entry.alias))
    .sort((left, right) => right.alias.length - left.alias.length)[0];

  return matched
    ? {
        ticker: matched.candidate.ticker,
        name: matched.alias,
      }
    : null;
}

function parseCnReportDate(text) {
  const match = String(text || '').match(/(\d{4})\s*年\s*(\d{1,2})\s*月\s*(\d{1,2})\s*日/);
  if (!match) {
    return '';
  }

  return `${match[1]}-${String(match[2]).padStart(2, '0')}-${String(match[3]).padStart(2, '0')}`;
}

export {
  normalizeNoticeTextLines,
  parseCnReportDate,
  parseNumber,
  resolveSupplementalHolding,
};