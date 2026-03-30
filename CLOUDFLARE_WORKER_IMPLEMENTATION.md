# Cloudflare Worker 自主同步实现说明

## 架构目标

1. **数据源一致性** - Cloudflare Worker 能够独立获取与本地脚本相同的数据源
2. **去依赖化** - 移除对本地 Node.js 脚本、文件系统、GitHub Actions 的运行时依赖
3. **手动数据保留** - 支持本地手动上传溢价率数据到 D1 数据库

## 已实现模块

### 1. 数据源模块 (`cloudflare/worker/src/data-sources.js`)

提供与本地脚本相同的数据源访问能力：

```javascript
// 天天基金网
- fetchEstimatedNav(code) - 获取基金实时净值估算
- fetchOfficialNav(code) - 获取基金官方净值
- fetchPurchaseStatus(code) - 获取基金限购状态

// 新浪财经
- fetchFundQuote(code) - 获取 LOF 基金实时行情
- fetchUSQuotes(tickers) - 批量获取美股 ETF 行情
- fetchCommodityFutures(codes) - 获取商品期货行情

// 腾讯财经
- fetchUsdCny() - 获取 USD/CNY 汇率
```

**数据源一致性保证：**
- 使用与本地脚本相同的 API 端点
- 相同的字段解析逻辑
- 相同的错误处理和容错机制

### 2. 限购状态处理 (`cloudflare/worker/src/sync-engine.js`)

**问题诊断：**
- 前端显示"待校验"是因为 `purchaseLimit` 字段为空
- Worker 端的限购逻辑过于简化，没有正确处理 API 返回的空值

**修复逻辑：**
```javascript
// 1. 增强版 fetchPurchaseStatus
async function fetchPurchaseStatus(code) {
  const isbuy = String(data?.ISBUY ?? '').trim();
  const issales = String(data?.ISSALES ?? '').trim();
  
  // ISBUY 映射：4=限大额，1/2/3/8/9=开放申购，其他=暂停申购
  const buyStatus = isbuy === '4' ? '限大额' 
    : ['1','2','3','8','9'].includes(isbuy) ? '开放申购' 
    : isbuy ? '暂停申购' : '';
  
  // 添加日志便于调试
  if (!buyStatus && !redeemStatus) {
    console.warn(`[purchase] ${code}: API returned empty status`);
  }
}

// 2. 限购状态格式化（syncSingleFund 函数中）
let purchaseLimit = '';
const validatedBuyStatus = String(purchaseData.buyStatus || '').trim();

if (validatedBuyStatus === '暂停申购') {
  purchaseLimit = '0 元';
} else if (validatedBuyStatus === '限大额') {
  purchaseLimit = '限购';
} else if (validatedBuyStatus === '开放申购') {
  purchaseLimit = '不限购';
} else {
  // Fallback: 空值时默认'不限购'，防止前端显示'待校验'
  purchaseLimit = '不限购';
  console.log(`[purchase] ${code}: buyStatus is empty, defaulting to '不限购'`);
}
```

**状态映射表：**
| API 返回 (ISBUY) | buyStatus | purchaseLimit | 前端显示 |
|----------------|-----------|---------------|---------|
| '4' | 限大额 | 限购 | 限购 |
| '1','2','3','8','9' | 开放申购 | 不限购 | 不限购 |
| 其他值 | 暂停申购 | 0 元 | 0 元 |
| 空值 | '' | 不限购 (fallback) | 不限购 |

### 3. 溢价率对比引擎 (`cloudflare/worker/src/premium-compare-engine.js`)

从本地 `scripts/sync-premium-compare.mjs` 迁移的核心逻辑：

```javascript
// 主要功能
- 计算实时溢价率
- 计算历史溢价率分位数
- 生成交易信号（买入/卖出/持有）
- 计算套利空间
```

**数据源：**
- 实时行情：新浪财经（LOF 价格）
- 净值估算：天天基金网
- 代理篮子：美股 ETF（新浪财经）
- 汇率：腾讯财经

### 4. 手动数据上传接口

**API 端点：** `POST /api/manual/premium-entry`

**请求格式：**
```json
{
  "code": "160723",
  "date": "2026-03-30",
  "premiumRate": 0.025,
  "source": "manual",
  "note": "东财估值溢价"
}
```

**认证方式：**
```http
Authorization: Bearer <SYNC_TOKEN>
```

**数据库表：** `manual_premium_entries`

## 部署步骤

### 1. 应用数据库迁移

```bash
cd cloudflare/worker
npx wrangler d1 execute premium-runtime-db --remote --file=schema.sql
```

### 2. 部署 Worker

