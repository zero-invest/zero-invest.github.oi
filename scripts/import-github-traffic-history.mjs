import fs from 'node:fs/promises';
import path from 'node:path';

const projectRoot = process.cwd();
const historyPath = path.join(projectRoot, '.cache', 'fund-sync', 'github-traffic-history.json');
const outputPath = path.join(projectRoot, 'public', 'generated', 'github-traffic.json');
const defaultInputPath = path.join(projectRoot, 'public', 'generated', 'github-traffic-manual.json');

function sumMetric(items, key) {
  return items.reduce((sum, item) => sum + (Number(item?.[key]) || 0), 0);
}

function summarizeSnapshots(snapshots) {
  const totalDays = snapshots.length;
  return {
    totalDays,
    cumulativeViewUniques: sumMetric(snapshots, 'viewUniques'),
    cumulativeViewCount: sumMetric(snapshots, 'viewCount'),
    latestCapturedDate: totalDays ? snapshots[totalDays - 1].date : '',
  };
}

function buildRecentSeven(days) {
  const lastSeven = days.slice(-7);
  return {
    days: lastSeven,
    viewCount: sumMetric(lastSeven, 'viewCount'),
    viewUniques: sumMetric(lastSeven, 'viewUniques'),
    cloneCount: sumMetric(lastSeven, 'cloneCount'),
    cloneUniques: sumMetric(lastSeven, 'cloneUniques'),
  };
}

function normalizeSnapshot(input) {
  const date = String(input?.date || '').trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    return null;
  }

  return {
    date,
    viewCount: Math.max(0, Number(input?.viewCount) || 0),
    viewUniques: Math.max(0, Number(input?.viewUniques) || 0),
    cloneCount: Math.max(0, Number(input?.cloneCount) || 0),
    cloneUniques: Math.max(0, Number(input?.cloneUniques) || 0),
  };
}

function normalizeSnapshots(payload) {
  const rawList = Array.isArray(payload) ? payload : Array.isArray(payload?.snapshots) ? payload.snapshots : [];
  const byDate = new Map();

  for (const item of rawList) {
    const normalized = normalizeSnapshot(item);
    if (!normalized) {
      continue;
    }
    byDate.set(normalized.date, normalized);
  }

  return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
}

async function readJson(filePath, fallback) {
  try {
    const raw = await fs.readFile(filePath, 'utf8');
    const normalized = String(raw).replace(/^\uFEFF/, '');
    return JSON.parse(normalized);
  } catch {
    return fallback;
  }
}

async function main() {
  const inputPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultInputPath;
  const incomingRaw = await readJson(inputPath, null);
  if (!incomingRaw) {
    throw new Error(`无法读取导入文件: ${inputPath}`);
  }

  const incomingSnapshots = normalizeSnapshots(incomingRaw);
  if (!incomingSnapshots.length) {
    throw new Error('导入文件中没有合法 snapshots（需要 YYYY-MM-DD 日期和数值字段）');
  }

  const existingHistory = await readJson(historyPath, { snapshots: [] });
  const existingSnapshots = normalizeSnapshots(existingHistory);
  const mergedByDate = new Map(existingSnapshots.map((item) => [item.date, item]));

  for (const item of incomingSnapshots) {
    mergedByDate.set(item.date, item);
  }

  const mergedSnapshots = [...mergedByDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  const outputHistory = { snapshots: mergedSnapshots };

  await fs.mkdir(path.dirname(historyPath), { recursive: true });
  await fs.writeFile(historyPath, `${JSON.stringify(outputHistory, null, 2)}\n`, 'utf8');

  const existingPayload = await readJson(outputPath, {});
  const repo = String(existingPayload?.repo || process.env.GH_TRAFFIC_REPO || process.env.GITHUB_REPOSITORY || '');
  const recent7 = buildRecentSeven(mergedSnapshots);
  const snapshotSummary = summarizeSnapshots(mergedSnapshots);

  const payload = {
    generatedAt: new Date().toISOString(),
    source: 'github-traffic-manual-import',
    repo,
    available: false,
    reason: 'manual-history-imported',
    snapshotConfig: existingPayload?.snapshotConfig || {
      timeZone: 'Asia/Shanghai',
      snapshotHourCst: 12,
      windowMinutes: 20,
    },
    snapshotSummary,
    recent7,
    snapshots: mergedSnapshots,
    totals: {
      viewCount: sumMetric(mergedSnapshots, 'viewCount'),
      viewUniques: sumMetric(mergedSnapshots, 'viewUniques'),
      cloneCount: sumMetric(mergedSnapshots, 'cloneCount'),
      cloneUniques: sumMetric(mergedSnapshots, 'cloneUniques'),
    },
    last14Days: mergedSnapshots.slice(-14),
  };

  await fs.mkdir(path.dirname(outputPath), { recursive: true });
  await fs.writeFile(outputPath, `${JSON.stringify(payload, null, 2)}\n`, 'utf8');

  console.log(`[github-traffic] imported snapshots=${incomingSnapshots.length}, totalDays=${mergedSnapshots.length}, recent7UV=${recent7.viewUniques}`);
  console.log(`[github-traffic] input=${inputPath}`);
}

main().catch((error) => {
  console.error(`[github-traffic] import failed: ${error instanceof Error ? error.message : String(error)}`);
  process.exit(1);
});
