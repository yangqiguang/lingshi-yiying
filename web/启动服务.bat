@echo off
setlocal EnableExtensions EnableDelayedExpansion
title 灵视医影 · 统一后端（网页+App，端口 5000/5001）
cd /d "%~dp0server"

set "ROOT=%~dp0"
set "RTPY=%ROOT%runtime\python\python.exe"
set "PY="
set "CORE="
set "BASE="

rem /install 表示"只装环境、不启动服务"，供 安装Python.bat 调用
set "INSTALL_ONLY="
if /i "%~1"=="/install" set "INSTALL_ONLY=1"

echo ============================================================
echo   灵视医影 · 统一后端（网页+App 共用，Flask + SQLite）
echo   站点  http://127.0.0.1:5000/
echo   登录  http://127.0.0.1:5000/login.html
echo   运行期间请保持本窗口开启，按 Ctrl+C 停止
echo   首次使用可先双击 安装Python.bat 检查并安装运行环境
echo ============================================================
echo.

if not exist "app.py" goto :NOAPP

echo [1/4] 正在查找可用的 Python（3.8 及以上即可）...

rem 允许手动指定：把 python.exe 完整路径写进 server\python_path.txt
if exist "python_path.txt" (
  set "MANUAL="
  set /p MANUAL=<python_path.txt
  if defined MANUAL set MANUAL=!MANUAL:"=!
  if defined MANUAL call :cand "!MANUAL!"
)

rem 调试用：set LSY_FORCE_RUNTIME=1 可跳过本机所有 Python，强制走「下载便携版」流程
if "%LSY_FORCE_RUNTIME%"=="1" goto :SKIPSCAN

call :cand "%RTPY%"
if exist ".venv\Scripts\python.exe" call :cand ".venv\Scripts\python.exe"
if exist "..\..\..\ai-server\.venv\Scripts\python.exe" call :cand "..\..\..\ai-server\.venv\Scripts\python.exe"
call :cand py -3.13
call :cand py -3.12
call :cand py -3.11
call :cand py -3.10
call :cand py -3.9
call :cand py -3.8
call :cand py -3
call :cand python
call :cand python3
for /d %%D in ("%LOCALAPPDATA%\Programs\Python\Python3*") do call :cand "%%~fD\python.exe"
for /d %%D in ("%ProgramFiles%\Python3*") do call :cand "%%~fD\python.exe"
for /d %%D in ("%ProgramFiles(x86)%\Python3*") do call :cand "%%~fD\python.exe"
for /d %%D in ("C:\Python3*") do call :cand "%%~fD\python.exe"
if exist "%USERPROFILE%\anaconda3\python.exe" call :cand "%USERPROFILE%\anaconda3\python.exe"
if exist "%USERPROFILE%\miniconda3\python.exe" call :cand "%USERPROFILE%\miniconda3\python.exe"
if exist "%ProgramData%\anaconda3\python.exe" call :cand "%ProgramData%\anaconda3\python.exe"

:SKIPSCAN
if defined PY goto :ENVDONE
if defined CORE call :fixcore
if defined PY goto :ENVDONE
if defined BASE call :mkvenv
if defined PY goto :ENVDONE
call :getruntime
if defined PY goto :ENVDONE

echo.
echo [失败] 运行环境没准备好，请按上面的提示处理后重试。
echo.
pause
exit /b 1

:ENVDONE
if defined INSTALL_ONLY goto :ENVREPORT
goto :RUN

rem ============================================================
rem 环境汇报（/install 模式：装完就停，不启动服务）
rem ============================================================
:ENVREPORT
echo.
echo ============================================================
echo   环境已就绪
echo ------------------------------------------------------------
echo   解释器 : %PY%
%PY% check_env.py
echo ============================================================
echo   现在双击 启动服务.bat 即可开站，不会再下载任何东西。
echo.
exit /b 0

rem ============================================================
rem 启动
rem ============================================================
:RUN
echo.
echo ------------------------------------------------------------
echo   解释器 : %PY%
%PY% -V
echo ------------------------------------------------------------
netstat -ano | findstr /c:":5000" | findstr /i "LISTENING" >nul 2>nul
if not errorlevel 1 goto :PORTBUSY
goto :PORTOK

:PORTBUSY
echo [提示] 5000 端口已被占用，多半是上一次的服务还在跑。
echo        若接下来报 Address already in use：关掉旧的黑窗口，
echo        或在任务管理器里结束 python.exe 后重开本文件。
echo.

