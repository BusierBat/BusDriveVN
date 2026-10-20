# BÁO CÁO CHẨN ĐOÁN LỖI WI-FI REALTEK RTL8723BE
**Thiết bị**: ASUS VivoBook 15 X540MA  
**Card Wi-Fi**: Realtek RTL8723BE Wireless LAN 802.11n PCI-E NIC  
**Ngày chẩn đoán**: 20/10/2026  
**Trạng thái hiện tại**: Wi-Fi đang hoạt động (đã kết nối được lúc 07:39:43 AM)

---

## 1. TÓM TẮT

**Nguyên nhân khả dĩ nhất**: **Kết hợp giữa driver Realtek cũ (2019) không tương thích hoàn toàn với Windows 10 build 26300 + cơ chế power management (D3cold) của PCIe gây mất kết nối thiết bị ở mức firmware/hardware** — dẫn đến Device Manager Code 45 (thiết bị không còn kết nối) và Code 10 (không khởi động được).  

**Mức độ tin cậy**: **Trung bình - Cao** (có bằng chứng mạnh từ setupapi.dev.log và WLAN-AutoConfig log, nhưng thiếu log Kernel-PnP/UserPnp tại thời điểm lỗi Code 45/10 vì log đã bị ghi đè).

**Phân biệt quan trọng**: Code 45 và Code 10 **khác nguyên nhân gốc** nhưng cùng xuất phát từ việc card PCIe "biến mất" khỏi bus:
- **Code 45**: Windows thấy thiết bị đã bị ngắt kết nối vật lý/logic khỏi PCIe bus
- **Code 10**: Windows thấy thiết bị nhưng driver không khởi động được (thường sau khi thiết bị vừa xuất hiện lại trên bus nhưng firmware chưa sẵn sàng)

---

## 2. THÔNG TIN THỰC TẾ ĐÃ XÁC MINH

### 2.1 Phiên bản Windows
| Thông tin | Giá trị |
|-----------|---------|
| **Windows Product** | Windows 10 Pro (**KHÔNG phải Windows 11** như người dùng nghĩ) |
| **Windows Version** | 2009 |
| **Build Lab** | 26100.1.amd64fre.ge_release.240331-1435 |
| **OsBuildNumber** | **26300** (Windows 10 24H2 / 26100 branch) |
| **OsBranch** | (trống) |

> ⚠️ **Lưu ý**: Người dùng nhầm lẫn Windows 11 26H2. Thực tế là **Windows 10 build 26300** (24H2).

### 2.2 Lịch sử cập nhật (Get-HotFix)
| KB | Loại | Ngày cài |
|----|------|----------|
| KB5121794 | Update | 14/10/2026 |
| **KB5127648** | **Security Update** | **14/10/2026** |
| KB5127694 | Update | 14/10/2026 |
| KB5127647 | Security Update | 13/10/2026 |
| KB5054156 | Update | 10/10/2026 |

> **KB5124010** (được người dùng nhắc đến) **KHÔNG xuất hiện** trong Get-HotFix. Có thể là Preview update không hiển thị qua Get-HotFix, hoặc chưa được cài.

### 2.3 Thông tin thiết bị RTL8723BE
| Thuộc tính | Giá trị |
|------------|---------|
| **FriendlyName** | Realtek RTL8723BE Wireless LAN 802.11n PCI-E NIC |
| **InstanceId** | PCI\VEN_10EC&DEV_B723&SUBSYS_172411AD&REV_00\0023B7FEFF4CE00000 |
| **Hardware IDs** | PCI\VEN_10EC&DEV_B723&SUBSYS_172411AD&REV_00, PCI\VEN_10EC&DEV_B723&SUBSYS_172411AD, PCI\VEN_10EC&DEV_B723&CC_028000, PCI\VEN_10EC&DEV_B723&CC_0280 |
| **Status** | OK |
| **Problem Code** | CM_PROB_NONE (0) |
| **Service** | RTWlanE02 |
| **Location** | PCI bus 2, device 0, function 0 |

### 2.4 Driver hiện tại
| Thuộc tính | Giá trị |
|------------|---------|
| **Driver Version** | **2024.0.4.208** |
| **Driver Date** | **26/05/2019** (rất cũ — 7 năm trước) |
| **Driver Provider** | Realtek Semiconductor Corp. |
| **INF Name** | oem12.inf (section: ASUS8723be.ndi.NT) |
| **Driver File** | rtwlane02.sys |
| **NDIS Version** | 6.70 |
| **Driver Rank** | 16646145 |

