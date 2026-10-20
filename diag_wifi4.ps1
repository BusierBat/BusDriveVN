# Phase A continued: More Windows Update and system info
Write-Host "=== WINDOWS UPDATE HISTORY FROM REGISTRY ==="
# Windows Update history from multiple registry locations
$paths = @(
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\Results\Install",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Auto Update\Results\Detect",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\Installer\UserSettings",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\Uninstall"
)
foreach ($path in $paths) {
    if (Test-Path $path) {
        Write-Host "Path: $path"
        Get-ItemProperty $path | Format-List
    }
}

Write-Host "`n=== RELIABILITY MONITOR DATA (WMI) ==="
try {
    Get-CimInstance -Namespace "root\wmi" -ClassName "ReliabilityMonitor" -ErrorAction SilentlyContinue | Format-List
} catch {
    Write-Host "ReliabilityMonitor WMI not available"
}

Write-Host "`n=== DRIVER PACKAGES IN DRIVER STORE (RTL8723BE) ==="
$driverStore = "C:\Windows\System32\DriverStore\FileRepository"
Get-ChildItem $driverStore -Directory | Where-Object { $_.Name -like '*rtl*' -or $_.Name -like '*realtek*' -or $_.Name -like '*rtwlane*' } | ForEach-Object {
    Write-Host "Directory: $($_.Name)"
    $infFiles = Get-ChildItem $_.FullName -Filter "*.inf"
    foreach ($inf in $infFiles) {
        $infContent = Get-Content $inf.FullName -Raw
        if ($infContent -match 'DriverVer\s*=\s*(\d+/\d+/\d+),\s*([\d.]+)') {
            Write-Host "  INF: $($inf.Name) - DriverVer: $($matches[1]), Version: $($matches[2])"
        }
        # Check for ASUS specific section
        if ($infContent -like "*ASUS*") {
            Write-Host "  *** Contains ASUS references ***"
        }
    }
}

Write-Host "`n=== CURRENTLY LOADED DRIVERS FOR RTL8723BE ==="
Get-WmiObject Win32_SystemDriver | Where-Object { $_.Name -like '*RTWlan*' -or $_.Name -like '*rtl*' -or $_.DisplayName -like '*Realtek*Wireless*' } | Format-Table Name, DisplayName, State, StartMode, PathName -AutoSize

Write-Host "`n=== NETWORK ADAPTER DETAILED CONFIG ==="
Get-NetAdapter -Name "*" | Where-Object { $_.InterfaceDescription -like "*RTL8723*" -or $_.InterfaceDescription -like "*Realtek*Wireless*" } | Format-List *

Write-Host "`n=== POWER MANAGEMENT SETTINGS FOR RTL8723BE ==="
$wifiDev = Get-PnpDevice -Class Net | Where-Object { $_.FriendlyName -like '*RTL8723*' }
if ($wifiDev) {
    $props = Get-PnpDeviceProperty -InstanceId $wifiDev.InstanceId
    $props | Where-Object { $_.KeyName -like '*Power*' -or $_.KeyName -like '*D3*' -or $_.KeyName -like '*Wake*' } | Format-Table KeyName, Type, Data -AutoSize
}

Write-Host "`n=== PCI DEVICE POWER CAPABILITIES ==="
$props = Get-PnpDeviceProperty -InstanceId $wifiDev.InstanceId
$props | Where-Object { $_.KeyName -like '*PciDevice*D3*' -or $_.KeyName -like '*PciDevice*S0*' -or $_.KeyName -like '*PciDevice*Wake*' } | Format-Table KeyName, Type, Data -AutoSize

Write-Host "`n=== CHECK FOR PREVIOUS WINDOWS INSIDER BUILDS ==="
# Check if there are any Insider-related registry keys
$insiderPaths = @(
    "HKLM:\SOFTWARE\Microsoft\WindowsSelfHost\Applicability",
    "HKLM:\SOFTWARE\Microsoft\Windows\CurrentVersion\WindowsUpdate\FlightSettings"
)
foreach ($path in $insiderPaths) {
    if (Test-Path $path) {
        Write-Host "Path: $path"
        Get-ItemProperty $path | Format-List
    } else {
        Write-Host "Path not found: $path"
    }
}

Write-Host "`n=== SYSTEM UPTIME AND LAST BOOT TIME ==="
$os = Get-CimInstance Win32_OperatingSystem
Write-Host "LastBootUpTime: $($os.ConvertToDateTime($os.LastBootUpTime))"
Write-Host "LocalDateTime: $($os.ConvertToDateTime($os.LocalDateTime))"
$uptime = (Get-Date) - $os.ConvertToDateTime($os.LastBootUpTime)
Write-Host "Uptime: $($uptime.Days) days $($uptime.Hours) hours $($uptime.Minutes) minutes"

Write-Host "`n=== CHECK FOR DUMP FILES (BSOD/crash) ==="
$dumpPaths = @("C:\Windows\MEMORY.DMP", "C:\Windows\Minidump")
foreach ($path in $dumpPaths) {
    if (Test-Path $path) {
        $items = Get-ChildItem $path -ErrorAction SilentlyContinue
        if ($items) {
            $items | ForEach-Object { Write-Host "Dump: $($_.FullName) - $($_.LastWriteTime) - $($_.Length) bytes" }
        } else {
            Write-Host "No dump files in $path"
        }
    } else {
        Write-Host "Path not found: $path"
    }
}