# Phase A continued: More detailed driver and device info
Write-Host "=== DETAILED DRIVER PROPERTIES FOR RTL8723BE ==="
$wifiDev = Get-PnpDevice -Class Net | Where-Object { $_.FriendlyName -like '*RTL8723*' }
if ($wifiDev) {
    $props = Get-PnpDeviceProperty -InstanceId $wifiDev.InstanceId
    $props | Where-Object { 
        $_.KeyName -like '*Driver*' -or 
        $_.KeyName -like '*Date*' -or 
        $_.KeyName -like '*Version*' -or
        $_.KeyName -like '*Provider*' -or
        $_.KeyName -like '*InfPath*'
    } | Format-Table KeyName, Type, Data -AutoSize
}

Write-Host "`n=== RTL8723BE PCI DEVICE PROPERTIES ==="
$props = Get-PnpDeviceProperty -InstanceId $wifiDev.InstanceId
$props | Where-Object { $_.KeyName -like '*PciDevice*' -or $_.KeyName -like '*Location*' } | Format-Table KeyName, Type, Data -AutoSize

Write-Host "`n=== WINDOWS UPDATE HISTORY (from registry) ==="
# Check Windows Update history
$wuPath = "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\Results\Install"
if (Test-Path $wuPath) {
    Get-ItemProperty $wuPath | Select-Object LastSuccessTime, LastInstallationSuccessTime, LastAttemptedInstallationTime
}

Write-Host "`n=== SETUP LOG FOR RECENT UPDATES ==="
# Check setupapi.dev.log for driver install events
$setupLog = "C:\Windows\INF\setupapi.dev.log"
if (Test-Path $setupLog) {
    $content = Get-Content $setupLog -Tail 2000
    $content | Select-String -Pattern "RTL8723|RTWlanE|Realtek.*Wireless|PCI\\VEN_10EC.*DEV_B723" | Select-Object -Last 20
}

Write-Host "`n=== DRIVER STORE INFO ==="
# Check driver store for RTL8723BE
$driverStore = "C:\Windows\System32\DriverStore\FileRepository"
if (Test-Path $driverStore) {
    Get-ChildItem $driverStore -Directory | Where-Object { $_.Name -like '*rtl*' -or $_.Name -like '*realtek*' -or $_.Name -like '*rtwlane*' } | ForEach-Object {
        $infFiles = Get-ChildItem $_.FullName -Filter "*.inf"
        foreach ($inf in $infFiles) {
            $infContent = Get-Content $inf.FullName -Raw
            if ($infContent -like "*RTL8723*" -or $infContent -like "*RTWlanE*") {
                Write-Host "Found RTL8723BE driver in: $($_.FullName)"
                Write-Host "INF: $($inf.Name)"
                # Extract version
                if ($infContent -match 'DriverVer\s*=\s*(\d+/\d+/\d+),\s*([\d.]+)') {
                    Write-Host "DriverVer: $($matches[1]), $($matches[2])"
                }
            }
        }
    }
}

Write-Host "`n=== WLAN AUTOCONFIG SERVICE STATUS ==="
Get-Service Wlansvc | Format-List

Write-Host "`n=== NETWORK ADAPTER CONFIGURATION ==="
Get-NetAdapter | Where-Object { $_.Name -like "*RTL8723*" -or $_.Name -like "*Realtek*" -or $_.Name -like "*Wireless*" } | Format-List Name, InterfaceDescription, Status, LinkSpeed, DriverVersion, DriverDate, NdisVersion