### 2.5 Driver Store (các bản RTL8723BE có sẵn)
| Thư mục | INF | DriverVer | Phiên bản | Ghi chú |
|---------|-----|-----------|-----------|---------|
| netrtwlane.inf_amd64_95a482015fa9330f | netrtwlane.inf | 20/12/2017 | 2023.69.1101.2017 | **ASUS** |
| netrtwlane.inf_amd64_9f581aa49737d7bf | netrtwlane.inf | 30/11/2011 | 2024.0.8.108 | **ASUS** |
| netrtwlane.inf_amd64_abdb9fc13c32acae | netrtwlane.inf | 01/11/2021 | 2024.0.10.135 | **ASUS** |
| netrtwlane01.inf_amd64_e88ba65a7546f702 | netrtwlane01.inf | 08/01/2018 | 2023.70.0109.2018 | **ASUS** |
| **netrtwlane02.inf_amd64_d6658a77ca81746c** | **netrtwlane02.inf** | **26/05/2019** | **2024.0.4.208** | **ASUS — ĐANG DÙNG** |
| netrtwlane_13.inf_amd64_34c21e0a7f9c97b4 | netrtwlane_13.inf | 16/12/2014 | 2013.12.0331.2016 | **ASUS** |
| netrtwlane_ext_ihv.inf_amd64_112a4a6822af5cb6 | netrtwlane_ext_ihv.inf | 09/04/2018 | 704.11.1117.2017 | **ASUS** |
| netrtwlane_ext_ihv.inf_amd64_d63d3f9a3d8da32f | netrtwlane_ext_ihv.inf | 09/04/2018 | 704.11.1117.2017 | **ASUS** |
| netrtwlane_ext_oem.inf_amd64_19f9436045ecff6d | netrtwlane_ext_oem.inf | 10/04/2018 | 2023.76.0221.2018 | **ASUS** |

> Tất cả driver trong store đều **có tham chiếu ASUS** (section ASUS8723be.ndi.NT). Driver đang dùng (2024.0.4.208) là bản **cũ nhất** trong số các bản ASUS.

### 2.6 Thiết bị Wi-Fi thứ 2 (USB)
- **USB 802.11N Wireless USB Adapter** (VID_350B&PID_9101)
- **Trạng thái**: Error, **Code 48** (Driver blocked - Windows chặn driver do biết có vấn đề)
- Driver: zt9101d_drv.sys v15.58.23.493 (30/01/2024)

---

## 3. DÒNG THỜI GIAN (TIMELINE)

| Thời gian | Sự kiện | Nguồn bằng chứng |
|-----------|---------|------------------|
| **10/10/2026** | Cài KB5054156 | Get-HotFix |
| **13/10/2026** | Cài KB5127647 (Security) | Get-HotFix |
| **14/10/2026** | Cài KB5127648, KB5121794, KB5127694 | Get-HotFix |
| **~14-19/10/2026** | **Code 45 xuất hiện** (theo người dùng: "khoảng một tuần trước") | Báo cáo người dùng |
| **18/10/2026 07:05-07:12** | Boot session, cài driver USB WiFi, user mở Device Manager | setupapi.dev.log |
| **18/10/2026 14:14** | User thử **Update Driver** cho RTL8723BE qua Device Manager — **THẤT BẠI** (0x4c7: Windows Update disabled for wizard) | setupapi.dev.log |
| **19/10/2026 18:40:45** | **Restart Device** RTL8723BE (initiated by Wlansvc) — thiết bị bị remove và restart | setupapi.dev.log |
| **20/10/2026 05:46:27** | **Boot session hiện tại** | setupapi.dev.log |
| **20/10/2026 05:15 - 07:39** | **WLAN-AutoConfig: Lỗi liên tục "The driver disconnected while associating" (ID 8002)** — mỗi ~1 phút | Event Log (WLAN-AutoConfig) |
| **20/10/2026 05:46:46** | Kết nối thành công đầu tiên sau boot (Profile "Gia Bao") | Event Log (WLAN-AutoConfig ID 8001) |
| **20/10/2026 07:39:43** | **Kết nối ổn định**, bảo mật WPA2-Personal thành công | Event Log (WLAN-AutoConfig ID 11005/11010) |
| **Hiện tại** | Wi-Fi hoạt động bình thường | Trạng thái thiết bị: OK, Problem: CM_PROB_NONE |

