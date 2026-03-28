import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';

const args = new Map(
  process.argv.slice(2).map((item) => {
    const [key, ...rest] = item.split('=');
    return [key.replace(/^--/, ''), rest.join('=')];
  }),
);

const count = Math.min(Math.max(Number.parseInt(args.get('count') || '10', 10), 1), 5000);
const days = Math.max(Number.parseInt(args.get('days') || '30', 10), 1);
const batchNo = String(args.get('batch') || `batch-${new Date().toISOString().slice(0, 10)}`).trim();
const expiresAt = String(args.get('expiresAt') || '').trim();
const outputDir = path.resolve('tmp');

function makeCode() {
  return `VIP-${crypto.randomUUID().replace(/-/g, '').slice(0, 12).toUpperCase()}`;
}

function maskCode(code) {
  return `${code.slice(0, 3)}***${code.slice(-3)}`;
}

async function sha256Hex(input) {
  return crypto.createHash('sha256').update(input).digest('hex');
}

const rows = [];
for (let index = 0; index < count; index += 1) {
  const code = makeCode();
  rows.push({
    code,
    codeMask: maskCode(code),
    codeHash: await sha256Hex(code),
    batchNo,
    days,
    expiresAt,
    createdBy: 'local-script',
  });
}

await fs.mkdir(outputDir, { recursive: true });
const jsonPath = path.join(outputDir, `${batchNo}-redeem-codes.json`);
const csvPath = path.join(outputDir, `${batchNo}-redeem-codes.csv`);
const sqlPath = path.join(outputDir, `${batchNo}-redeem-codes.sql`);

await fs.writeFile(jsonPath, `${JSON.stringify({ batchNo, count, days, expiresAt, codes: rows }, null, 2)}\n`, 'utf8');
await fs.writeFile(
  csvPath,
  ['code,codeMask,codeHash,batchNo,days,expiresAt,createdBy', ...rows.map((item) => [item.code, item.codeMask, item.codeHash, item.batchNo, item.days, item.expiresAt, item.createdBy].join(','))].join('\n') + '\n',
  'utf8',
);
await fs.writeFile(
  sqlPath,
  rows.map((item) => `INSERT INTO redeem_codes (code_hash, code_mask, batch_no, days, max_uses, used_count, expires_at, created_at, created_by) VALUES ('${item.codeHash}', '${item.codeMask}', '${item.batchNo}', ${item.days}, 1, 0, ${item.expiresAt ? `'${item.expiresAt}'` : 'NULL'}, CURRENT_TIMESTAMP, '${item.createdBy}');`).join('\n') + '\n',
  'utf8',
);

console.log(`Generated ${rows.length} redeem codes`);
console.log(`JSON: ${jsonPath}`);
console.log(`CSV: ${csvPath}`);
console.log(`SQL: ${sqlPath}`);
