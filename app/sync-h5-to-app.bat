@echo off
REM ============================================================
REM  Sync h5\  (source, edit here)  ->  hybrid\html\  (packed into the APK)
REM  Both folders hold exactly the same files now, so a plain copy is enough.
REM  Run this after every edit of h5\.
REM ============================================================
cd /d "%~dp0"

if not exist "h5\index.html" goto :noh5

echo Syncing h5  ->  hybrid\html ...

copy /Y "h5\index.html"     "hybrid\html\index.html"     >nul
copy /Y "h5\app.js"         "hybrid\html\app.js"         >nul
copy /Y "h5\app.css"        "hybrid\html\app.css"        >nul
copy /Y "h5\config.js"      "hybrid\html\config.js"      >nul
copy /Y "h5\app-bridge.js"  "hybrid\html\app-bridge.js"  >nul
xcopy /Y /E /I /Q "h5\assets" "hybrid\html\assets" >nul

echo.
echo Done.  h5\ and hybrid\html\ are now in sync.
echo Next step: open HBuilderX and run / build as usual.
echo.
pause
exit /b 0

:noh5
echo [ERROR] h5\index.html not found. Put this .bat in the project root.
pause
exit /b 1