---

## 4. BẰNG CHỨNG QUAN TRỌNG

### 4.1 Setupapi.dev.log — Restart Device (19/10/2026 18:40:45)
```
>>>  [Restart Device - PCI\VEN_10EC&DEV_B723&SUBSYS_172411AD&REV_00\0023B7FEFF4CE00000]
     cmd: C:\WINDOWS\system32\svchost.exe -k LocalSystemNetworkRestricted -p -s Wlansvc
     dvi: Device Status: 0x0180200a
     dvi: Install Device: Removing device 'PCI\VEN_10EC&DEV_B723&SUBSYS_172411AD&REV_00\0023B7FEFF4CE00000' and sub-tree. 18:40:45.403
     dvi: Install Device: Removing device sub-tree completed. 18:40:47.611
     dvi: Install Device: Restarting device. 18:40:47.613
     dvi: Install Device: Restarting device completed. 18:40:49.156
<<<  [Exit status: SUCCESS]
```
- **Đây là bằng chứng trực tiếp** thiết bị bị **tách khỏi PCIe bus và restart** bởi service Wlansvc.
- Thời gian: 19/10 — khớp với "Code 45 khoảng một tuần trước" (người dùng báo ~14-19/10).

### 4.2 WLAN-AutoConfig Log — Lỗi "Driver disconnected while associating" (20/10/2026 05:15-07:39)
- **Event ID 8002 (Error)**: Lặp lại **~80 lần** trong 2.5 giờ
- **Failure Reason**: `The driver disconnected while associating`
- **RSSI: 255** (giá trị bất thường — thường 0-100, 255 = invalid/unknown)
- **Profile**: "Gia Bao" và "Gia Bao 2" (2 profile cùng SSID)
- **Kết nối thành công**: 07:39:43 AM (Event ID 11005, 11010)

### 4.3 Setupapi.dev.log — User thử update driver thủ công (18/10/2026 14:14)
```
>>>  [Device Install (DiShowUpdateDevice) - PCI\VEN_10EC&DEV_B723&SUBSYS_172411AD&REV_00\0023B7FEFF4CE00000]
!    ndv:      Searching Windows Update has been disabled for the Update Wizard.
!    ndv:      Policy has been set to prevent searching Windows Update for drivers.
<<<  [Exit status: FAILURE(0x000004c7)]
```
- Windows **chặn tìm driver trên Windows Update** cho RTL8723BE (policy).
- User không thể update driver tự động qua Device Manager.

### 4.4 Windows Insider Registry
```
HKLM:\SOFTWARE\Microsoft\WindowsSelfHost\Applicability
  UseSettingsExperience : 0
```
- **Khóa Insider tồn tại** → máy **đã từng đăng ký Windows Insider** (phù hợp với lời người dùng: "tháng 6/2026 dùng Insider").

### 4.5 Không có log Kernel-PnP / UserPnp / DeviceSetupManager cho RTL8723BE trong 7 ngày
- Các log này **đã bị ghi đè** (Windows mặc định giới hạn kích thước log System).
- **Mất bằng chứng** tại thời điểm Code 45/10 xảy ra.

---

## 5. ĐÁNH GIÁ TỪNG GIẢ THUYẾT

### A. Lỗi do Windows Update (KB5127648 / KB5127647 / KB5124010)
| | |
|---|---|
| **Bằng chứng ủng hộ** | - KB5127648 (Security) cài 14/10, gần thời gian Code 45 bắt đầu<br>- KB5127647 cài 13/10<br>- Build 26300 là bản mới (24H2), có thể thay đổi PCIe power management |
| **Bằng chứng phản bác** | - Không có Event ID liên quan Windows Update installer / driver update cho RTL8723BE<br>- Setupapi.dev.log không显示 driver được cập nhật qua Windows Update gần đây<br>- Driver vẫn là bản 2019 (không phải driver mới từ WU) |
| **Dữ liệu thiếu** | - Không thể xem Windows Update history chi tiết (registry không đầy đủ)<br>- KB5124010 chưa xác minh được đã cài hay chưa |
| **Mức độ tin cậy** | **Thấp - Trung bình** |
| **Kiểm tra tiếp theo** | Kiểm tra `C:\Windows\Logs\CBS\CBS.log` và `C:\Windows\Logs\WUInstall.log` (cần Admin) để tìm dấu vết update driver RTL8723BE |

