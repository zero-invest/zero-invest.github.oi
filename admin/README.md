# 后台管理系统

这是一个独立的后台管理系统，用于管理用户、兑换码、赞赏审核等功能。

## 🚀 快速开始

### 本地开发

#### 方式一：同时启动前台和后台 (推荐)

```bash
# Windows
start-dev-all.cmd

# 手动执行
npm run dev          # 前台：http://localhost:5173
npm run dev:admin    # 后台：http://localhost:5174/admin/
```

#### 方式二：单独启动后台

```bash
npm run dev:admin
```

访问：http://localhost:5174/admin/

### 本地测试登录

1. 访问 http://localhost:5174/admin/test-login.html
2. 使用默认账号登录:
   - 账号：`admin`
   - 密码：`admin123`

## 📦 构建部署

### 构建生产版本

```bash
# 构建前台 + 后台
npm run build

# 仅构建后台
npm run build:admin
```

构建产物位于 `dist/admin/` 目录

### 部署方案

#### 方案 A: 独立子域名部署 (推荐)

```
前台：www.example.com
后台：admin.example.com
```

**配置步骤**:
1. 将 `dist/` 目录内容上传到 Web 服务器
2. 配置 Nginx/Apache 将 `/admin` 路径指向 `dist/admin/`
3. 或配置独立子域名指向 `dist/admin/`

#### 方案 B: 路径隔离部署

```
https://example.com/       → dist/
https://example.com/admin/ → dist/admin/
```

**Nginx 配置示例**:
```nginx
server {
    listen 80;
    server_name example.com;
    
    root /var/www/premium-site;
    
    # 前台
    location / {
        try_files $uri $uri/ /index.html;
    }
    
    # 后台管理
    location /admin {
        alias /var/www/premium-site/admin;
        try_files $uri $uri/ /admin/index.html;
    }
}
```

#### 方案 C: GitHub Pages 部署

```bash
# 构建所有资源
npm run build

# 部署到 GitHub Pages
npm run deploy:pages
```

访问:
- 前台：https://yourusername.github.io/repo-name/
- 后台：https://yourusername.github.io/repo-name/admin/

## 🔐 安全建议

### 生产环境配置

1. **独立域名部署**: 后台管理应部署在独立子域名
2. **HTTPS**: 强制使用 HTTPS
3. **访问控制**: 
   - 配置 HTTP Basic Auth
   - 或使用 IP 白名单
   - 或集成 OAuth/SSO

4. **环境变量**:
   ```bash
   # .env.production
   VITE_ADMIN_API_BASE=https://api.example.com
   VITE_ADMIN_AUTH_URL=https://auth.example.com
   ```

### 认证集成

后台管理系统需要与后端 API 配合实现认证:

```typescript
// 示例：登录 API
POST /api/admin/auth/login
Content-Type: application/json

{
  "username": "admin",
  "password": "your_password"
}

// 响应
{
  "ok": true,
  "token": "jwt_token_here",
  "user": {
    "username": "admin",
    "role": "admin"
  }
}
```

## 📋 功能模块

### 1. 仪表盘 (Dashboard)
- 用户统计
- 会员统计
- 赞赏待审核
- 访客数据

### 2. 用户管理 (Users)
- 查看用户列表
- 搜索用户
- 封禁/解封账号
- 取消会员资格

### 3. 兑换码管理 (RedeemCodes)
- 批量生成兑换码
- 查看兑换码状态
- 导出兑换码

### 4. 赞赏审核 (Appreciations)
- 查看待审核赞赏
- 通过/拒绝赞赏
- 封禁可疑用户
- 自动发放会员

### 5. 访客统计 (TrafficStats)
- 访客趋势图表
- 独立访客统计
- 访问次数统计

## 🔧 API 接口

后台管理系统需要以下 API 支持:

### 认证接口
```
POST   /api/admin/auth/login      - 管理员登录
POST   /api/admin/auth/logout     - 管理员登出
GET    /api/admin/auth/me         - 获取当前管理员信息
```

### 用户管理
```
GET    /api/admin/users           - 获取用户列表
GET    /api/admin/users/:id       - 获取单个用户
POST   /api/admin/users/:id/ban   - 封禁用户
POST   /api/admin/users/:id/unban - 解封用户
POST   /api/admin/users/:id/cancel-membership - 取消会员
```

### 兑换码
```
GET    /api/admin/redeem-codes              - 获取兑换码列表
POST   /api/admin/redeem-codes/generate     - 批量生成
POST   /api/admin/redeem-codes/:id/disable  - 禁用兑换码
GET    /api/admin/redeem-codes/export       - 导出兑换码
```

### 赞赏审核
```
GET    /api/admin/appreciations             - 获取赞赏列表
GET    /api/admin/appreciations/pending     - 待审核列表
POST   /api/admin/appreciations/:id/approve - 通过审核
POST   /api/admin/appreciations/:id/reject  - 拒绝审核
```

### 访客统计
```
GET    /api/admin/traffic/stats    - 获取统计数据
GET    /api/admin/traffic/trend    - 获取趋势数据
```

## 🎨 自定义配置

### 修改主题色

编辑 `src/styles.css` 中的 CSS 变量:

```css
:root {
  --primary: #3b82f6;      /* 主色调 */
  --primary-hover: #2563eb; /* 悬停色 */
  --success: #10b981;       /* 成功色 */
  --danger: #ef4444;        /* 危险色 */
  --warning: #f59e0b;       /* 警告色 */
}
```

### 添加新功能模块

1. 在 `src/admin/` 目录创建新组件
2. 在 `App.tsx` 中添加路由
3. 在侧边栏添加导航链接

## 📝 开发注意事项

1. **TypeScript**: 所有代码使用 TypeScript 编写
2. **响应式**: 支持桌面端和移动端
3. **状态管理**: 使用 React Hooks 管理状态
4. **API 调用**: 使用 fetch API 进行网络请求
5. **样式**: 使用 CSS 变量实现主题化

## 🐛 常见问题

### Q: 启动后台后访问 404
A: 确保访问的是 `http://localhost:5174/admin/` 而不是 `http://localhost:5174/`

### Q: 登录成功后跳转失败
A: 检查 localStorage 是否正确设置，确保浏览器未禁用 Cookie

### Q: 样式错乱
A: 确认 `src/styles.css` 已正确引入后台管理样式

### Q: 构建后资源加载失败
A: 检查 `vite.admin.config.ts` 中的 `base` 配置是否正确

## 📚 相关文档

- [项目总体说明](../README.md)
- [重构完成说明](../REFACTOR_COMPLETION.md)
- [API 接口文档](../cloudflare/server/README.md)

## 📄 许可证

Apache-2.0

---

**最后更新**: 2026-03-30
**版本**: v1.0.0
