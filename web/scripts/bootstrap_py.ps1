<#
  灵视医影 · 便携版 Python 引导脚本（Windows）
  ============================================
  用途：当服务器/电脑上完全没有 Python 3.8+ 时，把官方 embeddable 包
        解压到 -Target 目录，并给它装好 pip，供 启动服务.bat 接着安装 Flask 依赖。

  只做三件事：
    1) 从国内镜像下载 python-3.10.11-embed-amd64.zip（约 8 MB）
    2) 解压，并改写 python310._pth，让 site-packages 生效
    3) 用 get-pip.py 装 pip

  成功返回 0，失败返回 1 并打印原因。
#>
param(
    [string]$Target = ""
)

$ErrorActionPreference = "Stop"
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}

function Info([string]$m) { Write-Host ("       " + $m) -ForegroundColor DarkGray }
function Fail([string]$m) { Write-Host ("[错误] " + $m) -ForegroundColor Red; exit 1 }

# ---------- 目标目录 ----------
if ([string]::IsNullOrWhiteSpace($Target)) {
    $Target = Join-Path (Split-Path -Parent $PSScriptRoot) "runtime\python"
}
$Target = [IO.Path]::GetFullPath($Target)

$ver  = "3.10.11"
$arch = "amd64"
if (-not [Environment]::Is64BitOperatingSystem) { $arch = "win32" }
$name = "python-$ver-embed-$arch.zip"
$zip  = Join-Path $env:TEMP ("lsy-" + $name)
$py   = Join-Path $Target "python.exe"

$urls = @(
    "https://mirrors.huaweicloud.com/python/$ver/$name",
    "https://mirrors.aliyun.com/python-release/windows/$name",
    "https://registry.npmmirror.com/-/binary/python/$ver/$name",
    "https://www.python.org/ftp/python/$ver/$name"
)

# ---------- 0) 已经装过就直接用（上次装到一半也能接着用） ----------
if (Test-Path $py) {
    & $py -c "import pip, sys" 2>$null
    if ($LASTEXITCODE -eq 0) {
        Write-Host ("       已存在可用的便携版：" + $py) -ForegroundColor Green
        exit 0
    }
    Info "已有的便携版不完整，重新解压一份"
}

# ---------- 1) 下载 ----------
if (Test-Path $zip) { Remove-Item $zip -Force -ErrorAction SilentlyContinue }
$ok = $false
foreach ($u in $urls) {
    try {
        Info "下载 $u"
        Invoke-WebRequest -Uri $u -OutFile $zip -UseBasicParsing -TimeoutSec 180
        if ((Get-Item $zip).Length -gt 5MB) { $ok = $true; break }
    } catch {
        Info ("该源不可用：" + $_.Exception.Message)
    }
}
if (-not $ok) { Fail "便携版 Python 下载失败（4 个下载源都不可用，请检查服务器能否访问外网）" }

# ---------- 2) 解压 + 开启 site ----------
if (Test-Path $Target) { Remove-Item $Target -Recurse -Force -ErrorAction SilentlyContinue }
New-Item -ItemType Directory -Path $Target -Force | Out-Null
Expand-Archive -Path $zip -DestinationPath $Target -Force
Info ("已解压到 " + $Target)

$pth = Get-ChildItem -Path $Target -Filter "python*._pth" | Select-Object -First 1
if ($null -eq $pth) { Fail "压缩包里没有 _pth 文件，包结构异常" }
$zipInDir = Get-ChildItem -Path $Target -Filter "python3*.zip" | Select-Object -First 1
if ($null -eq $zipInDir) { Fail "压缩包里没有标准库 zip，包结构异常" }

# embeddable 默认既不加载 site-packages 也不执行 site，必须补齐，
# 否则 pip 装完以后 import flask 会失败（这是最常见的坑）
$lines = @($zipInDir.Name, ".", "Lib\site-packages", "import site")
Set-Content -Path $pth.FullName -Value $lines -Encoding ASCII
New-Item -ItemType Directory -Path (Join-Path $Target "Lib\site-packages") -Force | Out-Null
Info "已改写 $($pth.Name)：启用 site-packages 与 site"

# ---------- 3) 引导 pip ----------
$gp = Join-Path $env:TEMP "lsy-get-pip.py"
if (Test-Path $gp) { Remove-Item $gp -Force -ErrorAction SilentlyContinue }
$gpUrls = @(
    "https://mirrors.aliyun.com/pypi/get-pip.py",
    "https://bootstrap.pypa.io/get-pip.py"
)
$ok2 = $false
foreach ($u in $gpUrls) {
    try {
        Invoke-WebRequest -Uri $u -OutFile $gp -UseBasicParsing -TimeoutSec 120
        if ((Get-Item $gp).Length -gt 200KB) { $ok2 = $true; break }
    } catch {
        Info ("该源不可用：" + $_.Exception.Message)
    }
}
if (-not $ok2) { Fail "get-pip.py 下载失败，无法为便携版安装 pip" }

Info "正在为便携版安装 pip（约 30 秒）..."
& $py $gp --no-warn-script-location --disable-pip-version-check -i https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) {
    Info "清华源失败，改用官方源重试"
    & $py $gp --no-warn-script-location --disable-pip-version-check
}

& $py -c "import pip, sys; print('       python ' + sys.version.split()[0] + '  pip ' + pip.__version__)"
if ($LASTEXITCODE -ne 0) { Fail "pip 引导失败，请把上面的输出发出来" }

# 国内镜像上的 get-pip.py 版本偏旧（会装 pip 20.x），先升到新版，避免后面解析依赖出问题
Info "升级 pip 到最新版 ..."
& $py -m pip install --upgrade pip --disable-pip-version-check --no-warn-script-location -i https://pypi.tuna.tsinghua.edu.cn/simple
if ($LASTEXITCODE -ne 0) { Info "pip 升级失败，继续用旧版，可能仍能装依赖" }
& $py -c "import pip; print('       pip ' + pip.__version__)"

Write-Host "       便携版 Python 就绪" -ForegroundColor Green
exit 0