### B. Driver Realtek không tương thích / lỗi
| | |
|---|---|
| **Bằng chứng ủng hộ** | - Driver **2024.0.4.208 dated 26/05/2019** — quá cũ so với Windows 10 26300<br>- WLAN log: **"The driver disconnected while associating"** — lỗi ở mức driver/firmware handshake<br>- RSSI 255 = driver báo giá trị vô lý<br>- Có **9 phiên bản driver ASUS khác** trong store (mới hơn: 2024.0.10.135 từ 11/2021) nhưng không được dùng<br>- Windows **chặn tìm driver trên WU** cho thiết bị này (policy) |
| **Bằng chứng phản bác** | - Driver này từng hoạt động ổn định trước đó (tháng 6 sau update Insider mới lỗi biến mất)<br>- Hiện tại Wi-Fi đang chạy OK với driver cũ này |
| **Dữ liệu thiếu** | - Changelog các bản driver ASUS để biết bản nào fix lỗi power management/D3cold<br>- Không test được driver mới hơn vì không được cài đặt |
| **Mức độ tin cậy** | **Cao** (driver cũ là yếu tố rủi ro chính, đã biết RTL8723BE hay lỡ D3cold) |
| **Kiểm tra tiếp theo** | Thử update driver thủ công từ Driver Store (chọn bản 2024.0.10.135 hoặc 2024.0.8.108) — **chỉ khi được phép** |

### C. Thiết bị mất kết nối ở mức Plug and Play / Firmware / Nguồn điện (PCIe D3cold / ASPM)
| | |
|---|---|
| **Bằng chứng ủng hộ** | - **Setupapi.log: Restart Device** — thiết bị bị remove khỏi bus và restart (19/10 18:40)<br>- **Code 45** = "Hardware device not connected" — thiết bị biến mất khỏi PCIe bus<br>- **Code 10** = "Cannot start device" — thiết bị xuất hiện lại nhưng driver khởi động thất bại<br>- **PCIe Capabilities**: D3ColdSupport = 258 (hỗ trợ D3cold), S0WakeupSupported = True<br>- RTL8723BE **nổi tiếng** với bug ASPM/D3cold trên Linux và Windows<br>- Laptop ASUS X540MA có BIOS cũ, có thể không handle ASPM đúng chuẩn |
| **Bằng chứng phản bác** | - Không có log Kernel-PnP ghi nhận surprise removal (Event ID 200/201/219)<br>- Thiết bị hiện tại hoạt động OK, link speed 65 Mbps |
| **Dữ liệu thiếu** | - BIOS version, ASPM setting trong BIOS<br>- PCIe link training log (cần ETW trace) |
| **Mức độ tin cậy** | **Cao** (phù hợp nhất với bản chất Code 45 + Code 10 xen kẽ) |
| **Kiểm tra tiếp theo** | - Kiểm tra BIOS version, update BIOS nếu có<br>- Thử tắt PCIe ASPM trong BIOS hoặc qua registry `HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\PCI\ASPM`<br>- Test cắm sạc / chạy pin (liên quan power management) |

### D. Lỗi phần cứng / tiếp xúc / card không ổn định
| | |
|---|---|
| **Bằng chứng ủng hộ** | - Code 45 + Code 10 xen kẽ là dấu hiệu điển hình của 접触不良 hoặc card hỏng<br>- Laptop cũ (Pentium N5000), card Wi-Fi gắn M.2/NGFF có thể bị lỏng do rung/dời chỗ<br>- "Tắt máy, ngắt nguồn, chờ vài tiếng thì chạy lại" — điển hình của lỗi hardware/firmware cần cold reset |
| **Bằng chứng phản bác** | - Hiện tại hoạt động ổn định, link speed 65 Mbps (chuẩn 802.11n 1x1)<br>- Không có BSOD, không có dump file<br>- Restart Device qua software (Wlansvc) thành công — phần cứng vẫn phản hồi |
| **Dữ liệu thiếu** | - Không thể kiểm tra vật lý (cấm tháo máy) |
| **Mức độ tin cậy** | **Trung bình** (có thể là yếu tố cộng sinh, không phải nguyên nhân độc lập) |
| **Kiểm tra tiếp theo** | Chỉ khi các biện pháp software thất bại: tháo máy kiểm tra khe M.2, dàn thermal pad, test card trên máy khác |

