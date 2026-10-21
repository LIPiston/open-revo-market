# install-market.ps1 —— 一条命令安装「插件市场」到 OpenRevo 插件目录。
#
# 不需要 clone 仓库：默认从 GitHub 拉取 main 分支的现成产物（plugin-market/），
# 解压后复制到 %APPDATA%\OpenRevo\plugins\plugin-market\，然后自校验。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File _tools\install-market.ps1
#   ... -Local            从本仓库已入库的 plugin-market\ 安装（离线、可控）
#   ... -From <目录>      从指定目录安装（一般用于本地构建后验证）
#   ... -DryRun           只打印将要做什么，不下载、不写盘
#   ... -Repo owner/name  换仓库（默认 LIPiston/open-revo-market）
#
# 安装完：打开 OpenRevo → 侧边栏【插件】页 → 右上角【刷新】→ 顶栏出现「插件市场」页签。
#
# 注意 1：本文件是 UTF-8 带 BOM。Windows PowerShell 5.1 会把无 BOM 的 .ps1 按系统 ANSI
#         （中文机器上是 GBK）解读，UTF-8 中文可能吞掉后面的引号，导致整段语法报错。
#         改完必须复验：head -c3 _tools\install-market.ps1 | od -An -tx1 得到 ef bb bf。
# 注意 2：不用 param()，改用 $args —— 经 MSYS 调 powershell -File 时显式参数会被吃掉。

$ErrorActionPreference = 'Stop'

$Local  = $args -contains '-Local'
$DryRun = $args -contains '-DryRun'
$From   = $null
$Repo   = 'LIPiston/open-revo-market'

for ($i = 0; $i -lt $args.Count; $i++) {
    switch ($args[$i]) {
        '-From'   { $From = $args[$i + 1] }
        '-Repo'   { $Repo = $args[$i + 1] }
    }
}

$PluginId = 'plugin-market'
# $PSScriptRoot 只在「作为文件运行」时才有值；用 irm | iex 这种一行式执行时它是空的。
$Root = $null
if ($PSScriptRoot) { $Root = Split-Path -Parent $PSScriptRoot }

if (-not $env:APPDATA) { throw '找不到 %APPDATA% 环境变量，无法定位插件目录。' }
$PluginsDir = Join-Path $env:APPDATA 'OpenRevo\plugins'
$Dest       = Join-Path $PluginsDir $PluginId

# ---- 1. 决定来源 -----------------------------------------------------------
$Source = $null
if ($From) {
    $Source = (Resolve-Path -LiteralPath $From).Path
    Write-Output ("来源 : 指定目录 " + $Source)
}
elseif ($Local) {
    if (-not $Root) { throw '-Local 需要脚本文件在仓库里运行（irm | iex 方式拿不到仓库路径）。' }
    $Source = Join-Path $Root 'plugin-market'
    if (-not (Test-Path -LiteralPath (Join-Path $Source 'manifest.json'))) {
        throw ("本仓库没有已入库产物：" + $Source + "。先跑 python build_market.py 再试，或去掉 -Local 走在线下载。")
    }
    Write-Output ("来源 : 本地产物 " + $Source)
}
else {
    Write-Output ("来源 : https://github.com/" + $Repo + " （main 分支现成产物）")
}

Write-Output ("目标 : " + $Dest)
Write-Output ""

# ---- 2. 前置检查 -----------------------------------------------------------
if ($Root) {
    if ((Test-Path -LiteralPath (Join-Path $Root 'market')) -and (-not $Source)) {
        Write-Output '提示：当前目录里有仓库源码；更稳妥的做法是先 python build_market.py --install。'
        Write-Output ''
    }
}

if ($DryRun) {
    Write-Output '[DryRun] 将下载/解压并复制到目标目录，然后校验 manifest.json 与 index.html。'
    Write-Output '[DryRun] 未做任何改动。'
    exit 0
}

# ---- 3. 取来源（下载时自动剥离 codeload 的 <repo>-<branch>\ 包装层）-------
$TempDir = Join-Path ([System.IO.Path]::GetTempPath()) ('om-' + [Guid]::NewGuid().ToString('N').Substring(0, 8))
$NeedCleanup = $false
try {
    if (-not $Source) {
        $Zip  = Join-Path $TempDir 'main.zip'
        $Unzip = Join-Path $TempDir 'unzip'
        New-Item -ItemType Directory -Path $TempDir -Force | Out-Null
        $NeedCleanup = $true

        $Url = 'https://codeload.github.com/' + $Repo + '/zip/refs/heads/main'
        Write-Output ('下载 : ' + $Url)
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        Invoke-WebRequest -Uri $Url -OutFile $Zip -UseBasicParsing

        Write-Output '解压 ...'
        Expand-Archive -LiteralPath $Zip -DestinationPath $Unzip -Force

        # codeload 解压后固定多一层 <repo>-<branch>\ —— 这里剥掉它
        $Inner = Get-ChildItem -LiteralPath $Unzip -Directory | Select-Object -First 1
        if (-not $Inner) { throw '解压后没有目录，归档可能损坏。' }
        $Source = Join-Path $Inner.FullName $PluginId
    }

    if (-not (Test-Path -LiteralPath (Join-Path $Source 'manifest.json'))) {
        throw ("来源里没有 manifest.json：" + $Source)
    }
    if (-not (Test-Path -LiteralPath (Join-Path $Source 'index.html'))) {
        throw ("来源里没有 index.html（产物应为单文件）：" + $Source)
    }

    # ---- 4. 落盘 -----------------------------------------------------------
    if (Test-Path -LiteralPath $Dest) {
        Write-Output ('覆盖已装版本：' + $Dest)
        Remove-Item -LiteralPath $Dest -Recurse -Force
    }
    New-Item -ItemType Directory -Path $PluginsDir -Force | Out-Null
    Copy-Item -LiteralPath $Source -Destination $Dest -Recurse -Force

    # ---- 5. 自校验（别只看命令有没有报错）--------------------------------
    $Manifest = Get-Content -LiteralPath (Join-Path $Dest 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($Manifest.id -ne $PluginId) {
        throw ("manifest.json 的 id 不是 " + $PluginId + "，实际为：" + $Manifest.id)
    }
    $Html = Join-Path $Dest 'index.html'
    $Size = (Get-Item -LiteralPath $Html).Length
    if ($Size -lt 20000) {
        throw ("index.html 只有 " + $Size + " 字节，明显不是完整产物。")
    }

    Write-Output ''
    Write-Output ('已安装 : ' + $Dest)
    Write-Output ('版本   : ' + $Manifest.version + ' · ' + $Manifest.plugin_type + ' · index.html ' + $Size + ' 字节')
    Write-Output '下一步 : OpenRevo → 侧边栏【插件】页 → 右上角【刷新】→ 顶栏出现「插件市场」页签。'
}
finally {
    if ($NeedCleanup -and (Test-Path -LiteralPath $TempDir)) {
        Remove-Item -LiteralPath $TempDir -Recurse -Force -ErrorAction SilentlyContinue
    }
}