:PORTOK
call :fw
echo.
echo [访问] 本机        http://127.0.0.1:5000/login.html
echo        云服务器    http://服务器公网IP:5000/login.html
echo        阿里云/腾讯云还需在控制台「安全组」放行 TCP 5000
echo.
set "BR="
if exist "%ProgramFiles%\Microsoft\Edge\Application\msedge.exe" set "BR=1"
if exist "%ProgramFiles(x86)%\Microsoft\Edge\Application\msedge.exe" set "BR=1"
if exist "%ProgramFiles%\Google\Chrome\Application\chrome.exe" set "BR=1"
if exist "%ProgramFiles(x86)%\Google\Chrome\Application\chrome.exe" set "BR=1"
if defined LSY_NO_BROWSER goto :NOBROWSER
if defined BR start "" /min cmd /c "ping -n 4 127.0.0.1 >nul & explorer http://127.0.0.1:5000/login.html"
:NOBROWSER
echo [4/4] 正在启动服务 ...（保持本窗口开启，Ctrl+C 停止）
echo.
%PY% app.py
set "CODE=%ERRORLEVEL%"
echo.
if "%CODE%"=="0" goto :EXITOK
echo [已退出] 返回码 %CODE% —— 请把上面的报错原文发出来。
goto :EXITEND
:EXITOK
echo [已停止] 服务正常退出。
:EXITEND
echo.
pause
exit /b %CODE%

rem ============================================================
rem 以下是子程序，正常流程不会顺序执行到这里
rem ============================================================

:NOAPP
echo [错误] 没有找到 server\app.py，解压目录不完整。
echo        正确结构：
echo            WebProject\启动服务.bat
echo            WebProject\server\app.py
echo.
pause
exit /b 1

rem ------------------------------------------------------------
rem :cand  测试一个候选解释器
rem        参数可以是 "完整路径" 或 py -3.12 这种「启动器 + 参数」
rem ------------------------------------------------------------
:cand
if defined PY exit /b 0
set "C=%*"
%C% -c "import sys;sys.exit(0 if sys.version_info>=(3,8) else 1)" >nul 2>nul
if errorlevel 1 exit /b 0
%C% -c "import flask,werkzeug,itsdangerous,numpy,PIL,onnxruntime" >nul 2>nul
if not errorlevel 1 goto :cand_full
%C% -c "import flask,werkzeug,itsdangerous,numpy,PIL" >nul 2>nul
if not errorlevel 1 goto :cand_core
if not defined BASE set "BASE=%C%"
exit /b 0

:cand_full
set "PY=%C%"
exit /b 0

:cand_core
if not defined CORE set "CORE=%C%"
exit /b 0

rem ------------------------------------------------------------
rem :fixcore  有网站依赖但缺 onnxruntime，补装一下
rem ------------------------------------------------------------
:fixcore
echo [2/4] 找到可用解释器：%CORE%
echo       它缺 onnxruntime（影像 AI 分析要用），正在补装 ...
%CORE% -m pip install "onnxruntime>=1.15" --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60 --retries 2
%CORE% -c "import onnxruntime" >nul 2>nul
if errorlevel 1 goto :fc_vcrt
echo       补装成功
set "PY=%CORE%"
exit /b 0

:fc_vcrt
echo       装是装上了，但导入失败 —— 多半缺 VC++ 运行库（msvcp140.dll），正在自动补 ...
call :vcrt
%CORE% -c "import onnxruntime" >nul 2>nul
if errorlevel 1 goto :fc_fail
echo       补运行库后可以正常导入了
set "PY=%CORE%"
exit /b 0

:fc_fail
echo       [警告] onnxruntime 导入失败，真实报错如下：
%CORE% -c "import onnxruntime"
echo.
echo       若上面出现 "DLL load failed ... 找不到指定的模块"，
echo       说明这台机器缺 VC++ 2015-2022 运行库，装一次就好（装完不用改配置）：
echo         https://aka.ms/vs/17/release/vc_redist.x64.exe
echo       现在将以「无模型模式」启动：
echo       登录 / 档案 / 报告 / 审核全部正常，只有影像 AI 分析不可用。
set "PY=%CORE%"
exit /b 0

rem ------------------------------------------------------------
rem :vcrt  把包内自带的 VC++ 运行库补进运行时目录
rem       （onnxruntime 的 .pyd 依赖 msvcp140.dll，embeddable Python 不带它）
rem ------------------------------------------------------------
:vcrt
if not exist "%ROOT%scripts\redist\msvcp140.dll" exit /b 1
if not exist "%ROOT%runtime\python\python.exe" exit /b 1
copy /y "%ROOT%scripts\redist\*.dll" "%ROOT%runtime\python\" >nul 2>nul
exit /b 0


rem ------------------------------------------------------------
rem :mkvenv  有 Python 但没装依赖，建 .venv 再装
rem ------------------------------------------------------------
:mkvenv
echo [2/4] 找到 Python：%BASE%
echo       它还没装依赖，正在创建本地虚拟环境 server\.venv ...
%BASE% -m venv .venv >nul 2>nul
if exist ".venv\Scripts\python.exe" goto :mk_venvok
echo       [提示] 这个 Python 建不了虚拟环境（精简版/嵌入版），改为直接装在它自己身上。
set "PY=%BASE%"
call :doinstall
exit /b 0