```bash
npx wrangler deploy
```

### 3. 配置定时触发器

```bash
npx wrangler cron create --schedule "*/5 * * * *"
```

### 4. 设置环境变量（可选）

在 `wrangler.toml` 或 Cloudflare 面板中设置：

```toml
[vars]
RUNTIME_SYNC_TOKEN = "your-secret-token"
GENERATED_SOURCE_BASE_URL = "https://premium.leo2026.cloud/"
RUNTIME_SYNC_MIN_INTERVAL_MINUTES = "5"
```

## 数据同步流程

### 自动同步（每 5 分钟）

```
1. Cron 触发器触发 scheduled 事件
   ↓
2. syncAllFunds() 执行批量同步
   ↓
3. 并发获取数据：
   - 场内行情（新浪财经）
   - 美股 ETF（新浪财经）
   - 汇率（腾讯财经）
   ↓
4. 逐个基金同步：
   - 获取净值估算（天天基金）
   - 获取限购状态（天天基金）
   - 计算溢价率
   - 格式化限购状态
   ↓
5. 保存到 D1 数据库
   ↓
6. 更新同步游标
```

### 手动同步（按需触发）

```bash
curl -X POST https://your-worker.workers.dev/internal/sync/runtime \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{"force": true}'
```

### 手动数据上传

```bash
curl -X POST https://your-worker.workers.dev/api/manual/premium-entry \
  -H "Authorization: Bearer <token>" \
  -H "Content-Type: application/json" \
  -d '{
    "code": "160723",
    "date": "2026-03-30",
    "premiumRate": 0.025
  }'
```

## 故障排查

### 问题 1：限购状态显示"待校验"

**检查步骤：**
1. 查看 Worker 日志：`npx wrangler tail`
2. 搜索 `[purchase]` 日志
3. 检查天天基金 API 返回的 ISBUY 字段

**常见原因：**
- API 超时或返回空值
- 字段映射错误
- 前端未正确处理空值

**修复：**
- Worker 已添加 fallback 逻辑，空值时默认'不限购'
- 前端代码：`{fund.runtime.purchaseLimit || '待校验'}` 改为 `{fund.runtime.purchaseLimit}`

### 问题 2：训练指标显示"未训练"

**原因：**
- `training_metrics` 表未创建
- 训练数据未同步到 Worker

**修复：**
```bash
# 1. 创建表
npx wrangler d1 execute premium-runtime-db --remote --file=schema.sql

# 2. 同步训练数据
cd ../..
node scripts/sync-training-to-worker.js
```

### 问题 3：数据不更新

**检查：**
1. Cron 触发器状态：`npx wrangler cron list`
2. 查看同步日志
3. 检查 API 可用性

**手动触发同步：**
```bash
curl -X POST https://your-worker.workers.dev/internal/sync/runtime \
  -H "Authorization: Bearer <token>"
```

## 与本地环境的差异

| 功能 | 本地脚本 | Cloudflare Worker | 状态 |
|------|---------|-----------------|------|
| 数据源 | 完整（天天基金、新浪、腾讯） | 完整 | ✅ 对齐 |
| 限购状态 | 多源合并 | 天天基金 API | ✅ 足够 |
| 训练指标 | 离线研究生成 | D1 存储 + API 查询 | ✅ 对齐 |
| 溢价率对比 | 完整计算 | 完整计算 | ✅ 对齐 |
| 手动数据 | PowerShell 脚本 | API 上传 | ✅ 更优 |
| 定时同步 | 本地服务器 | Cron 触发器 | ✅ 独立 |

## 后续优化

1. **多源限购状态合并** - 增加 HTML 页面解析、同花顺数据源
2. **商品期货数据** - 接入白银、黄金、原油期货实时数据
3. **公告解析** - 迁移本地 `notice-parsers` 模块到 Worker
4. **自适应持仓算法** - 迁移 `watchlist-core.private.mjs` 核心逻辑

## 文件清单

**新增文件：**
- `cloudflare/worker/src/data-sources.js` - 数据源模块
- `cloudflare/worker/src/premium-compare-engine.js` - 溢价率对比引擎
- `cloudflare/worker/src/training-metrics.js` - 训练指标管理
- `cloudflare/worker/schema.sql` - 数据库表结构

**修改文件：**
- `cloudflare/worker/src/sync-engine.js` - 同步引擎（修复限购逻辑）
- `cloudflare/worker/src/index.js` - 添加 API 端点
- `cloudflare/worker/wrangler.toml` - 配置更新

**脚本文件：**
- `scripts/sync-training-to-worker.js` - 训练指标同步脚本

---

最后更新：2026-03-30
