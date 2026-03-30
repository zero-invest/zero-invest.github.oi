/**
 * 清除缓存中 purchaseLimit 为"限购"的条目，强制它们在下次 sync 时重新获取
 */
import fs from 'node:fs/promises';
import path from 'node:path';

const dailyCacheDir = path.join(process.cwd(), '.cache', 'fund-sync', 'daily');

async function main() {
  let dirs;
  try {
    dirs = await fs.readdir(dailyCacheDir);
  } catch {
    console.log('Cache dir not found, nothing to clean');
    return;
  }

  let cleaned = 0;
  for (const file of dirs) {
    if (!file.endsWith('.json')) continue;
    const filePath = path.join(dailyCacheDir, file);
    try {
      const content = await fs.readFile(filePath, 'utf-8');
      const data = JSON.parse(content);
      // 如果 purchaseLimit 是 "限购"（没有具体金额），清除此缓存以强制重取
      if (data.purchaseLimit === '限购') {
        await fs.rm(filePath, { force: true });
        console.log(`Cleared cache for ${file} (purchaseLimit was "限购")`);
        cleaned++;
      }
    } catch {
      // ignore parse errors
    }
  }
  console.log(`Done. Cleared ${cleaned} stale cache files.`);
}

main().catch(console.error);
