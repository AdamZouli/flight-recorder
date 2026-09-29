param(
  [int]$Port = 7842
)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$base = "http://127.0.0.1:$Port"
$notify = New-Object System.Windows.Forms.NotifyIcon
$notify.Text = "Flight Recorder"
$notify.Visible = $true
$notify.Icon = [System.Drawing.SystemIcons]::Information

function Open-Timeline {
  Start-Process "$base/"
}

$menu = New-Object System.Windows.Forms.ContextMenuStrip
$open = $menu.Items.Add("Open timeline")
$open.Add_Click({ Open-Timeline })
$pause = $menu.Items.Add("Pause recording")
$pause.Add_Click({
  try { Invoke-RestMethod -Method POST -Uri "$base/api/pause" | Out-Null } catch {}
})
$resume = $menu.Items.Add("Resume recording")
$resume.Add_Click({
  try { Invoke-RestMethod -Method POST -Uri "$base/api/resume" | Out-Null } catch {}
})
$quit = $menu.Items.Add("Quit tray")
$quit.Add_Click({
  $notify.Visible = $false
  [System.Windows.Forms.Application]::Exit()
})

$notify.ContextMenuStrip = $menu
$notify.Add_DoubleClick({ Open-Timeline })
$notify.ShowBalloonTip(2500, "Flight Recorder", "Timeline is running on port $Port", [System.Windows.Forms.ToolTipIcon]::Info)

[System.Windows.Forms.Application]::Run()
$notify.Dispose()
