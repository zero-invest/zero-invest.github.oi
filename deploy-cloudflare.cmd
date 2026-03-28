@echo off
chcp 65001 >nul
echo.
echo ========================================
echo   Cloudflare Pages 本地部署工具
echo ========================================
echo.
echo 正在执行部署...
echo.

cd /d "%~dp0"
node scripts/deploy-pages.mjs

if %ERRORLEVEL% EQU 0 (
    echo.
    echo ========================================
    echo   部署成功！
    echo ========================================
    echo.
    echo 按任意键退出...
    pause >nul
) else (
    echo.
    echo ========================================
    echo   部署失败！
    echo ========================================
    echo.
    echo 请检查上方错误信息
    echo.
    echo 常见问题：
    echo 1. 未登录 Cloudflare - 运行: npx wrangler login
    echo 2. 网络连接问题
    echo 3. 构建错误
    echo.
    pause
)
