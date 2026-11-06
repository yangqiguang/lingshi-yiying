@echo off
setlocal EnableExtensions
title 灵视医影 · 安装 Python 运行环境
cd /d "%~dp0"

echo ============================================================
echo   灵视医影 · Python 运行环境安装（首次一次性）
echo ------------------------------------------------------------
echo   装到本目录的 runtime\python（绿色版：不写注册表、不改 PATH、
echo   不需要管理员权限，删掉这个文件夹就等于卸载）
echo.
echo   如果本机已经有能用的 Python，会直接复用，不重复下载。
echo   全程约 1-3 分钟，取决于服务器带宽。
echo ============================================================
echo.

call "%~dp0启动服务.bat" /install
set "CODE=%ERRORLEVEL%"
echo.
if not "%CODE%"=="0" echo [失败] 环境没装好，请把上面的报错原文发出来。
if "%CODE%"=="0" echo [完成] 环境安装成功，现在可以双击 启动服务.bat 开站。
echo.
pause
exit /b %CODE%
