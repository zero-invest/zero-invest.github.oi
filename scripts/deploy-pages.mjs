#!/usr/bin/env node

/**
 * Cloudflare Pages 本地直接部署脚本
 * 不依赖 GitHub Actions，直接从本地构建并部署到 Cloudflare Pages
 */

import { execSync } from 'child_process';
import { existsSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');

const PROJECT_NAME = 'lof-premium-site';

function run(cmd, options = {}) {
  console.log(`\n>>> ${cmd}`);
  return execSync(cmd, {
    cwd: rootDir,
    stdio: 'inherit',
    encoding: 'utf-8',
    ...options,
  });
}

function checkWranglerLogin() {
  console.log('[0/4] 检查 Wrangler 登录状态...');
  try {
    run('npx wrangler whoami');
    return true;
  } catch {
    console.error('\n请先登录 Cloudflare：');
    console.error('运行命令：npx wrangler login');
    return false;
  }
}

function ensurePagesProject() {
  console.log('\n[1/5] 检查 Cloudflare Pages 项目...');
  try {
    // 尝试获取项目信息
    run(`npx wrangler pages project list`, { stdio: 'pipe' });
  } catch {
    // 项目不存在，创建它
    console.log(`项目 ${PROJECT_NAME} 不存在，正在创建...`);
    try {
      run(`npx wrangler pages project create ${PROJECT_NAME} --production-branch main`);
    } catch (e) {
      console.warn('创建项目失败，可能项目已存在或权限不足');
    }
  }
}

function main() {
  console.log('=== Cloudflare Pages 本地部署 ===\n');

  // Step 0: 检查登录
  if (!checkWranglerLogin()) {
    process.exit(1);
  }

  // Step 1: 确保项目存在
  ensurePagesProject();

  // Step 2: 同步数据
  console.log('\n[2/5] 同步基金数据...');
  try {
    run('npm run sync:data');
  } catch (e) {
    console.warn('数据同步失败，使用现有数据继续部署');
  }

  // Step 3: 构建
  console.log('\n[3/5] 构建项目...');
  run('npm run build:static');

  if (!existsSync(distDir)) {
    console.error('构建失败：dist 目录不存在');
    process.exit(1);
  }

  // Step 4: 部署到 Cloudflare Pages
  console.log('\n[4/5] 部署到 Cloudflare Pages...');
  try {
    run(`npx wrangler pages deploy dist --project-name=${PROJECT_NAME}`);
  } catch (e) {
    console.error('\n部署失败。请检查：');
    console.error('1. 是否已运行 npx wrangler login 登录');
    console.error('2. Cloudflare 账号是否有 Pages 权限');
    console.error('3. 项目名称是否正确：' + PROJECT_NAME);
    process.exit(1);
  }

  // Step 5: 完成
  console.log('\n[5/5] 部署完成！');
  console.log(`\n访问地址：https://${PROJECT_NAME}.pages.dev`);
  console.log('\n提示：');
  console.log('- 如果是首次部署，请在 Cloudflare 控制台绑定自定义域名');
  console.log('- 数据会从 public/generated/ 目录同步到 Pages');
}

main();
