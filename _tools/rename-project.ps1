# rename-project.ps1 —— 把本仓库目录改名为 open-revo-market。
#
# 为什么需要脚本：Windows 不允许 rename 一个正被别的进程持有目录句柄（或当作 CWD）的目录，
# 直接 mv / ren 会报 "Device or resource busy" 或「另一个程序正在使用此文件，进程无法访问。」。
# 本脚本会先列出把该目录当 CWD 的进程、多次重试、失败时给出明确的下一步，成功后自校验文件数。
#
# 用法（先把打开本目录的程序关掉：DSH NEXT、VS Code、资源管理器窗口、终端）：
#   powershell -NoProfile -ExecutionPolicy Bypass -File _tools\rename-project.ps1
#   ... 加 -Force 可跳过重试（只试一次）
#
# 注意 1：本文件是 UTF-8 带 BOM。Windows PowerShell 5.1 会把无 BOM 的 .ps1 按系统 ANSI
#         （中文机器上是 GBK）解读，UTF-8 的中文一旦让落单的引导字节吞掉后面的引号，
#         就会整段报「意外的标记」——改本文件后务必确认 BOM 还在（见 pitfalls.md #16）：
#         head -c3 _tools\rename-project.ps1 | od -An -tx1 必须得到 ef bb bf。
# 注意 2：不用 param()，改用 $args —— 经 MSYS 调 powershell -File 时显式参数会被参数转换吃掉。
# 注意 3：本脚本就是 pitfalls.md #36 的「改名标准动作」。它必须在项目**外面**执行 ——
#         Windows 拒绝 rename 任何进程的当前工作目录，包括你自己这条命令的 shell。

$Force = $false
if ($args -contains '-Force') { $Force = $true }

$root    = Split-Path -Parent $PSScriptRoot          # 仓库根 = _tools 的上一级
$parent  = Split-Path -Parent $root
$oldName = Split-Path -Leaf $root
$newName = 'open-revo-market'
$newPath = Join-Path $parent $newName

Write-Output ("当前目录 : " + $root)
Write-Output ("目标目录 : " + $newPath)
Write-Output ""

if ($oldName -eq $newName) {
    Write-Output ("已经叫 " + $newName + " 了，无需改名。")
    exit 0
}
if (Test-Path -LiteralPath $newPath) {
    Write-Output ("!! 目标已存在：" + $newPath)
    Write-Output "   先确认它是残留还是真项目，再决定删除或改名，不要盲目覆盖。"
    exit 2
}

$before = (Get-ChildItem -LiteralPath $root -Recurse -File -Force | Measure-Object).Count
Write-Output ("改名前的文件数：" + $before)

$locks = Join-Path $PSScriptRoot 'who-locks.ps1'
if (Test-Path -LiteralPath $locks) {
    Write-Output ""
    Write-Output "--- 把该目录当作 CWD 的进程（为空不等于没被占：句柄占用不会出现在这里）---"
    & $locks $root
    Write-Output ""
}

$tries = 5
if ($Force) { $tries = 1 }
$ok = $false
for ($i = 1; $i -le $tries; $i++) {
    try {
        Rename-Item -LiteralPath $root -NewName $newName -ErrorAction Stop
        $ok = $true
        break
    } catch {
        Write-Output ("第 " + $i + "/" + $tries + " 次失败：" + $_.Exception.Message)
        if ($i -lt $tries) { Start-Sleep -Seconds 3 }
    }
}

if (-not $ok) {
    Write-Output ""
    Write-Output "改名失败。目录被别的进程占着，按顺序处理："
    Write-Output "  1. 关掉 DSH NEXT —— 它是本会话的宿主，会监听工作区目录"
    Write-Output "  2. 关掉所有打开本目录的 VS Code / 资源管理器窗口 / 终端"
    Write-Output "  3. 等几秒让 Windows Search 索引器放手，再重跑本脚本"
    Write-Output "  4. 仍不行：在管理员 PowerShell 里跑 handle.exe 或 openfiles /query 查持有者"
    Write-Output "     （未提权时无法枚举系统句柄表，这一步必须提权）"
    exit 1
}

$after = (Get-ChildItem -LiteralPath $newPath -Recurse -File -Force | Measure-Object).Count
Write-Output ""
Write-Output ("改名成功：" + $root)
Write-Output ("      ->  " + $newPath)
Write-Output ("文件数：" + $before + " -> " + $after)
if ($before -ne $after) {
    Write-Output "!! 文件数不一致，请人工核对后再继续。"
    exit 3
}
Write-Output ""
Write-Output "下一步：任何指向旧路径的会话 / IDE 都要从新路径重新打开。"
