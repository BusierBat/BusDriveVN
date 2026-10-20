# Phase A: System Information Collection
Write-Host "=== WINDOWS VERSION INFO ==="
Get-ComputerInfo | Select-Object WindowsProductName, WindowsVersion, WindowsBuildLabEx, OsBuildNumber, OsBranch, OsInstallDateUtc | Format-List

Write-Host "`n=== HOTFIXES / UPDATES ==="
Get-HotFix | Sort-Object InstalledOn -Descending | Select-Object HotFixID, Description, InstalledOn | Format-Table -AutoSize

Write-Host "`n=== WIFI DEVICE INFO ==="
$wifiDevices = Get-PnpDevice -Class Net | Where-Object { $_.FriendlyName -like '*RTL8723*' -or $_.FriendlyName -like '*Realtek*' -or $_.FriendlyName -like '*Wireless*' }
$wifiDevices | Format-List

Write-Host "`n=== DETAILED WIFI DEVICE PROPERTIES ==="
foreach ($dev in $wifiDevices) {
    Write-Host "Device: $($dev.FriendlyName) - InstanceId: $($dev.InstanceId)"
    Get-PnpDeviceProperty -InstanceId $dev.InstanceId | Format-Table -AutoSize
}

Write-Host "`n=== DRIVER INFO (WMI) ==="
Get-CimInstance Win32_PnPSignedDriver | Where-Object { $_.DeviceName -like '*RTL8723*' -or $_.DeviceName -like '*Realtek*Wireless*' } | Select-Object DeviceName, DriverVersion, DriverDate, DriverProviderName, InfName | Format-List

Write-Host "`n=== HARDWARE IDs AND PROBLEM CODES ==="
foreach ($dev in $wifiDevices) {
    Write-Host "Device: $($dev.FriendlyName)"
    $props = Get-PnpDeviceProperty -InstanceId $dev.InstanceId
    $props | Where-Object { $_.KeyName -like '*HardwareID*' -or $_.KeyName -like '*DeviceInstanceId*' -or $_.KeyName -like '*Problem*' -or $_.KeyName -like '*Status*' } | Format-Table KeyName, StringData, UInt32Data -AutoSize
}

Write-Host "`n=== ALL NETWORK DEVICES ==="
Get-PnpDevice -Class Net | Format-Table Status, Class, FriendlyName, InstanceId -AutoSize