:mk_venvok
set "PY=.venv\Scripts\python.exe"
call :doinstall
exit /b 0

rem ------------------------------------------------------------
rem :getruntime  本机完全没有 Python，下载便携版
rem ------------------------------------------------------------
:getruntime
echo [2/4] 本机没有可用的 Python，准备自动下载便携版（约 8 MB，只下这一次）
echo       下载源依次为：华为云 / 阿里云 / npmmirror / python.org
powershell -NoProfile -ExecutionPolicy Bypass -File "%ROOT%scripts\bootstrap_py.ps1" -Target "%ROOT%runtime\python"
if exist "%RTPY%" goto :gr_ok
echo.
echo [错误] 便携版 Python 没准备好，通常是这台机器访问不了外网。
echo        两种补救办法（任选一种）：
echo          A. 手动下载 python-3.10.11-embed-amd64.zip，解压到下面这个目录：
echo             %ROOT%runtime\python
echo             解压后该目录里必须直接有 python.exe
echo          B. 在别处装好 Python 3.10+，把它的 python.exe 完整路径
echo             写进 server\python_path.txt（一行，不要加引号）
echo        处理好后重新双击本文件即可。
exit /b 1

:gr_ok
rem 用相对路径当命令，绝对路径里可能带空格/括号，直接当命令会被 cmd 拆开
set "PY=..\runtime\python\python.exe"
echo       便携版就绪：%RTPY%
call :doinstall
exit /b 0

rem ------------------------------------------------------------
rem :doinstall  用 %PY% 安装依赖（含降级策略）
rem ------------------------------------------------------------
:doinstall
echo [3/4] 正在安装依赖（首次约 1-3 分钟，取决于网速，请耐心等）
%PY% -m pip install --upgrade pip --quiet --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60 >nul 2>nul
%PY% -m pip install -r requirements.txt --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60 --retries 2
if not errorlevel 1 goto :di_check
echo       清华源不通，改用阿里云源重试 ...
%PY% -m pip install -r requirements.txt --disable-pip-version-check -i https://mirrors.aliyun.com/pypi/simple --timeout 60 --retries 2
if not errorlevel 1 goto :di_check
echo       [提示] 完整依赖装不上，退一步只装核心包（不含 onnxruntime）...
%PY% -m pip install -r requirements-core.txt --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple --timeout 60 --retries 2
if errorlevel 1 goto :di_fail

:di_check
%PY% -c "import flask,werkzeug,itsdangerous,numpy,PIL" >nul 2>nul
if errorlevel 1 goto :di_broken
%PY% -c "import onnxruntime" >nul 2>nul
if not errorlevel 1 goto :di_ort_ok
rem 装上了但导不进来：补 VC++ 运行库再试一次
call :vcrt
%PY% -c "import onnxruntime" >nul 2>nul
if errorlevel 1 goto :di_noort
echo       补 VC++ 运行库后 onnxruntime 可用
goto :di_ort_ok

:di_ort_ok
echo       依赖就绪（含 onnxruntime，可跑真实影像推理）
exit /b 0

:di_noort
echo [警告] onnxruntime 导入失败，真实报错如下：
%PY% -c "import onnxruntime"
echo.
echo        若提示 "DLL load failed ... 找不到指定的模块"，装一次 VC++ 运行库即可：
echo          https://aka.ms/vs/17/release/vc_redist.x64.exe
echo        网站仍可正常使用，只有影像 AI 分析会提示「模型未就绪」。
exit /b 0

:di_fail
echo.
echo [错误] 依赖安装失败，网站起不来。请确认这台机器能访问 pypi，或手动执行：
echo        %PY% -m pip install -r requirements.txt
exit /b 1

:di_broken
echo.
echo [错误] 依赖装了却导不进来，请把上面 pip 的报错截图发出来。可手动执行：
echo        %PY% -m pip install -r requirements.txt
exit /b 1

rem ------------------------------------------------------------
rem :fw  管理员身份下顺手放行防火墙 5000（失败不提示）
rem ------------------------------------------------------------
:fw
net session >nul 2>nul
if errorlevel 1 exit /b 0
netsh advfirewall firewall show rule name="LSY-WEB-5000" >nul 2>nul
if not errorlevel 1 exit /b 0
netsh advfirewall firewall add rule name="LSY-WEB-5000" dir=in action=allow protocol=TCP localport=5000 >nul 2>nul
if not errorlevel 1 echo [OK] 已放行 Windows 防火墙 TCP 5000
netsh advfirewall firewall add rule name="LSY-WEB-5001" dir=in action=allow protocol=TCP localport=5001 >nul 2>nul
if not errorlevel 1 echo [OK] 已放行 Windows 防火墙 TCP 5001（旧 App 兼容）
exit /b 0
