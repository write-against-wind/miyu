param([switch]$Portable)
$ErrorActionPreference = 'Stop'
Add-Type @'
using System;
using System.Text;
using System.Collections.Generic;
using System.Runtime.InteropServices;
public static class MiyuSmokeWindows {
  public delegate bool EnumWindowProc(IntPtr hwnd, IntPtr param);
  [DllImport("user32.dll")] static extern bool EnumWindows(EnumWindowProc cb, IntPtr param);
  [DllImport("user32.dll")] static extern uint GetWindowThreadProcessId(IntPtr hwnd, out uint pid);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] static extern int GetWindowText(IntPtr hwnd, StringBuilder text, int count);
  [DllImport("user32.dll")] static extern bool PostMessage(IntPtr hwnd, uint msg, IntPtr wp, IntPtr lp);
  public static string Check(int processId, bool close) {
    var titles = new List<string>();
    EnumWindows((hwnd, param) => {
      uint pid; GetWindowThreadProcessId(hwnd, out pid);
      if (pid == processId) {
        var text = new StringBuilder(512); GetWindowText(hwnd, text, 512);
        if (text.Length > 0) titles.Add(text.ToString());
        if (close && text.ToString() == "密屿 · 本地密码本") PostMessage(hwnd, 0x0010, IntPtr.Zero, IntPtr.Zero);
      }
      return true;
    }, IntPtr.Zero);
    return String.Join(" | ", titles);
  }
}
'@
$appVersion = (Get-Content -LiteralPath (Join-Path $PSScriptRoot '..\package.json') -Raw | ConvertFrom-Json).version
$relativeExe = if ($Portable) { "..\dist\Miyu-Vault-$appVersion-x64.exe" } else { '..\dist\win-unpacked\密屿密码本.exe' }
$packagedExe = (Resolve-Path (Join-Path $PSScriptRoot $relativeExe)).Path
$smokeProcess = Start-Process -FilePath $packagedExe -WindowStyle Hidden -PassThru
$windowProcess = if ($Portable) { $null } else { $smokeProcess }
try {
  $ready = $false
  for ($attempt = 0; $attempt -lt 120; $attempt++) {
    Start-Sleep -Milliseconds 250
    $smokeProcess.Refresh()
    if ($smokeProcess.HasExited) { throw 'Packaged app exited before loading' }
    if (-not $windowProcess) {
      $child = Get-CimInstance Win32_Process -Filter ("ParentProcessId = " + $smokeProcess.Id) | Where-Object Name -eq '密屿密码本.exe' | Select-Object -First 1
      if ($child) { $windowProcess = Get-Process -Id $child.ProcessId }
    }
    if (-not $windowProcess) { continue }
    $titles = [MiyuSmokeWindows]::Check($windowProcess.Id, $false)
    if ($titles.Contains('密屿 · 本地密码本')) { $ready = $true; break }
  }
  if (-not $ready) { throw ('Unexpected window titles: ' + $titles) }
  $report = [pscustomobject]@{ Loaded = $ready; Portable = [bool]$Portable; Title = $titles; Product = (Get-Item -LiteralPath $packagedExe).VersionInfo.ProductName }
  $report | ConvertTo-Json -Compress
  $null = [MiyuSmokeWindows]::Check($windowProcess.Id, $true)
  if (-not $smokeProcess.WaitForExit(10000)) { throw 'Packaged app did not close' }
  if ($smokeProcess.ExitCode -ne 0) { throw ('Nonzero exit code: ' + $smokeProcess.ExitCode) }
  $report | ConvertTo-Json | Set-Content -LiteralPath (Join-Path $PSScriptRoot '..\test-results\packaged-report.json') -Encoding utf8
} finally {
  if ($windowProcess -and -not $windowProcess.HasExited) { Stop-Process -Id $windowProcess.Id -Force }
  if (-not $smokeProcess.HasExited) { Stop-Process -Id $smokeProcess.Id -Force }
}
