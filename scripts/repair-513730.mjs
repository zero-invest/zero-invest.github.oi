// repair-513730.mjs  ── fixes the corrupted 513730 proxyComponents block
import { readFileSync, writeFileSync } from 'fs';

let src = readFileSync('scripts/generate-160723-research.mjs', 'utf8');
const hadCRLF = src.includes('\r\n');
if (hadCRLF) src = src.replace(/\r\n/g, '\n');

// Step 1: fix 513730 proxyComponents
const CORRUPT_START = "    proxyComponents: [\n    '160620': {";
const CORRUPT_END = "      { ticker: 'EWS', weight: 0.30 },\n    ],";
const FIXED_PROXY = "    proxyComponents: [\n      { ticker: 'EWT', weight: 0.40 },\n      { ticker: 'EWY', weight: 0.30 },\n      { ticker: 'EWS', weight: 0.30 },\n    ],";

const i1 = src.indexOf(CORRUPT_START);
const i2 = src.indexOf(CORRUPT_END, i1 < 0 ? 0 : i1);
if (i1 < 0 || i2 < 0) {
  console.error('Step 1 anchors not found', i1, i2);
  process.exit(1);
}
src = src.slice(0, i1) + FIXED_PROXY + src.slice(i2 + CORRUPT_END.length);
console.log('Step 1 done. New length:', src.length);

// Step 2: insert 6 new configs between 159329 and 159982
const ANCHOR = "    noteLabel: '沙特市场交易时段/非交易时段',\n  },\n  '159982': {\n    theme: 'cn-csi500',\n    aliases: [";

