import { parseNoticeHoldingsBySection59Rows } from './section-5-9-rows.mjs';
import { parseNoticeHoldingsBySection59Chunks } from './section-5-9-chunks.mjs';

const NOTICE_PARSER_REGISTRY = [
  {
    id: 'section-5-9-chunks',
    fundCodes: ['501225'],
    parse: parseNoticeHoldingsBySection59Chunks,
  },
  {
    id: 'section-5-9-rows',
    fundCodes: ['160216', '161116', '164701', '160719', '501312', '501018', '160723'],
    parse: parseNoticeHoldingsBySection59Rows,
  },
];

const parserByFundCode = new Map(
  NOTICE_PARSER_REGISTRY.flatMap((entry) => entry.fundCodes.map((code) => [code, entry])),
);

function getNoticeParserConfig(code) {
  return parserByFundCode.get(code) ?? NOTICE_PARSER_REGISTRY[0] ?? null;
}

function parseNoticeHoldingsDisclosure(code, payload) {
  const parser = getNoticeParserConfig(code);
  if (!parser) {
    return {
      parserId: '',
      disclosedHoldingsTitle: '',
      disclosedHoldingsReportDate: '',
      disclosedHoldings: [],
    };
  }

  const parsed = parser.parse(payload);
  return {
    parserId: parser.id,
    ...parsed,
  };
}

export {
  NOTICE_PARSER_REGISTRY,
  getNoticeParserConfig,
  parseNoticeHoldingsDisclosure,
};