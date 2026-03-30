# 项目说明文档

## 项目概述

**项目名称**: LOF溢价率估值网站  
**项目类型**: 金融数据可视化 Web 应用  
**核心功能**: 跨境LOF/国内LOF/ETF溢价率实时估值与监控

---

## 技术栈

### 前端
- **框架**: React 18 + TypeScript
- **构建工具**: Vite 5
- **路由**: React Router v6
- **样式**: 纯 CSS（CSS Variables 主题系统）
- **图表**: 可能使用 Chart.js 或纯 CSS 实现

### 后端
- **运行环境**: Cloudflare Workers
- **数据库**: Cloudflare D1 (SQLite)
- **对象存储**: Cloudflare R2
- **部署平台**: Cloudflare Workers + Cloudflare Pages

### 部署
- **前端**: Cloudflare Pages + GitHub Pages
- **API**: https://lof-premium-rate-web-api.987144016.workers.dev

---

## 目录结构

```
├── public/
│   ├── generated/          # 运行时生成的数据
│   │   ├── funds-runtime.json      # 基金实时数据
│   │   └── premium-compare.json    # 溢价比较数据
│   └── wechat-sponsor-qr.jpg       # 微信赞赏码
├── src/
│   ├── components/         # React 组件
│   │   └── FundTable.tsx   # 基金表格组件
│   ├── App.tsx             # 主应用入口
│   ├── styles.css          # 全局样式
│   └── main.tsx            # React 入口
├── cloudflare/
│   └── worker/
│       ├── src/
│       │   ├── index.js    # Worker API 主逻辑
│       │   └── training-metrics.js  # 训练指标处理
│       └── wrangler.toml  # Worker 配置
├── scripts/                # 构建脚本
│   ├── sync-funds.mjs      # 同步基金数据
│   └── sync-premium-compare.mjs
└── package.json
```

---

## 核心代码文件功能

### 1. src/App.tsx (主应用)

**功能**: 
- 定义所有路由（HomePage, MemberCenter, LoginPage, RegisterPage, DocsPage, AdminPage 等）
- 认证状态管理（currentUser, isMember）
- API 调用封装（fetchApi）
- 用户操作处理（handleLogin, handleRegister, handleLogout 等）

**关键函数**:
- `DesktopShell`: 公共布局组件（侧边栏 + 主内容区）
- `HomePage`: 基金列表展示页
- `LoginPage`: 账号密码登录
- `RegisterPage`: 注册页面
- `MemberCenter`: 会员中心（修改密码、绑定邀请码、赞赏）
- `AdminPage`: 后台管理（订单审核、会员发放）
- `DocsPage`: 说明文档页

**导航配置**:
```typescript
const DESKTOP_SHELL_NAV = [
  { icon: '🌏', label: '跨境 LOF', to: '/qdii-lof' },
  { icon: '🏠', label: '国内 LOF', to: '/domestic-lof' },
  { icon: '📈', label: '跨境 ETF', to: '/qdii-etf' },
  { icon: '💹', label: '国内 ETF', to: '/domestic-etf' },
  { icon: '⭐', label: '我的收藏', to: '/favorites' },
  { icon: '👤', label: '会员中心', to: '/member' },
  { icon: '📖', label: '说明文档', to: '/docs' },
];
```

---

### 2. src/styles.css (样式文件)

**功能**: 全局 CSS 样式，包含：
- CSS Variables 主题系统（light/dark）
- 布局组件样式（dashboard-shell, dashboard-sidebar）
- 卡片样式（saas-panel, saas-card）
- 表格样式（fund-table）
- 登录/注册页面样式（auth-center-*）
- 说明文档页面样式（docs-*）
- 会员中心样式（member-*）
- 响应式设计（媒体查询）

---

### 3. cloudflare/worker/src/index.js (后端 API)

**功能**: 所有 API 路由处理

