# 真实宿主出图：把 open-revo 主窗口抓成 PNG。
#
# 只读操作 —— 不点击、不输入、不改窗口位置和大小。
# 唯一的动作是 ShowWindow(SW_RESTORE)：主窗口收成迷你面板或最小化时，
# 先还原到正常尺寸才能截到完整内容。
#
# 两个实测坑：
#   1. **必须 DPI-aware**。进程不声明感知时 GetWindowRect 返回虚拟化坐标，
#      和 CopyFromScreen 的物理像素对不上，截出来是错位的桌面。
#   2. **窗口句柄要枚举找**。`(Get-Process).MainWindowHandle` 在本机指向
#      一个 15×15 的陶窗口（Tao Thread Event Target），不是真窗口。
#
# 用法：
#   powershell -NoProfile -ExecutionPolicy Bypass -File tools\host-shot.ps1
#   powershell ... -File tools\host-shot.ps1 -Out _shots\after.png
param(
  [string]$Out = "D:\LIPis\Documents\code\openrevo-market\_shots\host-live.png",
  [switch]$Full    # 整屏截图（窗口位置可疑时用这个，不依赖窗口边界）
)
$ErrorActionPreference = "Stop"

# 本机 %TEMP% 不允许 CSC 写临时 dll，Add-Type 会直接失败 —— 换到工作区里。
$env:TEMP = Join-Path $PSScriptRoot "..\.tmp"
$env:TMP = $env:TEMP
New-Item -ItemType Directory -Force -Path $env:TEMP | Out-Null

$sig = @'
[DllImport("user32.dll")] public static extern bool EnumWindows(EnumProc cb, IntPtr p);
[DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
[DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetWindowTextW(IntPtr h, System.Text.StringBuilder s, int n);
[DllImport("user32.dll")] public static extern bool IsWindowVisible(IntPtr h);
[DllImport("user32.dll")] public static extern bool ShowWindow(IntPtr h, int c);
[DllImport("user32.dll")] public static extern bool SetForegroundWindow(IntPtr h);
[DllImport("dwmapi.dll")] public static extern int DwmGetWindowAttribute(IntPtr h, int attr, out RECT r, int size);
[DllImport("shcore.dll")] public static extern int SetProcessDpiAwareness(int v);
public delegate bool EnumProc(IntPtr h, IntPtr p);
public struct RECT { public int Left, Top, Right, Bottom; }
'@
$W = Add-Type -MemberDefinition $sig -Name U -Namespace HostShot -PassThru
[void][HostShot.U]::SetProcessDpiAwareness(2)   # PER_MONITOR_DPI_AWARE

$target = (Get-Process open-revo | Select-Object -First 1).Id

# 主窗口判据：同进程 + 标题含 OpenRevo + DWM 面积最大。
# DWM 的 extended frame bounds 才是真实可见边界（GetWindowRect 会被隐形边框骗）。
$best = [IntPtr]::Zero; $bestArea = 0
$cb = [HostShot.U+EnumProc]{
  param($h, $p)
  $pid2 = 0
  [void][HostShot.U]::GetWindowThreadProcessId($h, [ref]$pid2)
  if ($pid2 -eq $script:target) {
    $sb = New-Object System.Text.StringBuilder 512
    [void][HostShot.U]::GetWindowTextW($h, $sb, 512)
    if ($sb.ToString() -match 'OpenRevo') {
      $r = New-Object HostShot.U+RECT
      if ([HostShot.U]::DwmGetWindowAttribute($h, 9, [ref]$r, 16) -eq 0) {
        $a = ($r.Right - $r.Left) * ($r.Bottom - $r.Top)
        if ($a -gt $script:bestArea) { $script:bestArea = $a; $script:best = $h }
      }
    }
  }
  return $true
}
[void][HostShot.U]::EnumWindows($cb, [IntPtr]::Zero)
if ($best -eq [IntPtr]::Zero) { throw "没找到 open-revo 主窗口" }

# 迷你面板 / 最小化时 RESTORE 回正常尺寸再截
[void][HostShot.U]::ShowWindow($best, 9)   # SW_RESTORE
[void][HostShot.U]::ShowWindow($best, 5)   # SW_SHOW
[void][HostShot.U]::SetForegroundWindow($best)
Start-Sleep -Milliseconds 1500

$r = New-Object HostShot.U+RECT
[void][HostShot.U]::DwmGetWindowAttribute($best, 9, [ref]$r, 16)

Add-Type -AssemblyName System.Drawing, System.Windows.Forms

if ($Full) {
  # 整屏：DWM 边界和真实渲染位置对不上时（实测迷你面板会被放到屏幕外），
  # 只截窗口会拿到错位的半张图，整屏反而准。
  $b = [System.Windows.Forms.Screen]::PrimaryScreen.Bounds
  $bmp = New-Object System.Drawing.Bitmap $b.Width, $b.Height
  $g = [System.Drawing.Graphics]::FromImage($bmp)
  $g.CopyFromScreen($b.X, $b.Y, 0, 0, $bmp.Size)
  $g.Dispose()
  $bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
  $bmp.Dispose()
  Write-Output ("saved {0} ({1} bytes)  fullscreen={2}x{3}  window={4},{5} {6}x{7}" -f `
    $Out, (Get-Item $Out).Length, $b.Width, $b.Height,
    $r.Left, $r.Top, ($r.Right - $r.Left), ($r.Bottom - $r.Top))
  return
}

$w = $r.Right - $r.Left; $h2 = $r.Bottom - $r.Top
if ($w -le 0 -or $h2 -le 0) { throw "窗口尺寸异常：${w}x${h2}" }

$bmp = New-Object System.Drawing.Bitmap $w, $h2
$g = [System.Drawing.Graphics]::FromImage($bmp)
$g.CopyFromScreen($r.Left, $r.Top, 0, 0, $bmp.Size)
$g.Dispose()
$bmp.Save($Out, [System.Drawing.Imaging.ImageFormat]::Png)
$bmp.Dispose()

Write-Output ("saved {0} ({1} bytes)  rect={2},{3} {4}x{5}" -f `
  $Out, (Get-Item $Out).Length, $r.Left, $r.Top, $w, $h2)
