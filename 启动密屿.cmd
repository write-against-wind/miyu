@echo off
setlocal
chcp 65001 >nul
cd /d "%~dp0"
set ELECTRON_RUN_AS_NODE=
if exist "node_modules\electron\dist\electron.exe" (
  start "" "node_modules\electron\dist\electron.exe" "%~dp0."
  exit /b
)
for /f "delims=" %%F in ('dir /b /a-d /o-d "dist\Miyu-Vault-*-x64.exe" 2^>nul') do (
  start "" "dist\%%F"
  exit /b
)
echo 找不到程序。请将密屿便携版放入 dist 文件夹，或先运行 npm ci 安装开发依赖。
pause
