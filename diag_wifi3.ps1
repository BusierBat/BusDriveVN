# Phase B: Event Log Collection
Write-Host "=== SYSTEM EVENT LOG - Kernel-PnP (last 7 days) ==="
$filter = @{
    LogName = 'System'
    ProviderName = @('Kernel-PnP', 'Microsoft-Windows-Kernel-PnP')
    StartTime = (Get-Date).AddDays(-7)
}
Get-WinEvent -FilterHashtable $filter -MaxEvents 200 -ErrorAction SilentlyContinue | 
    Where-Object { $_.Message -like '*RTL8723*' -or $_.Message -like '*RTWlanE*' -or $_.Message -like '*VEN_10EC*' -or $_.Message -like '*B723*' -or $_.Message -like '*Wireless*' } |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message | Format-List

Write-Host "`n=== SYSTEM EVENT LOG - UserPnp (last 7 days) ==="
$filter = @{
    LogName = 'System'
    ProviderName = 'Microsoft-Windows-UserPnp'
    StartTime = (Get-Date).AddDays(-7)
}
Get-WinEvent -FilterHashtable $filter -MaxEvents 200 -ErrorAction SilentlyContinue | 
    Where-Object { $_.Message -like '*RTL8723*' -or $_.Message -like '*RTWlanE*' -or $_.Message -like '*VEN_10EC*' -or $_.Message -like '*B723*' -or $_.Message -like '*Wireless*' -or $_.Message -like '*Code 10*' -or $_.Message -like '*Code 45*' } |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message | Format-List

Write-Host "`n=== SYSTEM EVENT LOG - DeviceSetupManager (last 7 days) ==="
$filter = @{
    LogName = 'Microsoft-Windows-DeviceSetupManager/Operational'
    StartTime = (Get-Date).AddDays(-7)
}
Get-WinEvent -FilterHashtable $filter -MaxEvents 200 -ErrorAction SilentlyContinue | 
    Where-Object { $_.Message -like '*RTL8723*' -or $_.Message -like '*RTWlanE*' -or $_.Message -like '*VEN_10EC*' -or $_.Message -like '*B723*' -or $_.Message -like '*Wireless*' } |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message | Format-List

Write-Host "`n=== SYSTEM EVENT LOG - WLAN-AutoConfig (last 7 days) ==="
$filter = @{
    LogName = 'Microsoft-Windows-WLAN-AutoConfig/Operational'
    StartTime = (Get-Date).AddDays(-7)
}
Get-WinEvent -FilterHashtable $filter -MaxEvents 200 -ErrorAction SilentlyContinue | 
    Where-Object { $_.Message -like '*RTL8723*' -or $_.Message -like '*RTWlanE*' -or $_.Message -like '*VEN_10EC*' -or $_.Message -like '*B723*' -or $_.Message -like '*Code 10*' -or $_.Message -like '*Code 45*' } |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message | Format-List

Write-Host "`n=== SYSTEM EVENT LOG - All System events related to Code 10/45 (last 30 days) ==="
$filter = @{
    LogName = 'System'
    StartTime = (Get-Date).AddDays(-30)
}
Get-WinEvent -FilterHashtable $filter -MaxEvents 500 -ErrorAction SilentlyContinue | 
    Where-Object { $_.Message -like '*Code 10*' -or $_.Message -like '*Code 45*' -or $_.Message -like '*Code 48*' -or $_.Message -like '*device not connected*' -or $_.Message -like '*cannot start*' } |
    Select-Object TimeCreated, Id, LevelDisplayName, ProviderName, Message | Format-List

Write-Host "`n=== SETUPAPI.DEV.LOG - Full search for RTL8723BE events ==="
$setupLog = "C:\Windows\INF\setupapi.dev.log"
if (Test-Path $setupLog) {
    $content = Get-Content $setupLog -Raw
    # Search for RTL8723BE device instance
    $matches = [regex]::Matches($content, '(?s)(?=.*PCI\\VEN_10EC&DEV_B723&SUBSYS_172411AD&REV_00\\0023B7FEFF4CE00000).*?(?=\n>>> |\Z)')
    foreach ($m in $matches) {
        Write-Host $m.Value
        Write-Host "---"
    }
}

Write-Host "`n=== SETUPAPI.DEV.LOG - Recent events (last 500 lines) ==="
if (Test-Path $setupLog) {
    Get-Content $setupLog -Tail 500 | Select-String -Pattern "RTL8723|RTWlanE|VEN_10EC.*B723|Code 10|Code 45|Code 48|device not|cannot start|failed" | Select-Object -Last 30
}