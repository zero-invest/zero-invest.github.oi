import { spawn } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import process from 'node:process';

const projectRoot = process.cwd();
const nodeExecutable = process.execPath;
const nodeDir = path.dirname(nodeExecutable);
const viteBin = path.join(projectRoot, 'node_modules', 'vite', 'bin', 'vite.js');
let syncing = false;
const FAST_SYNC_INTERVAL = 60_000;
const SLOW_SYNC_INTERVAL = 15 * 60_000;
const DEV_HOST = '127.0.0.1';
const DEV_PORT = '4173';

function getZonedClock(date, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    weekday: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).formatToParts(date);

  const weekday = parts.find((item) => item.type === 'weekday')?.value ?? 'Sun';
  const hour = Number(parts.find((item) => item.type === 'hour')?.value ?? '0');
  const minute = Number(parts.find((item) => item.type === 'minute')?.value ?? '0');

  return {
    weekday,
    minutes: hour * 60 + minute,
  };
}

function isWeekday(weekday) {
  return ['Mon', 'Tue', 'Wed', 'Thu', 'Fri'].includes(weekday);
}

function isCnTradingSession(date) {
  const clock = getZonedClock(date, 'Asia/Shanghai');
  if (!isWeekday(clock.weekday)) {
    return false;
  }

  return (clock.minutes >= 9 * 60 + 30 && clock.minutes < 11 * 60 + 30) || (clock.minutes >= 13 * 60 && clock.minutes < 15 * 60);
}

function isUsTradingSession(date) {
  const clock = getZonedClock(date, 'America/New_York');
  if (!isWeekday(clock.weekday)) {
    return false;
  }

  return clock.minutes >= 9 * 60 + 30 && clock.minutes < 16 * 60;
}

function getSyncInterval(now = new Date()) {
  return isCnTradingSession(now) || isUsTradingSession(now) ? FAST_SYNC_INTERVAL : SLOW_SYNC_INTERVAL;
}

function runCommand(command, args, options = {}) {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: projectRoot,
      stdio: 'inherit',
      shell: false,
      ...options,
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`${command} ${args.join(' ')} exited with code ${code ?? -1}`));
    });
    child.on('error', reject);
  });
}

async function syncOnce() {
  if (syncing) {
    return;
  }

  syncing = true;
  try {
    await runCommand(nodeExecutable, ['scripts/sync-funds.mjs']);
  } catch (error) {
    console.error('[auto-refresh] sync failed:', error instanceof Error ? error.message : error);
  } finally {
    syncing = false;
  }
}

async function main() {
  await syncOnce();

  if (!fs.existsSync(viteBin)) {
    throw new Error(`Vite 未安装，缺少文件: ${viteBin}`);
  }

  const vite = spawn(nodeExecutable, [viteBin, '--host', DEV_HOST, '--port', DEV_PORT, '--open'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });

  process.stdout.write(`[auto-refresh] local url: http://${DEV_HOST}:${DEV_PORT}/#/qdii-lof\n`);

  const handleOutput = (chunk, writer) => {
    const text = chunk.toString();
    writer.write(text);
  };

  vite.stdout?.on('data', (chunk) => handleOutput(chunk, process.stdout));
  vite.stderr?.on('data', (chunk) => handleOutput(chunk, process.stderr));

  let timer = setTimeout(function scheduleNext() {
    void syncOnce().finally(() => {
      timer = setTimeout(scheduleNext, getSyncInterval());
    });
  }, getSyncInterval());

  const shutdown = () => {
    clearTimeout(timer);
    vite.kill();
    process.exit(0);
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
  vite.on('exit', (code) => {
    clearTimeout(timer);
    process.exit(code ?? 0);
  });
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
