import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const runtimeJsonPath = path.join(projectRoot, 'public', 'generated', 'funds-runtime.json');
const outputPath = path.join(projectRoot, '.cache', 'cloudflare', 'runtime-upsert.sql');

function sqlString(value) {
  const text = String(value ?? '');
  return `'${text.replace(/'/g, "''")}'`;
}

function sqlNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? String(num) : 'NULL';
}

function sqlNullableString(value) {
  if (value === null || value === undefined || value === '') return 'NULL';
  return sqlString(value);
}

async function main() {
  const raw = await fs.readFile(runtimeJsonPath, 'utf8');
  const payload = JSON.parse(raw);
  const syncedAt = String(payload?.syncedAt || new Date().toISOString());
  const funds = Array.isArray(payload?.funds) ? payload.funds : [];
  const nowIso = new Date().toISOString();

  const lines = [];
  lines.push('PRAGMA foreign_keys = ON;');
  lines.push('');
  lines.push('INSERT OR IGNORE INTO runtime_runs (synced_at, fund_count, created_at) VALUES');
  lines.push(`(${sqlString(syncedAt)}, ${funds.length}, ${sqlString(nowIso)});`);
  lines.push('');

  for (const fund of funds) {
    const code = String(fund?.code || '').trim();
    if (!code) continue;

    lines.push('INSERT OR REPLACE INTO latest_fund_runtime (');
    lines.push('  code, synced_at, runtime_json');
    lines.push(') VALUES (');
    lines.push(`  ${sqlString(code)},`);
    lines.push(`  ${sqlString(syncedAt)},`);
    lines.push(`  ${sqlString(JSON.stringify(fund))}`);
    lines.push(');');
    lines.push('');
  }

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, lines.join('\n'), 'utf8');

  console.log(`Exported ${funds.length} funds to ${path.relative(projectRoot, outputPath)}`);
  console.log('Next: wrangler d1 execute <DB_NAME> --remote --file .cache/cloudflare/runtime-upsert.sql');
}

main().catch((error) => {
  console.error('Failed to export runtime SQL:', error);
  process.exitCode = 1;
});