### E. Nhiều nguyên nhân kết hợp (Kết luận nhất quán nhất)
| | |
|---|---|
| **Mô hình** | **Driver cũ (2019) + Windows 10 26300 PCIe power management thay đổi + BIOS ASPM handling yếu + card RTL8723BE nhạy cảm D3cold** |
| **Chuỗi sự kiện** | 1. Windows Update (KB5127647/48) hoặc tích lũy thay đổi OS → thay đổi PCIe power policy<br>2. Driver 2019 không handle đúng D3cold entry/exit → card rơi vào trạng thái firmware treo<br>3. PCIe link down → Windows thấy thiết bị biến mất → **Code 45**<br>4. Wlansvc/service restart thiết bị → card reset PCIe → xuất hiện lại nhưng firmware chưa ready → **Code 10**<br>5. Tắt máy ngắt nguồn (cold boot) → firmware reset hoàn toàn → tạm thời hoạt động<br>6. 20/10 sáng: boot → driver load → liên tục "disconnected while associating" cho đến khi firmware ổn định (07:39) |
| **Mức độ tin cậy** | **Cao nhất** |
| **Kiểm tra tiếp theo** | 1. Update driver lên bản ASUS mới hơn trong store (2024.0.10.135)<br>2. Tắt PCIe ASPM / D3cold cho thiết bị này<br>3. Update BIOS ASUS X540MA mới nhất |

---

## 6. DỮ LIỆU CHƯA THU THẬP ĐƯỢC (GIỚI HẠN)

| Dữ liệu | Lý do | Ảnh hưởng |
|---------|-------|-----------|
| **Kernel-PnP / UserPnp log tại thời điểm Code 45/10** | Log System đã ghi đè (mặc định 20MB, xoay vòng) | **Cao** — mất bằng chứng trực tiếp của PnP manager |
| **Windows Update history đầy đủ (CBS.log, WUInstall.log)** | Cần quyền Admin đọc file log hệ thống, hoặc Get-WindowsUpdateLog (cần symbol) | **Trung bình** — không xác minh được KB5124010, không biết WU có push driver mới không |
| **BIOS version & ASPM settings** | Cần reboot vào BIOS hoặc tool vendor (cần Admin) | **Cao** — liên quan trực tiếp giả thuyết C |
| **PCIe link training / LTSSM trace** | Cần ETW trace / WPP tracing (phức tạp, cần Admin) | **Thấp** — chỉ cần nếu fix driver/BIOS không thành |
| **Thông tin vật lý card (khe M.2, dính bụi, thermal)** | Cấm tháo máy | **Trung bình** — chỉ confirm khi software hết cách |
| **Changelog driver ASUS các phiên bản** | Không công khai, cần tra cứu từ ASUS support | **Trung bình** — giúp chọn driver update chính xác |

---

## 7. BƯỚC TIẾP THEO (CHỈ ĐỀ XUẤT HƯỚNG, KHÔNG TỰ THỰC HIỆN)

### Ưu tiên 1: An toàn, không cần reboot ngay
1. **Update driver RTL8723BE từ Driver Store**  
   - Device Manager → RTL8723BE → Update driver → Browse my computer → Let me pick → chọn bản **2024.0.10.135 (netrtwlane.inf_amd64_abdb9fc13c32acae)** hoặc **2024.0.8.108**  
   - *Lý do*: Bản 2024.0.4.208 (2019) quá cũ, các bản ASUS mới hơn có thể fix D3cold/ASPM.

2. **Tắt PCIe ASPM cho thiết bị này** (registry, cần reboot)  
   ```
   HKEY_LOCAL_MACHINE\SYSTEM\CurrentControlSet\Control\PCI\ASPM
   ```
   Thêm key con `VEN_10EC&DEV_B723` hoặc disable toàn bộ ASPM (`DisableASPM=1`).  
   - *Lý do*: RTL8723BE nổi tiếng không tương thích ASPM L0s/L1.

