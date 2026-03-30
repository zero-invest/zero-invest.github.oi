# MEMORY.md - 溢价率网站项目长期记忆

## 项目概述
LOF 基金溢价率追踪网站，React + TypeScript + Vite + Tailwind CSS。
- 本地开发：`npm run dev`（端口 5173）
- 同步数据：`node scripts/sync-funds.mjs`（生成 `public/generated/funds-runtime.json`）
- Cloudflare Worker 部署：`npx wrangler deploy`（在 `cloudflare/worker/` 目录）

## 数据架构

### 核心数据文件
- `public/generated/funds-runtime.json` — 主数据文件，包含 64 个基金的实时数据
- `public/generated/premium-compare.json` — 溢价率对比数据
- `.cache/fund-sync/daily/*.json` — 每日缓存（按基金代码命名），缓存版本 DAILY_CACHE_VERSION=40

### 关键字段
- `purchaseLimit` — 限购金额展示字符串（"不限购"/"50万元"/"1000元"/"暂停申购"）
- `purchaseStatus` — 购买状态原始值（"开放申购 / 开放赎回"等）
- `officialNavT1` — 最新官方净值
- `navDate` — 净值日期

## 数据同步机制

### 缓存优先原则
`getDailyFundData()` 在 `fetchedDate === today && cacheVersion === DAILY_CACHE_VERSION` 时直接返回缓存，**不重新抓取**。
**陷阱**：修改同步脚本逻辑后，当日缓存不会自动更新，需要手动清除或更新缓存文件。

### 东财 API 数据源
- **净值 API**：`https://api.fund.eastmoney.com/chart/lsjz?callback=GetData&fundCode={code}&pageIndex=1&pageSize=20`
- **基金信息 API**：`https://api.fund.eastmoney.com/Fund/GetSingleFundInfo?callback=x&fcode={code}&fileds=FCODE,ISBUY,ISSALES,MINDT,DTZT,SHORTNAME`
  - `ISBUY` 字段：1=开放申购，2=暂停申购，3=限大额
  - `ISSALES` 字段：1=开放赎回，0=暂停赎回
  - `MINDT` 字段：限额（万元单位，10=10万元，0.05=500元，0=不限额）
- **估值（fundgz）**：`https://fundgz.1234567.com.cn/js/{code}.js` — 部分基金已失效，需 fallback 到 eastmoney-quote
- **备用净值**：`https://fund.eastmoney.com/pingzhongdata/{code}.js` — 包含 Data_netWorthTrend

### 购买状态处理逻辑
`formatPurchaseLimit(buyStatus, limitText, apiLimitText)` 优先级：
1. `暂停申购` → 返回 `'暂停申购'`（历史问题：曾错误返回 `'0元'`，已修复 2026-03-30）
2. HTML 解析的 `上限X万元` → 直接用
3. `开放申购` → 返回 `'不限购'`
4. `限大额` → 用 API MINDT 金额或 `'限购'`

`formatMindtLimit(mindt)` 换算规则：
- `val < 1` 万：换算为元（0.05 → 500元）
- `val >= 1` 且整数：`${val}万元`
- `val >= 1` 带小数：保留有效小数

## 前端显示逻辑

### 限购列样式（FundTable.tsx）
`getLimitClass(limit)`:
- `'暂停申购'` → `tone-negative`（红色）
- `'0元'` → `muted-text`（灰色，历史遗留，正常不应再出现）
- 1-1000元范围 → `tone-positive`（绿色，表示小额限购，接近正常）
- 万元级别 → 默认（无颜色）

### 东财估值溢价 fallback（App.tsx）
fundgz API 失效时 fallback 到 eastmoney-quote provider：
```javascript
const FALLBACK_PROVIDERS = ['eastmoney-fundgz', 'eastmoney-quote'];
```

## Cloudflare Worker 架构说明（重要！2026-03-30 更新）

### Worker 的职责分工
- **Worker 能做**：实时场内价格（腾讯行情 qt.gtimg.cn），用户认证，手动溢价率记录，实时估算
- **Worker 不能做**：东财净值 API（`chart/lsjz`、`f10/lsjz`）在 Worker 境外 IP 被反爬封锁，成功率很低（64 个基金只有约 12 个成功）
- **正确的净值数据来源**：本地脚本 `node scripts/sync-funds.mjs` → 生成 `funds-runtime.json` → 部署到 Cloudflare Pages

### 前端数据加载策略（App.tsx）
- **所有环境都优先静态文件**：`generated/funds-runtime.json`（Cloudflare Pages CDN 分发）
- **Worker API 仅作兜底**，且有质量检测：若 >60% 基金净值为 0，自动跳过 Worker API 用静态文件
- 之前的错误逻辑：非 localhost/GitHub Pages 环境优先 Worker API → 导致净值全显示 `--`

### Worker 净值 API 调用顺序（sync-engine.js）
1. `chart/lsjz?callback=GetData`（主数据源）
2. `f10/lsjz?callback=x`（备用）
3. `pingzhongdata.js`（最终兜底）
- 以上三个 API 在 Cloudflare Worker 环境中都可能失败（被反爬），但本地脚本环境中正常

### 部署流程
- **前端 + 净值数据**：`node scripts/sync-funds.mjs` → `npm run build:static` → `npx wrangler pages deploy dist --project-name=lof-premium-site`
- **Worker**：`cd cloudflare/worker && npx wrangler deploy`
- **手动触发 Worker 同步**：`POST /internal/sync/runtime?force=true`，Header: `Authorization: Bearer debug-sync-token`

### Worker sync-engine.js 中的 bug（已修复 2026-03-30）
- `purchaseLimit` 在 `buyStatus === '暂停申购'` 时返回 `'0元'` → 已修复为 `'暂停申购'`
- `fetchPurchaseStatus` 的 timeout 参数写在 options 对象里无效 → 已修复为第三个参数

## 常见问题排查

### 净值显示 `--`（无净值）
- 首先检查 Cloudflare Pages 上的静态 JSON 是否有净值：`https://premium.leo2026.cloud/generated/funds-runtime.json`
- 若静态 JSON 也无净值，需重新运行 `node scripts/sync-funds.mjs` 并重新部署
- Worker API 净值为 0 是正常现象（被反爬），不用管它，前端有 fallback

### 净值日期旧/不更新
- QDII/黄金/跨境基金：T+2披露，如 3月30日显示 3月26日净值 → 正常现象
- 国内 LOF：若净值日期也旧，检查东财 lsjz API 是否可访问（本地环境）

### 限购显示问题
- 显示 `"限购"` 未解析金额：检查东财 API `MINDT` 字段返回值
- 显示 `"0元"`：`formatPurchaseLimit` 旧版 bug（已修复），或 MINDT=0 的暂停申购基金
- 缓存中有旧值：需手动更新 `.cache/fund-sync/daily/*.json`

### Worker API 超时
- 症状：`ETIMEDOUT 184.173.136.86:443`
- 原因：Cloudflare Worker 调用东财 API 网络超时，净值 API 被反爬
- 前端有质量检测 fallback，会自动使用静态文件
- Worker 部署：`cd cloudflare/worker && npx wrangler deploy`

## 终端注意事项
- PowerShell 显示中文乱码是 CP936/UTF-8 编码问题，**不影响实际数据**
- 验证数据用 `.mjs` 脚本读取文件，而非直接打印 JSON
- Windows PowerShell 不支持 `tail` 命令，用 `Select-Object -Last N`
- `npm` 不能用 `Start-Process` 启动（非 Win32 应用），用 `Start-Process cmd.exe -ArgumentList "/c","npm run dev"`
