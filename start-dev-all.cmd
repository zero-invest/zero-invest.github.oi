@echo off
chcp 65001 >nul
echo ========================================
echo   启动开发服务器 (前台 + 后台)
echo ========================================
echo.

REM 检查 Node.js 是否安装
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo [错误] 未检测到 Node.js，请先安装 Node.js v18+
    pause
    exit /b 1
)

echo [1/3] 检查依赖目录...
if not exist "node_modules" (
    echo [提示] 首次运行，正在安装依赖...
    call npm install
    if %errorlevel% neq 0 (
        echo [错误] 依赖安装失败
        pause
        exit /b 1
    )
)

echo [2/3] 启动前台开发服务器 (端口 5173)...
start "前台开发服务器" cmd /k "npm run dev"

timeout /t 3 /nobreak >nul

echo [3/3] 启动后台管理开发服务器 (端口 5174)...
start "后台管理服务器" cmd /k "npm run dev:admin"

echo.
echo ========================================
echo   启动完成!
echo ========================================
echo.
echo 前台地址：http://localhost:5173/
echo 后台地址：http://localhost:5174/admin/
echo.
echo 按任意键关闭此窗口 (不会关闭开发服务器)
pause >nul
