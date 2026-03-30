# 🚀 快速开始指南

本文档帮助您快速启动和使用重构后的溢价率网站。

## 📋 目录

1. [环境准备](#环境准备)
2. [安装依赖](#安装依赖)
3. [启动开发服务器](#启动开发服务器)
4. [访问前台和后台](#访问前台和后台)
5. [构建生产版本](#构建生产版本)

---

## 环境准备

### 必需工具

- **Node.js**: v18.0.0 或更高版本
- **npm**: v8.0.0 或更高版本 (随 Node.js 一起安装)
- **Git**: 用于代码版本管理

### 检查安装

```bash
# 检查 Node.js 版本
node -v

# 检查 npm 版本
npm -v

# 检查 Git
git -v
```

如果未安装 Node.js，请前往 [https://nodejs.org/](https://nodejs.org/) 下载安装。

---

## 安装依赖

### 1. 克隆项目 (如果是首次)

```bash
git clone <your-repo-url>
cd 溢价率网站
```

### 2. 安装 npm 依赖

```bash
npm install
```

**预计耗时**: 2-5 分钟 (取决于网络状况)

**常见问题**:
- 如果下载缓慢，可配置淘宝镜像:
  ```bash
  npm config set registry https://registry.npmmirror.com
  ```

---

## 启动开发服务器

### 方式一：同时启动前台和后台 (推荐)

#### Windows

双击运行:
```
start-dev-all.cmd
```

或命令行执行:
```bash
start-dev-all.cmd
```

#### macOS / Linux

```bash
# 分别启动
npm run dev          # 前台
npm run dev:admin    # 后台
```

### 方式二：单独启动

#### 只启动前台

```bash
npm run dev
```

访问：http://localhost:5173

#### 只启动后台

```bash
npm run dev:admin
```

访问：http://localhost:5174/admin

---

## 访问前台和后台

### 前台页面

**地址**: http://localhost:5173

**功能**:
- ✅ 实时溢价率看板
- ✅ 基金分类展示 (QDII LOF / 国内 LOF / ETF)
- ✅ 基金详情页
- ✅ 离线研究图表
- ✅ 会员中心
- 📍 **新增**: 右上角显示数据同步时间

### 后台管理系统

**地址**: http://localhost:5174/admin

**本地测试登录**:
1. 访问 http://localhost:5174/admin/test-login.html
2. 输入测试账号:
   - 账号：`admin`
   - 密码：`admin123`
3. 点击登录

**功能模块**:
- 📊 **仪表盘**: 查看系统概览数据
- 👥 **用户管理**: 管理用户账号、封禁/解封、取消会员
- 🎫 **兑换码管理**: 批量生成兑换码、导出
- 💰 **赞赏审核**: 审核赞赏订单、发放会员、封禁违规用户
- 📈 **访客统计**: 查看访客趋势图表

---

## 构建生产版本

### 构建所有资源 (前台 + 后台)

```bash
npm run build
```

构建产物:
- `dist/` - 前台静态资源
- `dist/admin/` - 后台静态资源

### 仅构建前台

```bash
npm run build:site
```

### 仅构建后台

```bash
npm run build:admin
```

### 构建并预览

```bash
# 构建
npm run build

# 预览前台
npm run preview

# 预览后台
npm run preview:admin
```

---

## 部署到生产环境

### 方案一：GitHub Pages

```bash
# 构建
npm run build

# 部署
npm run deploy:pages
```

访问:
- 前台：https://yourusername.github.io/repo-name/
- 后台：https://yourusername.github.io/repo-name/admin/

### 方案二：自有服务器

1. 构建项目: `npm run build`
2. 将 `dist/` 目录上传到服务器
3. 配置 Nginx/Apache

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

### 方案三：独立子域名部署

**DNS 配置**:
```
www.example.com  → 服务器 IP
admin.example.com → 服务器 IP
```

**Nginx 配置**:

```nginx
# 前台
server {
    listen 80;
    server_name www.example.com;
    root /var/www/premium-site;
    
    location / {
        try_files $uri $uri/ /index.html;
    }
}

# 后台
server {
    listen 80;
    server_name admin.example.com;
    root /var/www/premium-site/admin;
    
    location / {
        try_files $uri $uri/ /admin/index.html;
    }
}
```

---

## 常用命令

### 数据同步

```bash
# 同步基金数据
npm run sync:data

# 完整同步 (数据 + 研究)
npm run sync:data:full

# 同步特定类型研究
npm run sync:research:oil      # 石油类
npm run sync:research:gold     # 黄金类
npm run sync:research:a-share  # A 股类
```

### 开发相关

```bash
# 启动开发服务器
npm run dev              # 前台
npm run dev:admin        # 后台
npm run dev:all          # 同时启动 (需手动)

# 构建
npm run build:site       # 构建前台
npm run build:admin      # 构建后台
npm run build            # 构建全部

# 预览
npm run preview          # 前台
npm run preview:admin    # 后台
```

### 管理功能

```bash
# 手动录入第三方溢价率
npm run manual:premium-entry

# 生成兑换码
npm run member:codes
```

---

## 故障排查

### 问题 1: 端口被占用

**错误信息**: `EADDRINUSE: address already in use`

**解决方案**:
```bash
# Windows: 查找并结束占用端口的进程
netstat -ano | findstr :5173
taskkill /PID <PID> /F

# macOS/Linux
lsof -ti:5173 | xargs kill -9
```

或使用不同端口:
```bash
# 修改 vite.config.ts 中的 server.port
```

### 问题 2: 依赖安装失败

**解决方案**:
```bash
# 删除 node_modules 和 package-lock.json
rm -rf node_modules package-lock.json

# 重新安装
npm install
```

### 问题 3: 构建失败

**常见原因**:
- TypeScript 类型错误
- 资源路径错误

**解决方案**:
```bash
# 检查 TypeScript 错误
npx tsc --noEmit

# 清理缓存
npm run build -- --force
```

### 问题 4: 后台管理 404

确保访问正确的路径:
- ✅ http://localhost:5174/admin/
- ❌ http://localhost:5174/

---

## 下一步

完成快速开始后，您可以:

1. 📖 阅读 [项目架构说明](./AI 项目说明.md) 了解系统架构
2. 🔧 查看 [重构完成说明](./REFACTOR_COMPLETION.md) 了解新功能
3. 📊 使用 [后台管理 README](./admin/README.md) 学习后台操作
4. 💻 开始开发自定义功能

---

## 获取帮助

如遇到问题:

1. 查看项目文档
2. 检查 GitHub Issues
3. 查看控制台错误信息
4. 确认 Node.js 和 npm 版本符合要求

---

**最后更新**: 2026-03-30  
**适用版本**: v1.0.0
