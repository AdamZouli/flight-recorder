$ErrorActionPreference = "SilentlyContinue"

if (-not ("FgWin" -as [type])) {
  Add-Type @"
using System;
using System.Runtime.InteropServices;
public static class FgWin {
  [DllImport("user32.dll")] public static extern IntPtr GetForegroundWindow();
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr hWnd, out uint lpdwProcessId);
}
"@
}

$cpuCount = [Environment]::ProcessorCount
$fgPid = [uint32]0
$hwnd = [FgWin]::GetForegroundWindow()
[void][FgWin]::GetWindowThreadProcessId($hwnd, [ref]$fgPid)
$fgName = $null
try { $fgName = (Get-Process -Id $fgPid).ProcessName } catch {}

$procs = @(Get-Process | ForEach-Object {
  [pscustomobject]@{
    pid = $_.Id
    name = $_.ProcessName
    ws = [int64]$_.WorkingSet64
    cpu = if ($null -eq $_.CPU) { $null } else { [double]$_.CPU }
  }
})

[pscustomobject]@{
  cpuCount = $cpuCount
  foreground = [pscustomobject]@{ pid = [int]$fgPid; name = $fgName }
  processes = $procs
} | ConvertTo-Json -Compress -Depth 5