const SIX = "    noteLabel: '沙特市场交易时段/非交易时段',\n  },\n"
  + "  '160620': {\n"
  + "    theme: 'cn-resources',\n"
  + "    aliases: [\n"
  + "      { ticker: 'COPX', aliases: ['Global X Copper Miners ETF'] },\n"
  + "      { ticker: 'XME', aliases: ['SPDR S&P Metals and Mining ETF'] },\n"
  + "      { ticker: 'DBB', aliases: ['Invesco DB Base Metals Fund'] },\n"
  + "      { ticker: 'GLD', aliases: ['SPDR Gold Shares ETF'] },\n"
  + "      { ticker: 'USO', aliases: ['United States Oil Fund LP'] },\n"
  + "      { ticker: 'XLE', aliases: ['Energy Select Sector SPDR Fund'] },\n"
  + "    ],\n"
  + "    seedHoldings: ['COPX', 'XME', 'DBB', 'GLD', 'USO', 'XLE'],\n"
  + "    proxyComponents: [\n"
  + "      { ticker: 'COPX', weight: 0.30 },\n"
  + "      { ticker: 'XME', weight: 0.25 },\n"
  + "      { ticker: 'DBB', weight: 0.20 },\n"
  + "      { ticker: 'GLD', weight: 0.15 },\n"
  + "      { ticker: 'XLE', weight: 0.10 },\n"
  + "    ],\n"
  + "    gapSpreadThreshold: 0.018,\n"
  + "    gapSignalThresholdHint: 0.014,\n"
  + "    fxGapWeight: 0.25,\n"
  + "    noteLabel: 'A股资源产业交易时段/非交易时段',\n"
  + "  },\n"
  + "  '161217': {\n"
  + "    theme: 'cn-resources',\n"
  + "    aliases: [\n"
  + "      { ticker: 'COPX', aliases: ['Global X Copper Miners ETF'] },\n"
  + "      { ticker: 'XME', aliases: ['SPDR S&P Metals and Mining ETF'] },\n"
  + "      { ticker: 'DBB', aliases: ['Invesco DB Base Metals Fund'] },\n"
  + "      { ticker: 'GLD', aliases: ['SPDR Gold Shares ETF'] },\n"
  + "      { ticker: 'USO', aliases: ['United States Oil Fund LP'] },\n"
  + "      { ticker: 'XLE', aliases: ['Energy Select Sector SPDR Fund'] },\n"
  + "    ],\n"
  + "    seedHoldings: ['COPX', 'XME', 'DBB', 'GLD', 'USO', 'XLE'],\n"
  + "    proxyComponents: [\n"
  + "      { ticker: 'COPX', weight: 0.28 },\n"
  + "      { ticker: 'XME', weight: 0.25 },\n"
  + "      { ticker: 'DBB', weight: 0.22 },\n"
  + "      { ticker: 'GLD', weight: 0.15 },\n"
  + "      { ticker: 'XLE', weight: 0.10 },\n"
  + "    ],\n"
  + "    gapSpreadThreshold: 0.018,\n"
  + "    gapSignalThresholdHint: 0.014,\n"
  + "    fxGapWeight: 0.25,\n"
  + "    noteLabel: 'A股上游资源交易时段/非交易时段',\n"
  + "  },\n"
  + "  '161124': {\n"
  + "    theme: 'hk-small-cap',\n"
  + "    aliases: [\n"
  + "      { ticker: 'EWH', aliases: ['iShares MSCI Hong Kong ETF'] },\n"
  + "      { ticker: 'FLHK', aliases: ['Franklin FTSE Hong Kong ETF'] },\n"
  + "      { ticker: 'MCHI', aliases: ['iShares MSCI China ETF'] },\n"
  + "      { ticker: 'FXI', aliases: ['iShares China Large-Cap ETF'] },\n"
  + "      { ticker: 'KWEB', aliases: ['KraneShares CSI China Internet ETF'] },\n"
  + "    ],\n"
  + "    seedHoldings: ['EWH', 'FLHK', 'MCHI', 'FXI', 'KWEB'],\n"
  + "    proxyComponents: [\n"
  + "      { ticker: 'EWH', weight: 0.55 },\n"
  + "      { ticker: 'MCHI', weight: 0.25 },\n"
  + "      { ticker: 'FLHK', weight: 0.20 },\n"
  + "    ],\n"
  + "    gapSpreadThreshold: 0.02,\n"
  + "    gapSignalThresholdHint: 0.016,\n"
  + "    fxGapWeight: 0.28,\n"
  + "    noteLabel: '港股交易时段/非交易时段',\n"
  + "  },\n"
  + "  '501300': {\n"
  + "    theme: 'global-bond',\n"
  + "    aliases: [\n"
  + "      { ticker: 'AGG', aliases: ['iShares Core US Aggregate Bond ETF'] },\n"
  + "      { ticker: 'BND', aliases: ['Vanguard Total Bond Market ETF'] },\n"
  + "      { ticker: 'LQD', aliases: ['iShares iBoxx Investment Grade Corporate Bond ETF'] },\n"
  + "      { ticker: 'MBB', aliases: ['iShares MBS ETF'] },\n"
  + "      { ticker: 'TLT', aliases: ['iShares 20+ Year Treasury Bond ETF'] },\n"
  + "    ],\n"
  + "    seedHoldings: ['AGG', 'BND', 'LQD', 'MBB', 'TLT'],\n"
  + "    proxyComponents: [\n"
  + "      { ticker: 'AGG', weight: 0.50 },\n"
  + "      { ticker: 'BND', weight: 0.25 },\n"
  + "      { ticker: 'LQD', weight: 0.15 },\n"
  + "      { ticker: 'TLT', weight: 0.10 },\n"
  + "    ],\n"
  + "    gapSpreadThreshold: 0.008,\n"
  + "    gapSignalThresholdHint: 0.006,\n"
  + "    fxGapWeight: 0.3,\n"
  + "    noteLabel: '全球债券交易时段/非交易时段',\n"
  + "  },\n"
  + "  '160140': {\n"
  + "    theme: 'us-reit',\n"
  + "    aliases: [\n"
  + "      { ticker: 'VNQ', aliases: ['Vanguard Real Estate ETF'] },\n"
  + "      { ticker: 'IYR', aliases: ['iShares U.S. Real Estate ETF'] },\n"
  + "      { ticker: 'SCHH', aliases: ['Schwab US REIT ETF'] },\n"
  + "      { ticker: 'SPY', aliases: ['SPDR S&P 500 ETF Trust'] },\n"
  + "    ],\n"
  + "    seedHoldings: ['VNQ', 'IYR', 'SCHH', 'SPY'],\n"
  + "    proxyComponents: [\n"
  + "      { ticker: 'VNQ', weight: 0.55 },\n"
  + "      { ticker: 'IYR', weight: 0.30 },\n"
  + "      { ticker: 'SCHH', weight: 0.15 },\n"
  + "    ],\n"
  + "    gapSpreadThreshold: 0.015,\n"
  + "    gapSignalThresholdHint: 0.012,\n"
  + "    fxGapWeight: 0.28,\n"
  + "    noteLabel: '美国REIT交易时段/非交易时段',\n"
  + "  },\n"
  + "  '520580': {\n"
  + "    theme: 'emerging-asia',\n"
  + "    aliases: [\n"
  + "      { ticker: 'EEMA', aliases: ['iShares MSCI EM Asia ETF'] },\n"
  + "      { ticker: 'VWO', aliases: ['Vanguard FTSE Emerging Markets ETF'] },\n"
  + "      { ticker: 'EEM', aliases: ['iShares MSCI Emerging Markets ETF'] },\n"
  + "      { ticker: 'EWT', aliases: ['iShares MSCI Taiwan ETF'] },\n"
  + "      { ticker: 'EWY', aliases: ['iShares MSCI South Korea ETF'] },\n"
  + "      { ticker: 'EWH', aliases: ['iShares MSCI Hong Kong ETF'] },\n"
  + "    ],\n"
  + "    seedHoldings: ['EEMA', 'VWO', 'EEM', 'EWT', 'EWY', 'EWH'],\n"
  + "    proxyComponents: [\n"
  + "      { ticker: 'EEMA', weight: 0.45 },\n"
  + "      { ticker: 'EWT', weight: 0.25 },\n"
  + "      { ticker: 'EWY', weight: 0.20 },\n"
  + "      { ticker: 'EWH', weight: 0.10 },\n"
  + "    ],\n"
  + "    gapSpreadThreshold: 0.02,\n"
  + "    gapSignalThresholdHint: 0.016,\n"
  + "    fxGapWeight: 0.3,\n"
  + "    noteLabel: '亚洲新兴市场交易时段/非交易时段',\n"
  + "  },\n"
  + "  '159982': {\n"
  + "    theme: 'cn-csi500',\n"
  + "    aliases: [";

const i3 = src.indexOf(ANCHOR);
if (i3 < 0) {
  const d = src.indexOf("'159329': {");
  console.error('Step 2 anchor not found. 159329 idx=', d);
  if (d >= 0) console.error('Context:', JSON.stringify(src.slice(d, d + 400)));
  process.exit(1);
}
src = src.slice(0, i3) + SIX + src.slice(i3 + ANCHOR.length);
console.log('Step 2 done. New length:', src.length);

if (hadCRLF) src = src.replace(/\n/g, '\r\n');
writeFileSync('scripts/generate-160723-research.mjs', src, 'utf8');
console.log('Written successfully.');