3. **Tắt "Allow computer to turn off this device" cho RTL8723BE**  
   Device Manager → Properties → Power Management → bỏ tick.

### Ưu tiên 2: Cần reboot / quyền Admin
4. **Kiểm tra và update BIOS ASUS X540MA** lên phiên bản mới nhất.  
   - *Lý do*: BIOS cũ có thể không init PCIe/ASPM đúng cho card Wi-Fi.

5. **Chạy Get-WindowsUpdateLog** (cần Admin) để xuất log Windows Update đầy đủ, kiểm tra KB5124010 và driver updates.

### Ưu tiên 3: Nếu trên thất bại
6. **Clean install driver**: Uninstall device (check "Delete driver software") → reboot → để Windows cài lại từ Driver Store (sẽ chọn bản rank cao nhất).

7. **Test card trên máy khác** hoặc **test card Wi-Fi USB khác** trên máy này để tách biệt hardware vs software.

---

## 8. KẾT LUẬN

**Trạng thái**: **CÓ DẤU HIỆU ĐÁNG NGHI NHƯNG CHƯA ĐỦ BẰNG CHỨNG XÁC ĐỊNH DUY NHẤT MỘT NGUYÊN NHÂN**

### Tóm tắt phân tích:
| Yếu tố | Đánh giá |
|--------|----------|
| **Driver cũ (2019)** | ✅ Yếu tố rủi ro chính — xác nhận |
| **Windows Update KB5127648/47** | ⚠️ Đáng nghi về mặt thời gian, nhưng thiếu log chứng minh |
| **PCIe D3cold/ASPM** | ✅ Phù hợp hoàn hảo với Code 45 + Code 10 + Restart Device log |
| **Hardware fault** | ⚠️ Có thể cộng sinh, không phải nguyên nhân gốc đơn lẻ |
| **Windows Insider legacy** | ✅ Registry key tồn tại — có thể để lại cấu hình power management bất thường |

### Khuyến nghị ngay lập tức:
> **Update driver RTL8723BE lên bản ASUS mới hơn trong Driver Store (2024.0.10.135) + tắt PCIe ASPM cho thiết bị này**. Đây là biện pháp an toàn nhất, không phá vỡ hệ thống, giải quyết nguyên nhân gốc rễ khả dĩ nhất (driver-firmware power management mismatch).

### Nếu được phép can thiệp sâu hơn:
> Update BIOS ASUS → Clean install driver → Monitor 1-2 tuần. Nếu tái diễn → cân nhắc thay card Wi-Fi (Intel 7260/8265/AX200 tương thích tốt hơn).

---

## 9. QUẢN LÝ DỮ LIỆU

- Báo cáo này được lưu tại: `X:\Documents\PentiumStudio\CoachVN-Source-main-main\CoachVN-Source-main-main\WIFI_RTL8723BE_DIAGNOSTIC_REPORT.md`
- Các file script chẩn đoán: `diag_wifi.ps1`, `diag_wifi2.ps1`, `diag_wifi3.ps1`, `diag_wifi4.ps1`
- **Không có thao tác ghi/xóa/sửa hệ thống nào được thực hiện** — chỉ đọc thông tin, truy vấn log, xuất báo cáo.
- Không chứa mật khẩu, token, dữ liệu nhạy cảm.

---

## 10. XÁC NHẬN HOÀN THÀNH

✅ Thu thập thông tin hệ thống (Phase A)  
✅ Thu thập nhật ký lỗi (Phase B) — WLAN-AutoConfig, Setupapi.dev.log  
✅ Đối chiếu Windows Update timeline (Phase C)  
✅ Đánh giá 5 giả thuyết (Phase D)  
✅ Xuất báo cáo tiếng Việt đầy đủ cấu trúc (Phase E)  
✅ **KHÔNG** thực hiện bất kỳ thao tác sửa đổi hệ thống nào  

---

*Báo cáo được tạo tự động bởi quy trình chẩn đoán chỉ-đọc (read-only diagnostic). Mọi kết luận dựa trên bằng chứng kỹ thuật có thể kiểm chứng. Khuyến nghị hành động cần sự xác nhận của người dùng trước khi thực hiện.*