**主要 API**:
- `POST /api/auth/register` - 用户注册
- `POST /api/auth/login` - 用户登录
- `POST /api/auth/logout` - 用户登出
- `GET /api/auth/me` - 获取当前用户
- `POST /api/auth/change-password` - 修改密码
- `POST /api/auth/send-code` - 发送邮箱验证码
- `POST /api/auth/code-login` - 邮箱验证码登录
- `GET /api/member/status` - 会员状态
- `POST /api/admin/*` - 管理员接口

**核心函数**:
- `handleLogin`: 登录处理，特殊逻辑：accountId='admin' 自动创建
- `handleRegister`: 注册处理
- `handleChangePassword`: 修改密码
- `handleSendCode`: 发送验证码（含限流）
- `grantTrialMembership`: 发放试用会员

---

### 4. cloudflare/worker/src/training-metrics.js

**功能**: 训练指标处理（可能用于模型误差计算）

---

## 工作流程

### 流程一：开发新功能

```
1. 需求分析
   ├── 查看现有代码结构（grep/glob 搜索关键代码）
   ├── 理解需求，确定修改范围
   └── 查看类型定义（如有）

2. 本地开发
   ├── 修改代码
   ├── npx tsc --noEmit（检查类型错误）
   └── npm run build（构建测试）

3. 部署后端（如有变动）
   ├── cd cloudflare/worker
   ├── npx wrangler deploy
   └── 验证 API

4. 部署前端
   ├── Cloudflare: npx wrangler pages deploy dist
   └── GitHub: gh workflow run deploy-pages.yml

5. 测试验证
   ├── curl 测试 API
   └── 浏览器测试 UI
```

### 流程二：数据库操作

```
1. 查看数据
   npx wrangler d1 execute premium-runtime-db --command="SELECT * FROM users" --remote

2. 删除用户（需先删除关联数据）
   npx wrangler d1 execute premium-runtime-db --command="DELETE FROM user_sessions WHERE user_id = X" --remote
   npx wrangler d1 execute premium-runtime-db --command="DELETE FROM memberships WHERE user_id = X" --remote
   npx wrangler d1 execute premium-runtime-db --command="DELETE FROM users WHERE id = X" --remote
```

### 流程三：调试登录问题

```
1. 注册测试用户
   curl -X POST "https://api.leo2026.cloud/api/auth/register" \
     -H "Content-Type: application/json" \
     -d '{"accountId":"test123","password":"test123456","nickname":"测试"}'

2. 登录并保存 Cookie
   curl -c cookies.txt -X POST "https://api.leo2026.cloud/api/auth/login" \
     -H "Content-Type: application/json" \
     -d '{"accountId":"test123","password":"test123456"}'

3. 测试需要认证的 API
   curl -b cookies.txt "https://api.leo2026.cloud/api/auth/me"
```

---

## 常用 URL

| 用途 | URL |
|------|-----|
| Cloudflare 前端 | https://premium.leo2026.cloud |
| GitHub Pages | https://987144016.github.io/lof-Premium-Rate-Web/ |
| API 端点 | https://api.leo2026.cloud |
| Worker API | https://lof-premium-rate-web-api.987144016.workers.dev |

---

## 测试账号

- **管理员**: admin / admin123456
- **调试密码**: debug123456（可登录任意已存在用户，但生产环境已移除此逻辑）

---

## 注意事项

1. **数据库结构**: D1 数据库结构无法轻易修改，添加字段需重建表
2. **验证码功能**: 腾讯云邮件模板审核中，暂时不可用
3. **Session 认证**: 使用 HttpOnly Cookie，credentials: 'include'
4. **API 限流**: 关键接口有 IpRateLimit 和 UserRateLimit
5. **调试模式**: 生产环境不应出现调试密码

---

## 快速参考

```bash
# 本地开发
npm run dev

# 构建生产
npm run build

# Cloudflare 部署
npx wrangler deploy (后端)
npx wrangler pages deploy dist (前端)

# 数据库查询
npx wrangler d1 execute premium-runtime-db --command="SQL" --remote
```

---

*最后更新: 2026-03-29*