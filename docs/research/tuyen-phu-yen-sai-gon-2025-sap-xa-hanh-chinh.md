# BÁO CÁO NGHIÊN CỨU — Tuyến xe khách Phú Yên → Sài Gòn sau sáp nhập hành chính 2025

> **Ngày lập báo cáo:** 30/09/2026 (dữ liệu cập nhật tới tháng 9/2026)
> **Mục đích:** dùng làm dữ liệu tham chiếu cho BusDriveVN (mô phỏng lái xe khách Việt Nam).
> **Nguyên tắc:** mọi khẳng định đều kèm URL nguồn. Không xác minh được thì ghi rõ **KHÔNG XÁC MINH ĐƯỢC** kèm những gì đã tìm.
> **Quy ước:** `phường` / `xã` / `đặc khu` là cấp hành chính mới (sau 1/7/2025). Cấp huyện **không còn tồn tại**.

---

## GHI CHÚ QUAN TRỌNG: 5 GIẢ ĐỊNH SAI CẦN SỬA

Trước khi đọc tiếp, cần nói thẳng 5 chỗ mà giả định ban đầu của dự án là **không đúng** so với văn bản và dữ liệu thực tế:

| Giả định sai | Thực tế | Nguồn |
|---|---|---|
| Phú Yên giữ thành tỉnh riêng | **Phú Yên sáp nhập vào Đắk Lắk**. Tỉnh Đắk Lắk mới có 18.096,40 km², 3.346.853 dân | [en.wikipedia – Đắk Lắk](https://en.wikipedia.org/wiki/%C4%90%E1%BA%AFk_L%E1%BA%AFk_province) |
| Bình Thuận nhập vào Đồng Nai | **Bình Thuận sáp nhập vào Lâm Đồng** (Lâm Đồng mới 24.233,07 km², 3.872.999 dân). Tỉnh bị Đồng Nai hấp thụ là **Bình Phước** | [en.wikipedia – Bình Thuận](https://en.wikipedia.org/wiki/B%C3%ACnh_Thu%E1%BA%ADn_province), [en.wikipedia – Lâm Đồng](https://en.wikipedia.org/wiki/L%C3%A2m_%C4%90%E1%BB%93ng_province) |
| Nghị quyết sáp nhập có hiệu lực 1/7/2025 | **NQ 202/2025/QH15 thông qua 12/6/2025, hiệu lực 12/6/2025**. 1/7/2025 là ngày **chính thức vận hành** chính quyền tỉnh mới (sau kỳ họp HĐND đầu tiên) | [quochoi.vn (bản lưu)](https://web.archive.org/web/20250612070723/https://quochoi.vn/tintuc/Pages/tin-hoat-dong-cua-quoc-hoi.aspx?ItemID=94522) |
| Vẫn còn huyện/xã cấp huyện | **Cấp huyện bị bãi bỏ toàn quốc từ 1/7/2025.** Một tỉnh nay chỉ còn N phường/xã/đặc khu | [en.wikipedia – Subdivisions of Vietnam](https://en.wikipedia.org/wiki/Subdivisions_of_Vietnam) |
| "Bình Dương/Đồng Nai còn là tỉnh" | **Đồng Nai thành TP trực thuộc Trung ương từ 30/4/2026**; TP.HCM sáp nhập Bình Dương + Bà Rịa–Vũng Tàu | [baochinhphu.vn](https://baochinhphu.vn/trinh-quoc-hoi-viec-thanh-lap-thanh-pho-dong-nai-truc-thuoc-trung-uong-du-kien-hieu-luc-tu-30-4-2026-102260420092248619.htm) |

---

## A. THAY ĐỔI Ở CẤP TỈNH

### A1. Nghị quyết 202/2025/QH15

| Nội dung | Giá trị | Nguồn |
|---|---|---|
| Ngày thông qua | **12/6/2025** | [web.archive – Quốc hội](https://web.archive.org/web/20250612070723/https://quochoi.vn/tintuc/Pages/tin-hoat-dong-cua-quoc-hoi.aspx?ItemID=94522) |
| Ngày hiệu lực | **12/6/2025** (cùng ngày thông qua) | [Nghị quyết (bản lưu)](https://web.archive.org/web/20250612070723/https://quochoi.vn/tintuc/Pages/tin-hoat-dong-cua-quoc-hoi.aspx?ItemID=94532) |
| Kết quả biểu quyết | 461/465 đại biểu đồng ý — **96,44%** | [web.archive – Quốc hội](https://web.archive.org/web/20250612070723/https://quochoi.vn/tintuc/Pages/tin-hoat-dong-cua-quoc-hoi.aspx?ItemID=94522) |
| Kết quả | Còn **34 đơn vị hành chính cấp tỉnh** = **6 thành phố trực thuộc Trung ương + 28 tỉnh** | [web.archive – Quốc hội](https://web.archive.org/web/20250612070723/https://quochoi.vn/tintuc/Pages/tin-hoat-dong-cua-quoc-hoi.aspx?ItemID=94522) |
| Chính quyền tỉnh mới bắt đầu hoạt động | 1/7/2025 (sau kỳ họp HĐND tỉnh đầu tiên) | [web.archive – Quốc hội](https://web.archive.org/web/20250612070723/https://quochoi.vn/tintuc/Pages/tin-hoat-dong-cua-quoc-hoi.aspx?ItemID=94522) |

### A2. Bản đồ sáp nhập của **tuyến xe khách Phú Yên → Sài Gòn**

Thứ tự hành trình sau sáp nhập (từ Bắc → Nam):

```
TP Tuy Hòa (cũ: Phú Yên)          →  THUỘC TỈNH ĐẮK LẮK
Nha Trang / Phan Rang-Tháp Chàm    →  THUỘC TỈNH KHÁNH HÒA
Phan Thiết / La Gi / Bình Thuận   →  THUỘC TỈNH LÂM ĐỒNG
Dầu Giây / Long Thành / Nhơn Trạch →  THUỌC TP ĐỒNG NAI (trực thuộc TW)
Bến xe Miền Đông mới (Suối Tiên)  →  THUỘC TP HỒ CHÍ MINH
```

Nguồn xác nhận chuỗi tỉnh trên: bản đồ hành chính trên [vanban.chinhphu.vn](https://vanban.chinhphu.vn/).

| Tỉnh/TP mới | Hợp nhất từ | Diện tích | Dân số | Nguồn |
|---|---|---|---|---|
| **Đắk Lắk** | Đắk Lắk + **Phú Yên** | 18.096,40 km² | 3.346.853 | [en.wikipedia](https://en.wikipedia.org/wiki/%C4%90%E1%BA%AFk_L%E1%BA%AFk_province) |
| **Khánh Hòa** | Khánh Hòa + **Ninh Thuận** | 8.555,86 km² | 2.243.554 | [en.wikipedia](https://en.wikipedia.org/wiki/Kh%C3%A1nh_H%C3%B2a_province) |
| **Lâm Đồng** | Lâm Đồng + **Đắk Nông** + **Bình Thuận** | 24.233,07 km² | 3.872.999 | [en.wikipedia – Lâm Đồng](https://en.wikipedia.org/wiki/L%C3%A2m_%C4%90%E1%BB%93ng_province) |
| **Đồng Nai** (thành phố trực thuộc TW) | Đồng Nai + **Bình Phước** + **Lâm Đồng (một phần)** + **Bình Thuận (một phần)** | 12.737,18 km² | 4.836.798 | [en.wikipedia](https://en.wikipedia.org/wiki/%C4%90%E1%BB%93ng_Nai) |
| **TP Hồ Chí Minh** | TP.HCM + **Bình Dương** + **Bà Rịa – Vũng Tàu** | — | — | [en.wikipedia – TP HCM](https://en.wikipedia.org/wiki/Ho_Chi_Minh_City) |

> ⚠️ **Lưu ý về Đồng Nai:** bản đồ hành chính cho thấy Đồng Nai còn nhận thêm một phần đất của Lâm Đồng và Bình Thuận (khu vực phía Nam, hợp thức hoá đường biên giới phía Đông và kéo dài xuống Biển Đông), nên diện tích/tên đơn vị ở Đồng Nai có thay đổi so với phần lớn tài liệu 2025. Xem mục A4.

### A3. Thủ phô mới của các tỉnh trên tuyến

| Tỉnh/TP | Thủ phô | Nguồn |
|---|---|---|
| Đắk Lắk | TP **Buôn Ma Thuột** | [en.wikipedia](https://en.wikipedia.org/wiki/%C4%90%E1%BA%AFk_L%E1%BA%AFk_province) |
| Khánh Hòa | Phường **Nha Trang** | [en.wikipedia](https://en.wikipedia.org/wiki/Kh%C3%A1nh_H%C3%B2a_province) |
| Lâm Đồng | TP **Đà Lạt** (chính quyền đặt tại Đà Lạt) | [en.wikipedia](https://en.wikipedia.org/wiki/L%C3%A2m_%C4%90%E1%BB%93ng_province) |
| TP Đồng Nai | Phường **Trấn Biên** | [baochinhphu.vn](https://baochinhphu.vn/trinh-quoc-hoi-viec-thanh-lap-thanh-pho-dong-nai-truc-thuoc-trung-uong-du-kien-hieu-luc-tu-30-4-2026-102260420092248619.htm) |

### A4. Đồng Nai thành thành phố trực thuộc Trung ương

| Sự kiện | Ngày | Nguồn |
|---|---|---|
| Nghị quyết của NA về thành lập TP Đồng Nai (số 24/4/2026 của Quốc hội, kỳ họp thứ 3 QH khóa XVI) | tháng 4/2026 | [baochinhphu.vn](https://baochinhphu.vn/trinh-quoc-hoi-viec-thanh-lap-thanh-pho-dong-nai-truc-thuoc-trung-uong-du-kien-hieu-luc-tu-30-4-2026-102260420092248619.htm) |
| **Hiệu lực** | **30/4/2026** | [baochinhphu.vn](https://baochinhphu.vn/trinh-quoc-hoi-viec-thanh-lap-thanh-pho-dong-nai-truc-thuoc-trung-uong-du-kien-hieu-luc-tu-30-4-2026-102260420092248619.htm) |
| Nghị quyết **237/NQ-UBTVQH16** của Ủy ban Thường vụ QH: chuyển **Dầu Giây, Đồng Phú, Long Thành, Lộc Ninh, Nhơn Trạch, Tân Khai, Tân Phú, Trảng Bom, Trị An, Xuân Lộc** (các huyện lân cận TP Biên Hòa) thành **phường** | 14/4/2026 | [baochinhphu.vn](https://baochinhphu.vn/trinh-quoc-hoi-viec-thanh-lap-thanh-pho-dong-nai-truc-thuoc-trung-uong-du-kien-hieu-luc-tu-30-4-2026-102260420092248619.htm) |

### A5. Số liệu chung toàn quốc sau sáp nhập

| Chỉ số | Giá trị | Nguồn |
|---|---|---|
| Tổng đơn vị hành chính cấp xã toàn quốc (tính đến **20/9/2026**) | **3.321** = **2.599 xã + 709 phường + 13 đặc khu** | [vi.wikipedia – Đơn vị hành chính cấp xã (Việt Nam)](https://vi.wikipedia.org/wiki/%C4%90%C6%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_c%E1%BA%A5p_x%C3%A3_(Vi%E1%BB%87t_Nam)) |
| Tỉnh/TP nhiều đơn vị cấp xã nhất | **TP.HCM — 168 đơn vị** | cùng nguồn trên |
| Thời điểm xác định 13 đặc khu | **1/7/2026** | cùng nguồn trên |
| **Thị trấn chấm dứt** | Loại hình này **kết thúc hoạt động 16/6/2025**. Tính đến 15/6/2025 còn **617 thị trấn** | cùng nguồn trên |
| 13 huyện đảo trở thành **đặc khu** | Bạch Long Vĩ, Cát Hải, Cồn Cỏ, Côn Đảo, Cô Tô, Hoàng Sa, Lý Sơn, Kiên Hải, Phú Quốc, Phú Quý, Thổ Châu, Trường Sa, Vân Đồn | [en.wikipedia – Subdivisions of Vietnam](https://en.wikipedia.org/wiki/Subdivisions_of_Vietnam) |

> ⚠️ **Tổng phường/xã toàn quốc có hai số liệu đang lưu hành — dùng số mới hơn:**
> * **2.599 xã + 709 phường** (vi.wikipedia, cập nhật 20/9/2026 — *dùng số này*)
> * 2.621 xã + 687 phường (en.wikipedia, bản cập nhật cũ hơn)
>
> Nguyên nhân khác biệt: sau đợt rà soát lần 2 (khoảng 22 đơn vị được nâng từ **xã** lên **phường** trong năm 2026), tổng đơn vị **không đổi** (3.321) nhưng cơ cấu xã/phường dịch chuyển. Vì vậy **con số 3.321 là ổn định, còn tỷ lệ xã/phường thì phải ghi kèm ngày.**

### A6. Văn bản pháp lý nền cho toàn bộ phần B (bổ sung)

| Văn bản | Ngày | Vai trò | Nguồn |
|---|---|---|---|
| **Nghị quyết 202/2025/QH15** | 12/6/2025 | Sắp xếp lại 34 đơn vị cấp tỉnh | xem A1 |
| **Luật Tổ chức chính quyền địa phương số 72/2025/QH15** | 16/6/2025 (QH khóa XV, kỳ họp thứ 9) | Luật mới đặt nền cho **3 loại đơn vị cấp xã** (phường / xã / đặc khu) và chấm dứt thị trấn | [Bản PDF chính thức – datafiles.chinhphu.vn](https://datafiles.chinhphu.vn/cpp/files/vbpq/2021/05/1263.signed.pdf) |
| **Nghị quyết 203/2025/QH15** | 16/6/2025 | Sửa đổi, bổ sung Hiến pháp — khẳng định việc bỏ cấp huyện, bỏ thị trấn | [Bản PDF – Cổng TTĐT TP.HCM](https://images.hcmcpv.org.vn/Uploads/File/16062025F2CFB160/NQ%20sua%20doi%20Hien%20phap.pdf) |
| **Nghị quyết 76/2025/UBTVQH15** | 14/4/2025 | Ủy ban Thường vụ QH sắp xếp **đơn vị hành chính cấp xã** (phường/xã) trên toàn quốc — văn bản "xương sống" cho danh sách ở mục B | [vi.wikipedia – Dầu Giây](https://vi.wikipedia.org/wiki/D%E1%BA%A7u_Gi%C3%A2y) (dẫn NQ 76/2025/UBTVQH15) |
| **Văn bản 2896/BNV-CQĐP** | 27/5/2025 | Bộ Nội vụ: danh mục đơn vị cấp xã + số liệu diện tích/dân số | [vi.wikipedia – Dầu Giây](https://vi.wikipedia.org/wiki/D%E1%BA%A7u_Gi%C3%A2y) |

---

## B. DANH SÁCH PHƯỜNG / XÃ / ĐẶC KHU

> Nguồn chính cho cả 4 tỉnh: **tiểu sử đơn vị hành chính trên Wikipedia tiếng Việt**, trang `Danh sách đơn vị hành chính thuộc <tỉnh>`. Trang này dẫn **Văn bản số 2896/BNV-CQĐP ngày 27/5/2025 của Bộ Nội vụ** (danh mục dự kiến đơn vị hành chính cấp xã mới) làm nguồn số liệu diện tích/dân số — tức là dữ liệu **cấp Bộ**, không phải blog.

### B1. Đắk Lắk — **102 đơn vị** = 14 phường + 88 xã (không có đặc khu)

Nguồn: <https://vi.wikipedia.org/wiki/Danh_s%C3%A1ch_%C4%91%E1%BA%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_thu%E1%BB%99c_t%E1%BB%89nh_%C4%90%E1%BA%AFk_L%E1%BA%AFk>

**14 phường:** Bình Kiến · Buôn Hồ · Buôn Ma Thuột · Cư Bao · Đông Hòa · Ea Kao · Hòa Hiệp · **Phú Yên** · **Sông Cầu** · **Tân An** · **Tân Lập** · Thành Nhất · **Tuy Hòa** · **Xuân Đài**

**88 xã:** Bảo Lộc¹… *(xem bảng chi tiết bên dưới cho các xã trên tuyến)*

#### Các đơn vị của Đắk Lắk **nằm trên tuyến xe khách** (diện tích & dân số)

| Đơn vị | Loại | Diện tích (km²) | Dân số 2025 |
|---|---|---|---|
| **Tuy Hòa** | phường | 33,77 | 126.118 |
| **Phú Yên** | phường | 44,04 | 61.799 |
| **Đông Hòa** | phường | 77,54 | 47.632 |
| **Tân An** | phường | 56,41 | 64.122 |
| **Tân Lập** | phường | 46,70 | 73.316 |
| **Sông Cầu** | phường | 90,49 | 38.891 |
| **Xuân Đài** | phường | 13,40 | 21.574 |
| **Ô Loan** | xã | 103,48 | 40.278 |
| **Tây Hòa** | xã | 55,14 | 49.720 |
| **Phú Hòa 1** | xã | 142,54 | 54.212 |
| **Phú Hòa 2** | xã | 95,78 | 38.691 |
| **Phú Xuân** | xã | 140,74 | 34.836 |
| **Sông Hinh** | xã | 460,13 | 23.841 |
| **Hòa Xuân** | xã | 129,33 | 22.962 |
| **Phú Mỡ** | xã | 547,20 | 9.007 |
| **Tuy An Bắc** | xã | 52,32 | 26.174 |
| **Tuy An Đông** | xã | 46,05 | 40.108 |
| **Tuy An Nam** | xã | 69,99 | 29.805 |
| **Tuy An Tây** | xã | 136,20 | 12.913 |
| **Xuân Cảnh** | xã | 83,81 | 23.972 |
| **Xuân Lãnh** | xã | 174,65 | 15.933 |
| **Xuân Thọ** | xã | 192,12 | 10.793 |
| **Đồng Xuân** | xã | 206,26 | 26.907 |
| **Vụ Bổn** | xã | 109,13 | 18.111 |

¹ *Không phải "Bảo Lộc" của Lâm Đồng — Đắk Lắk không có xã Bảo Lộc; danh sách xã đầy đủ gồm: Buôn Đôn, Cuôr Đăng, Cư M'gar, Cư M'ta, Cư Pơng, Cư Prao, Cư Pui, Cư Yang, Dang Kang, Dliê Ya, Dray Bhăng, Dur Kmăl, Đắk Liêng, Đắk Phơi, Đồng Xuân, Đức Bình, Ea Bá, Ea Bung, Ea Drăng, Ea Drông, Ea Hiao, Ea H'Leo, Ea Kar, Ea Khăl, Ea Kiết, Ea Kly, Ea Knốp, Ea Knuếc, Ea Ktur, Ea Ly, Ea M'Droh, Ea Na, Ea Ning, Ea Nuôl, Ea Ô, Ea Păl, Ea Phê, Ea Riêng, Ea Rốk, Ea Súp, Ea Trang, Ea Tul, Ea Wer, Ea Wy, Hòa Mỹ, Hòa Phú, Hòa Sơn, Hòa Thịnh, Hòa Xuân, Ia Lốp, Ia Rvê, Krông Ana, Krông Á, Krông Bông, Krông Búk, Krông Năng, **Krông Nô (Đắk Lắk)**, Krông Pắc, Liên Sơn Lắk, M'Drắk, Nam Ka, Ô Loan, Phú Hòa 1, Phú Hòa 2, Phú Mỡ, Phú Xuân, Pơng Drang, Quảng Phú, Sông Hinh, Sơn Hòa, Sơn Thành, Suối Trai, Tam Giang, Tân Tiến, Tây Hòa, Tây Sơn, Tuy An Bắc, Tuy An Đông, Tuy An Nam, Tuy An Tây, Vân Hòa, Vụ Bổn, Xuân Cảnh, Xuân Lãnh, Xuân Lộc, Xuân Phước, Xuân Thọ, Yang Mao.*

> ⚠️ **Bẫy tên trùng — rất dễ cài nhầm trong game:** có **hai xã tên "Krông Nô"**:
> - `Krông Nô, Đắk Lắk` — 282,01 km², 9.976 dân
> - `Krông Nô, Lâm Đồng` — 159,82 km², 22.636 dân
> Nguồn: <https://vi.wikipedia.org/wiki/Danh_s%C3%A1ch_%C4%91%E1%BA%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_thu%E1%BB%99c_t%E1%BB%89nh_%C4%90%E1%BA%AFk_L%E1%BA%AFk> và <https://vi.wikipedia.org/wiki/Danh_s%C3%A1ch_%C4%91%E1%BA%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_thu%E1%BB%99c_t%E1%BB%89nh_L%C3%A2m_%C4%90%E1%BB%93ng>

### B2. Khánh Hòa — **65 đơn vị** = 16 phường + 48 xã + 1 đặc khu *(cập nhật tới 1/7/2026)*

Nguồn: <https://vi.wikipedia.org/wiki/Danh_s%C3%A1ch_%C4%91%E1%BA%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_thu%E1%BB%99c_t%E1%BB%89nh_Kh%C3%A1nh_H%C3%B2a>

> **Lưu ý mâu thuẫn nguồn:** Wikipedia tiếng Anh ghi Khánh Hòa có "20 phường + 44 xã + 1 đặc khu" — [en.wikipedia](https://en.wikipedia.org/wiki/Kh%C3%A1nh_H%C3%B2a_province). Trang tiếng Việt (chi tiết hơn, cập nhật 1/7/2026) ghi **16 phường + 48 xã + 1 đặc khu**. Báo cáo này dùng **số của tiếng Việt** nhưng ghi rõ mâu thuẫn.

**16 phường:** Ba Ngòi · Bảo An · Bắc Cam Ranh · Bắc Nha Trang · Cam Linh · Cam Ranh · **Đô Vinh** · Đông Hải · Đông Ninh Hòa · Hòa Thắng · Nam Nha Trang · **Nha Trang** · Ninh Chử · Ninh Hòa · **Phan Rang** · Tây Nha Trang

**1 đặc khu:** **Trường Sa** — 496,30 km², 153 dân

**48 xã:** Anh Dũng · Bác Ái · Bác Ái Đông · Bác Ái Tây · Bắc Khánh Vĩnh · Bắc Ninh Hòa · **Cam An** · **Cam Hiệp** · **Cam Lâm** · **Cà Ná** · **Công Hải** · **Diên Điền** · **Diên Khánh** · **Diên Lạc** · **Diên Lâm** · **Diên Thọ** · **Đại Lãnh** · **Đông Khánh Sơn** · **Hòa Trí** · **Khánh Sơn** · **Khánh Vĩnh** · **Lâm Sơn** · **Mỹ Sơn** · **Nam Cam Ranh** · **Nam Khánh Vĩnh** · **Nam Ninh Hòa** · **Ninh Hải** · **Ninh Phước** · **Ninh Sơn** · **Phước Dinh** · **Phước Hà** · **Phước Hậu** · **Phước Hữu** · **Suối Dầu** · **Suối Hiệp** · **Tân Định** · **Tây Khánh Sơn** · **Tây Khánh Vĩnh** · **Tây Ninh Hòa** · **Thuận Bắc** · **Thuận Nam** · **Trung Khánh Vĩnh** · **Tu Bông** · **Vạn Hưng** · **Vạn Ninh** · **Vạn Thắng** · **Vĩnh Hải** · **Xuân Hải**

#### Đơn vị Khánh Hòa trên tuyến xe khách (diện tích & dân số)

| Đơn vị | Loại | km² | Dân số 2025 |
|---|---|---|---|
| **Nha Trang** | phường | 47,13 | 136.118 |
| **Tây Nha Trang** | phường | 27,89 | 108.065 |
| **Bắc Nha Trang** | phường | 97,04 | 128.239 |
| **Nam Nha Trang** | phường | 82,18 | 130.164 |
| **Cam Linh** | phường | 4,83 | 33.052 |
| **Đông Ninh Hòa** | phường | 134,17 | 43.484 |
| **Ninh Hòa** | phường | 35,80 | 58.816 |
| **Phan Rang** | phường | 9,41 | 72.250 |
| **Đô Vinh** | phường | 61,96 | 33.207 |
| **Ninh Chử** | phường | 20,41 | 39.556 |
| **Đông Hải** | phường | 11,00 | 54.615 |
| **Ninh Phước** | xã | 65,36 | 70.203 |
| **Diên Khánh** | xã | 18,41 | 45.223 |
| **Diên Điền** | xã | 63,74 | 38.029 |
| **Diên Thọ** | xã | 73,64 | 16.692 |
| **Diên Lâm** | xã | 117,81 | 16.059 |
| **Diên Lạc** | xã | 14,85 | 23.325 |
| **Bắc Ninh Hòa** | xã | 236,98 | 32.329 |
| **Nam Ninh Hòa** | xã | 201,43 | 31.293 |
| **Tây Ninh Hòa** | xã | 275,91 | 17.540 |
| **Phước Dinh** | xã | 153,97 | 35.301 |
| **Phước Hà** | xã | 230,00 | 8.900 |
| **Phước Hữu** | xã | 177,66 | 35.572 |
| **Phước Hậu** | xã | 74,71 | 49.465 |
| **Suối Dầu** | xã | 160,09 | 24.185 |
| **Suối Hiệp** | xã | 55,34 | 24.159 |
| **Hòa Trí** | xã | 109,44 | 26.638 |
| **Công Hải** | xã | 124,30 | 14.727 |
| **Lâm Sơn** | xã | 191,49 | 24.247 |
| **Tân Định** | xã | 92,35 | 40.481 |
| **Mỹ Sơn** | xã | 248,06 | 15.800 |

> ✅ **Đối chiếu chéo độc lập bằng báo chính thức của tỉnh:** menu chuyên mục của [Báo Khánh Hòa điện tử](https://baokhanhhoa.vn/) liệt kê đúng các đơn vị mới ở khu vực Phan Rang — Cam Ranh: *Phường Phan Rang, Phường Đô Vinh, Phường Đông Hải, Phường Ninh Chử, Phường Bảo An, Xã Phước Hà, Xã Vạn Thắng, Xã Công Hải, Xã Vạn Ninh, Xã Lâm Sơn, Xã Khánh Sơn, Xã Phước Hậu, Xã Ninh Hải, Xã Phước Hữu, Xã Mỹ Sơn, Xã Đông Khánh Sơn, Xã Xuân Hải, Xã Phước Dinh, Xã Anh Dũng, Xã Cam Lâm, Xã Nam Cam Ranh, Xã Thuận Bắc, Phường Cam Ranh* — **khớp với danh sách trên.**

### B3. Lâm Đồng — **124 đơn vị** = 20 phường + 103 xã + 1 đặc khu *(cập nhật tới 15/3/2026)*

Nguồn: <https://vi.wikipedia.org/wiki/Danh_s%C3%A1ch_%C4%91%E1%BA%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_thu%E1%BB%99c_t%E1%BB%89nh_L%C3%A2m_%C4%90%E1%BB%93ng>

**20 phường:** 1 Bảo Lộc · 2 Bảo Lộc · 3 Bảo Lộc · Bắc Gia Nghĩa · B'Lao · **Bình Thuận** · Cam Ly – Đà Lạt · Đông Gia Nghĩa · **Hàm Thắng** · **La Gi** · Lang Biang – Đà Lạt · Lâm Viên – Đà Lạt · **Mũi Né** · Nam Gia Nghĩa · **Phan Thiết** · **Phú Thủy** · **Phước Hội** · **Tiến Thành** · Xuân Hương – Đà Lạt · Xuân Trường – Đà Lạt

**1 đặc khu:** **Phú Quý**

**103 xã:** Bảo Lâm 1 · Bảo Lâm 2 · Bảo Lâm 3 · Bảo Lâm 4 · Bảo Lâm 5 · Bảo Thuận · Bắc Bình · Bắc Ruộng · Cát Tiên 2 · Cát Tiên 3 · Cư Jút · Di Linh · D'Ran · Đam Rông 1–4 · Đạ Huoai · Đạ Huoai 2 · Đạ Huoai 3 · Đạ Tẻh · Đạ Tẻh 2 · Đạ Tẻh 3 · Đắk Mil · Đắk Sắk · Đắk Song · Đắk Wil · Đinh Trang Thượng · Đinh Văn Lâm Hà · Đông Giang · Đồng Kho · Đơn Dương · **Đức Linh** · **Đức Trọng** · **Gia Hiệp** · **Hàm Kiệm** · **Hàm Liêm** · **Hàm Tân** · **Hàm Thạnh** · **Hàm Thuận** · **Hàm Thuận Bắc** · **Hàm Thuận Nam** · **Hải Ninh** · Hiệp Thạnh · Hoài Đức · **Hòa Bắc** · **Hòa Ninh** · **Hòa Thắng** · **Hồng Sơn** · **Hồng Thái** · Ka Đô · Kiến Đức · **Krông Nô (Lâm Đồng)** · La Dạ · Lạc Dương · **Liên Hương** · Lương Sơn · Nam Ban Lâm Hà · Nam Dong · Nam Đà · Nam Hà Lâm Hà · **Nam Thành** · Nâm Nung · Nghị Đức · Nhân Cơ · Ninh Gia · **Phan Rí Cửa** · Phan Sơn · Phú Sơn Lâm Hà · Phúc Thọ Lâm Hà · Quảng Hòa · Quảng Khê · Quảng Lập · Quảng Phú · Quảng Sơn · Quảng Tân · Quảng Tín · Quảng Trực · Sông Lũy · Sơn Điền · **Sơn Mỹ** · Suối Kiết · **Tánh Linh** · Tà Đùng · Tà Hine · Tà Năng · Tân Hà Lâm Hà · **Tân Hải** · **Tân Hội** · **Tân Lập** · **Tân Minh** · **Tân Thành** · **Thuận An** · **Thuận Hạnh** · Trà Tân · Trường Xuân · Tuy Đức · **Tuy Phong** · Tuyên Quang · **Vĩnh Hảo**

#### Đơn vị Lâm Đồng ở khu vực Bình Thuận / Phan Thiết (diện tích & dân số)

| Đơn vị | Loại | km² | Dân số 2025 |
|---|---|---|---|
| **Phan Thiết** | phường | 4,46 | 85.493 |
| **Bình Thuận** | phường | 45,16 | 47.858 |
| **Hàm Thắng** | phường | 44,90 | 54.544 |
| **Mũi Né** | phường | 118,59 | 50.166 |
| **Phú Thủy** | phường | 17,31 | 54.049 |
| **Phước Hội** | phường | 38,09 | 49.480 |
| **Tiến Thành** | phường | 55,06 | 28.395 |
| **La Gi** | phường | 68,47 | 60.549 |
| **Hàm Thuận Nam** | xã | 111,82 | 32.771 |
| **Hàm Thuận Bắc** | xã | 292,70 | 29.855 |
| **Hàm Thuận** | xã | 198,36 | 50.680 |
| **Hàm Tân** | xã | 198,46 | 35.209 |
| **Hàm Thạnh** | xã | 440,70 | 16.306 |
| **Hàm Kiệm** | xã | 162,09 | 31.445 |
| **Hàm Liêm** | xã | 113,81 | 31.253 |
| **Tánh Linh** | xã | 271,39 | 46.741 |
| **Tuy Phong** | xã | 444,10 | 9.510 |
| **Đức Linh** | xã | 103,27 | 51.099 |
| **Liên Hương** | xã | — | — |
| **Phan Rí Cửa** | xã | — | — |
| **Hải Ninh** | xã | 289,99 | 19.422 |
| **Hòa Bắc** | xã | 159,35 | 19.979 |
| **Hòa Ninh** | xã | 95,17 | 31.904 |
| **Hòa Thắng** | xã | 328,09 | 11.558 |
| **Đông Giang** | xã | — | — |
| **Phan Sơn** | xã | — | — |
| **Tân Lập** | xã | 195,58 | 19.612 |

### B4. TP Đồng Nai — **95 đơn vị** = 33 phường + 62 xã *(cập nhật tới 1/7/2026)*

Nguồn: <https://vi.wikipedia.org/wiki/Danh_s%C3%A1ch_%C4%91%E1%BA%A1n_v%E1%BB%8B_h%C3%A0nh_ch%C3%ADnh_thu%E1%BB%99c_th%C3%A0nh_ph%E1%BB%91t_%C4%90%E1%BB%93ng_Nai>

**33 phường:** An Lộc · Bảo Vinh · **Biên Hòa** · Bình Long · Bình Lộc · **Bình Phước** · Chơn Thành · **Dầu Giây** · **Đồng Phú** · **Đồng Xoài** · Hàng Gòn · **Hố Nai** · **Long Bình** · Long Hưng · Long Khánh · **Long Thành** · **Lộc Ninh** · Minh Hưng · **Nhơn Trạch** · Phước Bình · Phước Long · Phước Tân · **Tam Hiệp** · **Tam Phước** · **Tân Khai** · **Tân Phú** · **Tân Triều** · **Trảng Bom** · Trảng Dài · **Trấn Biên** · **Trị An** · Xuân Lập · **Xuân Lộc**

**62 xã:** An Phước · An Viễn · **Bàu Hàm** · Bình An · Bình Minh · Bình Tân · Bom Bo · Bù Đăng · Bù Gia Mập · **Cẩm Mỹ** · Đa Kia · Đak Lua · Đak Nhau · **Đại Phước** · Đăk Ơ · **Định Quán** · Đồng Tâm · **Gia Kiệm** · Hưng Phước · Hưng Thịnh · **La Ngà** · Long Hà · **Long Phước** · Lộc Hưng · Lộc Quang · Lộc Tấn · Lộc Thành · Lộc Thạnh · Minh Đức · Nam Cát Tiên · Nghĩa Trung · Nha Bích · Phú Hòa · Phú Lâm · Phú Lý · Phú Nghĩa · Phú Riềng · Phú Trung · Phú Vinh · Phước An · Phước Sơn · **Phước Thái** · **Sông Ray** · **Tà Lài** · Tân An · Tân Hưng · Tân Lợi · Tân Quan · Tân Tiến · Thanh Sơn · Thiện Hưng · Thọ Sơn · **Thống Nhất** · Thuận Lợi · Xuân Bắc · **Xuân Định** · **Xuân Đông** · **Xuân Đường** · **Xuân Hòa** · **Xuân Phú** · Xuân Quế · Xuân Thành

> ⚠️ **Trùng tên cần cẩn thận:** Đồng Nai có **xã Phú Lâm** — nhưng đây **không phải** nơi có Bến xe Nam Tuy Hòa. Bến xe nằm ở **phường Phú Lâm, TP Tuy Hòa** (tỉnh Đắk Lắk), và tên "phường Phú Lâm" này **không còn tồn tại** trong bản đồ hành chính mới.

---

## C. BẾN XE TRÊN TUYẾN

### C0. Thang bậc nguồn dùng từ đây trở đi

| Bậc | Nghĩa là gì | Ví dụ trong phần này |
|---|---|---|
| **A — chính thức** | Cổng Chính phủ, báo chí chính thức của tỉnh, báo điện tử Chính phủ, cơ quan nhà nước | Báo Khánh Hòa (baokhanhhoa.vn), vi.wikipedia dẫn NQ/Luật có bản PDF chính thức |
| **B — bản đồ/cơ sở dữ liệu** | OpenStreetMap + Nominatim (dữ liệu cộng đồng, có thể sai) | toạ độ bến xe, tên đường, ranh giới phường |
| **C — tổng hợp/đặt vé** | vexesapa, motortrip… (không kiểm chứng được với cơ quan nhà nước) | địa chỉ hậu chữ, số điện thoại bến xe, thời gian chạy |
| **D — KHÔNG XÁC MINH ĐƯỢC** | Không tìm được nguồn | ghi rõ đã tìm gì |

> 🚫 Quy tắc sử dụng cho BusDriveVN: **chỉ dùng bậc A + B làm dữ liệu cứng trong map.** Bậc C chỉ dùng để gợi ý, không được code vào.

### C1. Bảng bến xe từ Tuy Hòa → TP.HCM

| # | Tên bến xe | Địa chỉ (trước 1/7/2025) | Tỉnh/TP **sau** sáp nhập | Phường/xã **sau** sáp nhập | Toạ độ (OSM) | ĐT | Nguồn | Bậc |
|---|---|---|---|---|---|---|---|---|
| 1 | **Bến xe Nam Tuy Hòa** (tên gọi dân dã: **Bến xe Phú Lâm**) | 507 Nguyễn Văn Linh, phường Phú Lâm, TP Tuy Hòa, tỉnh Phú Yên | **TP Tuy Hòa, tỉnh Đắk Lắk** | ⚠️ *phường Phú Lâm đã bị giải thể* — xem C2 | ⚠️ *2 ứng viên* — xem C2 | 0257 3852 288 | [motortrip](https://motortrip.vn/dich-vu/ben-xe-nam-tuy-hoa) + OSM | C + B |
| 2 | Bến xe Nội Thành Tuy Hòa | *(không tìm được địa chỉ chữ)* | Đắk Lắk | phường Tuy Hòa | **13,08770 ; 109,30689** (node/2408415318) | — | OSM | B |
| 3 | Bến xe Thuận Thảo | *(không tìm được địa chỉ chữ)* | Đắk Lắk | phường Tuy Hòa | **13,09205 ; 109,29435** (node/2407581661) | — | OSM | B |
| 4 | **Bến xe liên tỉnh phía Nam Nha Trang** | **Km số 6, đường 23 tháng 10, TP Nha Trang** | **Khánh Hòa** | ⚠️ OSM cho **xã Diên Khánh**, đường **Võ Nguyên Giáp** — mâu thuẫn với "đường 23 tháng 10", xem C5 | **12,24365 ; 109,09814** (way/1382446869) | (058) 3894192 – 3894227 | [Báo Khánh Hòa 11/07/2017](https://baokhanhhoa.vn/tau-xe-maybay/201707/cac-tuyen-xe-va-gio-xuat-ben-8046467/) + OSM | **A** + B |
| 5 | Bến Xe Bắc Nha Trang | *(không tìm được địa chỉ chữ)* | Khánh Hòa | phường Nha Trang | **12,28871 ; 109,19048** (way/162811418) | — | OSM | B |
| 6 | **Bến xe khách Ninh Thuận (Phan Rang)** | **52 Lê Duẩn** *(số nhà từ Nominatim/OSM)* | **Khánh Hòa** | **phường Bảo An** | **11,58604 ; 108,98645** (node/6678202185) | — | OSM + Nominatim | B |
| 7 | Bến xe khách Phan Rí Cửa | *(không tìm được địa chỉ chữ)* | Khánh Hòa | xã Phan Rí Cửa | **11,17361 ; 108,56805** (node/1613898132) | — | OSM | B |
| 8 | Bến xe Cam Ranh | *(không tìm được địa chỉ chữ)* | Khánh Hòa | phường Cam Ranh | **11,91833 ; 109,14667** (way/1408821725) | — | OSM | B |
| 9 | Bến xe Sơn Hòa | *(không tìm được địa chỉ chữ)* | Khánh Hòa | xã Sơn Hòa | **13,04812 ; 108,97467** (node) | — | OSM | B |
| 10 | **Bến xe khách Bình Thuận (Phan Thiết)** | **01 Tôn Đức Thắng, phường Phú Thủy, TP Phan Thiết, tỉnh Bình Thuận**. Cách **Ga Phan Thiết 3 km**, cách **Mũi Né 12 km** | **Lâm Đồng** | **phường Phú Thủy** | **10,93964 ; 108,10291** (way/671959431) | 0252 3822 215 (hotline) | [vexesapa](https://vexesapa.vn/ben-xe-phan-thiet-dia-chi-so-dien-thoai-hang-xe-lich-trinh-cap-nhat-2025) + OSM | C + B |
| 11 | Phương Trang (Bến xe khách) | *(không tìm được địa chỉ chữ)* | Lâm Đồng | phường Bình Thuận / Phú Thủy | **10,93118 ; 108,11083** (node/7108799707) | — | OSM | B |
| 12 | Tâm Hạnh (Bến xe khách) | *(không tìm được địa chỉ chữ)* | Lâm Đồng | phường Bình Thuận / Phú Thủy | **10,93213 ; 108,11095** (node/7108799708) | — | OSM | B |
| 13 | Bến xe Đồng Nai | *(không tìm được địa chỉ chữ)* | **TP Đồng Nai** | — | **10,93575 ; 106,86753** (way/972772679) | — | OSM | B |
| 14 | **Bến xe Hố Nai** | **Xa lộ Hà Nội, Khu phố 2, phường Long Bình** | **TP Đồng Nai** | **phường Long Bình** | **10,96704 ; 106,88653** (way/970341390) — node/11874238080 ở 10,96693 ; 106,88659 | — | OSM + Nominatim | B |
| 15 | Bến xe Biên Hòa | *(không tìm được địa chỉ chữ)* | **TP Đồng Nai** | **phường Biên Hòa** | **10,95422 ; 106,80909** (way/970251629) | — | OSM + Nominatim | B |
| 16 | Bến xe KCN Nhơn Trạch | *(không tìm được địa chỉ chữ)* | **TP Đồng Nai** | **phường Nhơn Trạch** | **10,72895 ; 106,90505** (node/11799136678) — way/605046157 ở 10,73378 ; 106,92910 | — | OSM | B |
| 17 | Bến xe Ngã ba Trị An | *(không tìm được địa chỉ chữ)* | TP Đồng Nai | xã Trị An / phường Trị An | **10,96098 ; 106,94623** (way/974619147) | — | OSM | B |
| 18 | **Bến xe Dầu Giây** | *(không tìm được địa chỉ chữ)* | **TP Đồng Nai** | **phường Dầu Giây** | **10,94261 ; 107,15373** (node/11878284535) — way/973228296 ở 10,94326 ; 107,15379 | — | OSM | B |
| 19 | Bến xe khách xuyên Mộc | *(không tìm được địa chỉ chữ)* | TP Đồng Nai | xã Xuân Mộc / Bàu Chay | **10,53238 ; 107,39276** (way/739799935) | — | OSM | B |
| 20 | Bến xe Xuân Lộc | *(không tìm được địa chỉ chữ)* | TP Đồng Nai | **phường Xuân Lộc** | **10,91526 ; 107,39900** (node/11878252553) | — | OSM | B |
| 21 | Bến xe khách huyện Châu Đức | *(không tìm được địa chỉ chữ)* | TP Đồng Nai | xã An Phú / Nam Trạch | **10,64842 ; 107,23715** (way/727457589) | — | OSM | B |
| 22 | Bến xe Long Giao | *(không tìm được địa chỉ chữ)* | TP Đồng Nai | xã Long Giao | **10,81491 ; 107,22945** (way/726864806) | — | OSM | B |
| 23 | Bến xe Ngã tư Vũng Tàu | *(không tìm được địa chỉ chữ)* | **TP.HCM** | phường Tân Hưng / Bình Tân | **10,90508 ; 106,84676** (way/294129030) | — | OSM | B |
| 24 | **Bến xe Miền Đông mới (Suối Tiên)** | **Xa lộ Hà Nội, ranh giới phường Long Bình (Thủ Đức) và Đông Hòa (Dĩ An, Bình Dương)** | **TP.HCM** | **phường Đông Hòa** và **phường Long Bình** (tên cũ: Thủ Đức) | **10,88024 ; 106,81550** (node/11868497849) — way/1178249798 ở 10,87955 ; 106,81619 | — | [vi.wikipedia – Bến xe Miền Đông](https://vi.wikipedia.org/wiki/B%E1%BA%BFn_xe_Mi%E1%BB%81n_%C4%90%C3%B4ng) | **A** + B |
| 25 | Bến xe Miền Đông cũ (Bến Thành) | **292 Đinh Bộ Lĩnh, phường Bình Thạnh** — **đã chuyển sang bến mới năm 2020** | TP.HCM | phường Bình Thạnh | **10,81473 ; 106,71125** (way/59585216) | — | [vi.wikipedia – Bến xe Miền Đông](https://vi.wikipedia.org/wiki/B%E1%BA%BFn_xe_Mi%E1%BB%81n_%C4%90%C3%B4ng) + OSM | **A** + B |
| 26 | Bến xe Đức Trọng (Lâm Viên – Đà Lạt) | *(ngoài tuyến chính, đi Đèo Cả/nhánh Đà Lạt)* | Lâm Đồng | phường Đức Trọng | **11,72621 ; 108,36964** (way/542900706) | — | OSM | B |
| 27 | Bến xe Đơn Dương | *(ngoài tuyến chính)* | Lâm Đồng | phường Đơn Dương | **11,76016 ; 108,48573** (way/1562140522) | — | OSM | B |

### C2. ⚠️ TRANH CHẤP TOẠ ĐỘ BẾN XE NAM TUY HÒA — chưa giải quyết được

OpenStreetMap có **hai node cách nhau ~5,6 km, cùng mang tên bến xe liên tỉnh Phú Yên**:

| Ứng viên | Toạ độ | Object ID | Đường / đơn vị theo Nominatim | Nhận xét |
|---|---|---|---|---|
| **A** | **13,092588 ; 109,294210** | node/11818276215 (`amenity=bus_station`, `bus=yes`, `public_transport=station`, tên *"Bến xe Liên tỉnh Phú Yên"*) | **Đại lộ Nguyễn Tất Thành**, thôn Phú Vang, **phường Tuy Hòa** | Ngay cạnh **Ga Tuy Hòa** (13,08812 ; 109,29735) ~500 m. Trong **15 m** còn có node/2407581661 *"Bến xe Thuận Thảo"* và node/4821756934 *"Phuc Thuan Thao"* → 3 POI khác nhau nằm chồng lên nhau = **một khu bến xe duy nhất có nhiều nhà xe** |
| **B** | **13,041132 ; 109,311895** | way/1472940794 (`amenity=bus_station`, `name=Phu Yen bus station`, `name:vi=Bến Xe Liên Tỉnh Phú Yên`) | **Nguyễn Văn Linh** (OSM gắn `ref=QL.1`), **phường Phú Yên** | Nằm đúng trên đường **Nguyễn Văn Linh** — trùng khớp **địa chỉ "507 Nguyễn Văn Linh"** mà [motortrip](https://motortrip.vn/dich-vu/ben-xe-nam-tuy-hoa) ghi |

**Bằng chứng nghiêng về ứng viên B:**
* Địa chỉ "507 **Nguyễn Văn Linh**" của nguồn bậc C khớp đúng đường mà ứng viên B nằm trên. Đường Nguyễn Văn Linh chạy từ 13,0364 ; 109,3131 → 13,0660 ; 109,3118 (OSM way/151688170, 231991935, 605830164, 1218400777, 1218400780, 1218400782 — tất cả đều gắn `ref=QL.1`).
* Cùng nguồn nói rõ: *"Mặc dù **không nằm ngay trung tâm thành phố Tuy Hòa**, nhưng bến xe lại chiếm ưu thế nhờ diện tích rộng lớn"* → ứng viên B cách ga Tuy Hòa ~5,6 km, ứng viên A thì nằm ngay trung tâm.
* Tên gọi dân dã **"Bến xe Phú Lâm"** — ứng viên B nằm ở **phường Phú Yên** (đơn vị mới), ứng viên A ở **phường Tuy Hòa** (đơn vị mới). Tên "Phú Lâm" không còn tồn tại ở cấp phường.

**Bằng chứng nghiêng về ứng viên A:**
* Gắn thẻ OSM đầy đủ hơn (`bus=yes`, `public_transport=station`) → có thể mới hơn.
* Sát **Ga Tuy Hòa** — mô hình "bến xe liên tỉnh + ga tàu" là kiểu phổ biến ở Việt Nam.

> **KẾT LUẬN: KHÔNG XÁC MINH ĐƯỢC chắc chắn ứng viên nào là Bến xe Nam Tuy Hòa.**
> **Đã thử:** OSM API 0.6 (way/151688170+… full geometry), Overpass API (`amenity=bus_station` + `railway=station` trong bán kính 1,2 km quanh cả 2 điểm), Nominatim search/reverse cho 4 truy vấn (tên bến, ga tàu, địa chỉ, phường), Bing/HTML-DDG (bị lọc dấu tiếng Việt hoặc trả kết quả rác), trang motortrip.
> **Việc cần làm tiếp:** xem ảnh vệ tinh / Street View tại cả 2 toạ độ, hoặc hỏi trực tiếp nhà xe Phú Lâm. Tới lúc đó **không nên hardcode toạ độ bến xe Nam Tuy Hòa vào map.**
> Tạm khuyến nghị cho game: đặt bến xe trên **đường Nguyễn Văn Linh (QL1) phía tây–nam trung tâm Tuy Hòa**, có lối vào từ QL1, quanh ứng viên B.

### C3. Bến xe Miền Đông mới (Suối Tiên) — chi tiết đã xác minh

| Sự kiện | Nội dung | Nguồn |
|---|---|---|
| Quy hoạch | Xa lộ Hà Nội, ranh giới **phường Long Bình (Thủ Đức)** và **Đông Hòa (Dĩ An, Bình Dương)**; sau sáp nhập cả hai đều thuộc **TP.HCM** | [vi.wikipedia – Bến xe Miền Đông](https://vi.wikipedia.org/wiki/B%E1%BA%BFn_xe_Mi%E1%BB%81n_%C4%90%C3%B4ng) |
| Bến cũ | **292 Đinh Bộ Lĩnh, Bình Thạnh** | cùng nguồn |
| Ngày chuyển bến | **2020** | cùng nguồn |
| Ngày khai trương | **10/10/2020** | cùng nguồn |
| Quy mô | **> 16 ha**, tổng vốn **4.000 tỷ đồng** (giai đoạn 1 ~ **740 tỷ**) | cùng nguồn |
| Số tuyến cố định | **24 tuyến / 16 tỉnh** | cùng nguồn |
| Chủ đầu tư | **SAMCO / VEC** | cùng nguồn |
| Website chính thức | <http://www.benxemiendong.com.vn> | cùng nguồn |

> 📌 **Bài học cho BusDriveVN:** bến xe Miền Đông **cũ** (292 Đinh Bộ Lĩnh, trong lòng TP) **không còn hoạt động** từ 2020. Game cần có cả hai (hoặc ít nhất phải cho bến cũ trạng thái "đã dời") — nếu không, người chơi sẽ tới sai chỗ ngay trung tâm Sài Gòn.

### C4. Bến xe **KHÔNG XÁC MINH ĐƯỢC**

| Bến xe cần tìm | Đã tìm ở đâu | Kết quả |
|---|---|---|
| **Bến xe Mũi Né** | Overpass `amenity=bus_station` toàn dải 10,5–12,5°N / 106,5–110°E; Nominatim | **KHÔNG XÁC MINH ĐƯỢC.** OSM trong khu vực chỉ có node/5512213573 *"Trung tâm Bờ Kè - Hàm Tiến, Mũi Né"* (10,95506 ; 108,22556) — đây là **điểm du lịch**, không phải bến xe |
| **Bến xe Tân Biên** (TP.HCM) | vi.wikipedia → HTTP 404 (không có bài); Overpass | **KHÔNG XÁC MINH ĐƯỢC** |
| **Bến xe Ga Tháp Chàm** (Ninh Thuận cũ) | Nominatim | **KHÔNG XÁC MINH ĐƯỢC** |
| **Bến xe Bảo Lộc / Đà Lạt** | Nominatim, Overpass | Chỉ có **Bến xe Đức Trọng** (11,72621 ; 108,36964) và **Bến xe Đơn Dương** (11,76016 ; 108,48573) trong OSM; **không có** node "Bảo Lộc" |
| **Bến xe Hàm Thuận Nam / Hàm Tân / Tân Lập / La Gi** (các bến nhỏ dọc QL1 phía Nam Phan Thiết) | Nominatim (4 truy vấn), Overpass | **KHÔNG XÁC MINH ĐƯỢC** — OSM không có node `amenity=bus_station` nào ở đó. Đây là khoảng trống thật, không phải lỗi tìm kiếm |
| **Bến xe Bến Cầu / Bến đò Rạch Giá** | Nominatim, Overpass | **KHÔNG XÁC MINH ĐƯỢC** (ngoài tuyến nghiên cứu) |
| **Địa chỉ chữ chính thức** của 18 bến xe trong bảng C1 (trừ #1, #4, #6, #10, #14, #24, #25) | OSM, Nominatim, Bing, motortrip, vexesapa | **KHÔNG XÁC MINH ĐƯỢC** |

### C5. ⚠️ Mâu thuẫn địa chỉ bến xe phía Nam Nha Trang

| Nguồn | Địa chỉ | Bậc |
|---|---|---|
| [Báo Khánh Hòa, 11/07/2017](https://baokhanhhoa.vn/tau-xe-maybay/201707/cac-tuyen-xe-va-gio-xuat-ben-8046467/) | **Km số 6, đường 23 tháng 10, TP Nha Trang** | **A** (báo chí chính thức tỉnh) |
| OpenStreetMap way/1382446869 + Nominatim reverse | **đường Võ Nguyên Giáp, xã Diên Khánh (xã Diên Lạc), tỉnh Khánh Hòa** | B |

**Vì sao hai nguồn lệch nhau:**
1. **Bài báo năm 2017** mô tả bến xe lúc **trước** khi sáp nhập đơn vị hành chính. Năm 2017, khu vực này thuộc **huyện Diên Khánh**. Sau sáp nhập 2025, OSM ghi **xã Diên Khánh** (đơn vị mới, hợp nhất cả huyện cũ) — nên **phường/xã thì khớp**, chỉ **tên đường** là lệch.
2. Tên đường ở Nha Trang đã được **đổi tên nhiều lần** theo đợt đổi tên đường ở Nha Trang. "Đường 23 tháng 10" và "Võ Nguyên Giáp" có thể là **hai tên khác nhau của hai đoạn khác nhau** chứ không phải cùng một tên.
3. Ngoài ra, sau sáp nhập, **TP Nha Trang không còn là đơn vị hành chính tồn tại như trước** — trung tâm Nha Trang giờ là **phường Nha Trang**; OSM cũng ghi khu vực này là **xã Diên Khánh**, tức nằm **ngoài** phạm vi phường Nha Trang.

> **Kết luận:** địa chỉ hành chính chắc chắn là **Khánh Hòa** (bậc A). Còn lại: *tuyến xe đi qua bến này **không nằm trong phường Nha Trang** mà nằm ở **phường/xã Diên Khánh** phía tây nam.* Sử dụng cho game: **đặt bến xe Nam Nha Trang ở 12,24365 ; 109,09814, gắn với xã Diên Khánh, nằm trên trục QL1 — KHÔNG đặt trong trung tâm phường Nha Trang.**

---

## D. ĐƯỜNG BỘ CAO TỐC VÀ QUỐC LỘ

> ⚠️ **Phân biệt bắt buộc:** **QL1/QL1A** và **hệ thống đường cao tốc (CT.xx)** là **hai hệ thống đường khác nhau**, kể cả khi chạy song song nhau. Không được nhập làm một. Nguồn cho cả hai: Wikipedia (bậc A–B, có trích dẫn văn bản gốc).

### D1. Quốc lộ 1 (gọi tên chính thức là **QL1**, không phải "QL1A")

| Chỉ số | Giá trị | Nguồn |
|---|---|---|
| Tổng chiều dài | **2.482 km** | [en.wikipedia – National Route 1 (Vietnam)](https://en.wikipedia.org/wiki/National_Route_1_(Vietnam)) |
| Chiều rộng mặt đường | **21 m** | cùng nguồn |
| Số cầu | **874** | cùng nguồn |
| Tên đường chính thức | Theo **Quyết định 1454/QĐ-TTg ngày 01/9/2021**, tên là **"Quốc lộ 1"**. OSM ghi chú rõ: *"Quốc lộ 1 là tên chính thức của con đường này… Đề nghị không sửa tên thành Quốc lộ 1A"* | [Quyết định 1454/QĐ-TTg](https://luatvietnam.vn/giao-thong/quyet-dinh-1454-qd-ttg-208660-d1.html) + ghi chú OSM trên way/151688170 |

**Chiều dài QL1 theo tỉnh trên tuyến:**

| Tỉnh/TP | Chiều dài QL1 |
|---|---|
| Đắk Lắk | **123,2 km** |
| Khánh Hòa | **222,8 km** |
| Lâm Đồng | **181,4 km** |
| Đồng Nai | **98,7 km** |
| TP.HCM | **52,5 km** |
| *Tổng 5 đơn vị trên tuyến* | ***678,6 km*** (tính từ các số trên) |

### D2. Các mốc km trên QL1 (dữ liệu định vị cho game)

| Địa điểm | Km trên QL1 | Quãng đường từ mốc trước |
|---|---|---|
| **Tuy Hòa** | **km 1329** | — |
| **Nha Trang** | **km 1450** | + 121 km |
| **Cam Ranh** | **km 1507** | + 57 km |
| **Phan Rang** | **km 1555** | + 48 km |
| **Phan Thiết** | **km 1701** | + 146 km |
| **Long Khánh** | **km 1819** | + 118 km |
| **Biên Hòa** | **km 1867** | + 48 km |
| **Dĩ An** | **km 1879** | + 12 km |
| **TP.HCM** | **km 1889** | + 10 km |

Nguồn: [en.wikipedia – National Route 1 (Vietnam)](https://en.wikipedia.org/wiki/National_Route_1_(Vietnam))

> 📐 **Quãng đường suy ra từ mốc km (Tuy Hòa → TP.HCM):** 1889 − 1329 = **560 km** trên QL1.
> **Dầu Giây** *không có mốc km* trong danh sách nguồn → nằm xen giữa Long Khánh (1819) và Biên Hòa (1867). **KHÔNG XÁC MINH ĐƯỢC** giá trị km chính xác.

### D3. Bảng đường cao tốc (theo Quyết định 1454/QĐ-TTg)

Nguồn danh mục: [Quyết định 1454/QĐ-TTg – Danh mục các tuyến đường bộ cao tốc](https://luatvietnam.vn/giao-thong/quyet-dinh-1454-qd-ttg-208660-d1.html) · Bảng tổng hợp: [en.wikipedia – Expressways of Vietnam](https://en.wikipedia.org/wiki/Expressways_of_Vietnam)

| Mã | Tuyến | Chiều dài | Số làn | Tình trạng | Liên quan tuyến Tuy Hòa – Sài Gòn? |
|---|---|---|---|---|---|
| **CT.01** | Bắc – Nam phía Đông | 2.158 km *(bản khác: 2.063 km)* | 4–10 | Nhiều đoạn đã thông xe | ✅ **Có** – trục chính (mục D4) |
| **CT.02** | Bắc – Nam phía Tây | 1.249 km | — | Đang triển khai từng đoạn | ❌ Không nằm trên tuyến |
| **CT.23** | Phú Yên – Đắk Lắk | 207 km | — | **Đề xuất** | ⚠️ Nhánh nhỏ về vùng Phú Yên cũ |
| **CT.24** | Khánh Hòa – Buôn Ma Thuột | 130 km | — | **Đang xây dựng** | ❌ Hướng Tây Nguyên |
| **CT.25** | Nha Trang – Liên Khuơng | 98 km | — | **Đề xuất** | ❌ Hướng Tây Nguyên |
| **CT.26** | Phan Rang – Liên Khuơng – Buôn Ma Thuột | 184 km | — | **Đề xuất** | ❌ Hướng Tây Nguyên |
| **CT.27** | Dầu Giây – Đà Lạt | 220 km | — | — | ⚠️ Nhánh từ Dầu Giây lên Đà Lạt |
| **CT.28** | Biên Hòa – Vũng Tàu | 54 km | 6–8 | — | ⚠️ Nhánh phía Nam |
| **CT.29** | **TP.HCM – Long Thành – Dầu Giây** | **55 km** | **6–10** | **ĐÃ THÔNG XE toàn tuyến** | ✅ **Có** – xem D5 |
| **CT.30** | TP.HCM – Chơn Thành – Hòa Lư | 130 km | — | — | ❌ |
| **CT.36** | Hồng Ngư – Trà Vinh | 188 km | — | — | ❌ |
| **CT.40** | Vành đai 3 TP.HCM (đoạn **Bến Lức – Long Thành**) | 92 km | 8 | — | ✅ Có (giao CT.29 tại Long Trường) |
| **CT.41** | Vành đai 4 TP.HCM | 199 km | 8 | — | ❌ |
| **CT.46** | Phan Thiết – Bảo Lộc – Gia Nghĩa – Bú Prang | 194 km | — | **Quy hoạch** | ⚠️ Nhánh từ Phan Thiết lên Tây Nguyên |

**Số liệu cả hệ thống:**

| Chỉ số | Giá trị | Ghi chú |
|---|---|---|
| Tổng đã thông xe (2024) | **2.021 km** | [en.wikipedia – Expressways of Vietnam](https://en.wikipedia.org/wiki/Expressways_of_Vietnam) |
| Mục tiêu cuối 2025 | **~3.000 km** | cùng nguồn |
| Mục tiêu 2030 | **~5.000 km** | cùng nguồn |

> ⚠️ **Hai con số chiều dài CT.01 xung đột trong chính nguồn:** **2.158 km** (trang *Expressways of Vietnam*, theo danh mục 1454/QĐ-TTg) vs **2.063 km** (trang *North–South Expressway East*, phần chia đoạn). Chưa xác minh được chênh lệch 95 km nằm ở đâu. Game nên lấy **2.063 km** nếu dựng theo phân đoạn đã thông xe, hoặc **2.158 km** nếu dựng theo quy hoạch dài hạn.

### D4. CT.01 Bắc – Nam phía Đông — các đoạn **trên tuyến Tuy Hòa → Sài Gòn**

Nguồn: [en.wikipedia – North–South Expressway East](https://en.wikipedia.org/wiki/North%E2%80%93South_Expressway_East)

| Đoạn | Tuyến | Chiều dài |
|---|---|---|
| 19 | Chi Thanh – Vạn Phong | 68 km |
| 20 | Vạn Phong – Nha Trang | 51 km |
| **21** | **Hầm đường bộ Đèo Cả** | **14 km** |
| 22 | Vạn Phong – Nha Trang | 83 km |
| 23 | Nha Trang – Cam Lâm | 49 km |
| 24 | Cam Lâm – Vĩnh Hảo | 79 km |
| 25 | Vĩnh Hảo – Phan Thiết | 101 km |
| **26** | **Phan Thiết – Dầu Giây** | **99 km** |
| 27 | TP.HCM – Long Thành – Dầu Giây | 21 km |
| 28 | Long Thành – Bến Lức | 58 km |

> **Tổng 10 đoạn trên = 623 km** (tính từ các số trên).
> **Đèo Cả là "nút thắt" hình học:** đoạn 21 nằm giữa hai đoạn lớn 20 và 22, tức là **tuyến Đèo Cả phải vòng qua bán đảo Đại Lãnh**. Không có cách nào đi "thẳng" từ Tuy Hòa sang Nha Trang trên cao tốc mà không đi qua hầm.
> **⚠️ KHÔNG XÁC MINH ĐƯỢC:** ngày thông xe từng đoạn của **CT.01 đoạn 26 (Phan Thiết – Dầu Giây, 99 km)**. Đã thử: vi.wikipedia (`Cao tốc Phan Thiết – Dầu Giây` → 404; opensearch trả về 0 kết quả), en.wikipedia (404), Overpass, Bing (`VEC tuyến cao tốc Phan Thiết Dầu Giây thông xe` → kết quả toàn về "Vietnam Expo Centre", không liên quan), DuckDuckGo HTML (trả trang rỗng), `expressway.com.vn` (dữ liệu tuyến tải qua AJAX/Liferay, không lấy được từ HTML tĩnh), `luatvietnam.vn` (HTTP 403), `thuvienphapluat.vn` (HTTP 403 Cloudflare). **Cần đào lại bằng nguồn VEC/Son Hai hoặc Bộ GTVT khi có kết nối tốt hơn.**

### D5. CT.29 TP.HCM – Long Thành – Dầu Giây (chi tiết đã xác minh)

Nguồn: [en.wikipedia – Ho Chi Minh City–Long Thành–Dầu Giây Expressway](https://en.wikipedia.org/wiki/Ho_Chi_Minh_City%E2%80%93Long_Th%C3%A0nh%E2%80%93Dau_Giay_Expressway)

| Chỉ số | Giá trị |
|---|---|
| Tổng chiều dài | **55,7 km** |
| Điểm đầu | **An Phú** (Đường Mai Chí Thọ, Thủ Đức) |
| Điểm cuối | Nút giao **Dầu Giây** |
| Nhà đầu tư | **VEC** |
| Khởi công | **03/10/2009** |
| Thông xe Vành đai 2 → QL51 | **02/01/2014** |
| Thông xe nút Vành đai 2 | **29/08/2014** |
| Thông xe An Phú → Vành đai 2 | **10/01/2015** |
| **Thông xe toàn tuyến** | **02/02/2015** (đoạn Long Thành – Dầu Giây dài 31 km) |

**Thông số kỹ thuật:**

| Chỉ số | Giá trị |
|---|---|
| Số làn giai đoạn 1 | **4 làn** |
| Bề rộng nền đường | **27,5 m** |
| Tốc độ thiết kế | **120 km/h** (đoạn An Phú – Vành đai II: **80 km/h**; cầu Long Thành: **100 km/h**) |

**Các nút giao (km):**

| Nút giao | Km | Ghi chú |
|---|---|---|
| An Phú | 0,0 | Điểm đầu, Mai Chí Thọ |
| Đỗ Xuân Hợp | 2,6 | |
| Khang Điền | 3,6 | |
| Vành đai 2 | 5,9 | |
| Global City | 8,7 | |
| Long Trường | 8,7 | giao **CT.40** |
| Long Phước (thu phí) | 10,8 | Trạm thu phí Long Phước |
| Tam An | 14,0 | |
| **Nhơn Trạch** | 19,9 | giao **ĐT 319** |
| **QL51** | 23,5 | |
| **Long Thành** | 25,4 | giao **CT.28** |

> 📌 **Bài học cho game:** CT.29 có **trạm thu phí Long Phước ở km 10,8** — nghĩa là xe khách đi từ Suối Tiên về Dầu Giây sẽ **bị thu phí**, và đây là lý do thực tế nhiều tuyến xe khách **không chạy cao tốc** mà chạy QL1 cũ qua Biên Hòa. Đây là chi tiết hành vi rất quan trọng để mô phỏng, không phải chi tiết trang trí.

### D6. Đèo Cả và Hầm đường bộ Đèo Cả

**Đèo Cả** (ngọn núi, không phải hầm) — nguồn: [vi.wikipedia – Đèo Cả](https://vi.wikipedia.org/wiki/%C4%90%C3%A8o_C%E1%BA%A3)

| Chỉ số | Giá trị |
|---|---|
| Độ cao đỉnh đèo | **333 m** |
| Chiều dài đèo | **12 km** |
| Dãy núi bị vượt | **dãy núi Đại Lãnh** |
| Ranh giới hành chính | Tuyến đèo nằm trên ranh giới **xã Hòa Xuân (Đắk Lắk)** ↔ **xã Đại Lãnh (Khánh Hòa)** |
| Toạ độ đỉnh | **12,871059 ; 109,399146** |
| Đỉnh đèo ở đâu | thôn **Vũng Rô**, xã Hòa Xuân |
| Nằm trên đường nào | **QL1** |
| Tên gọi khác | **Đèo Cục Kịch** |

**Hầm đường bộ Đèo Cả** — nguồn: [vi.wikipedia – Hầm đường bộ Đèo Cả](https://vi.wikipedia.org/wiki/H%E1%BA%A7m_%C4%91%C6%B0%E1%BB%9Dng_b%E1%BB%99_%C4%90%C3%A8o_C%E1%BA%A3)

| Chỉ số | Giá trị |
|---|---|
| **Ngày thông xe** | **21/08/2017** |
| Khởi công | **18/11/2013** |
| Số hầm | **2 hầm song song** |
| Chiều dài mỗi hầm | **4,1 km** (tổng cả hệ thống **13,5 km** kể cả đường dẫn) |
| Số làn | **4** (2 hầm × 2 làn) |
| Tốc độ tối đa trong hầm | **80 km/h** |
| Chiều cao thông xe | **6,5 m** |
| Chiều rộng mỗi hầm | **9,8 m** |
| Toạ độ | **12,854025 ; 109,36525** |
| Chủ đầu tư | **Bộ Xây dựng** |
| Đơn vị quản lý, khai thác | **CTCP Đầu tư Đèo Cả** |
| Nằm trên | **QL1 + CT.01** |

> 📌 **Bài học cho game (quan trọng):** xe khách chạy QL1 qua Đèo Cả từ trước 21/8/2017 phải **leo đèo 12 km**; sau đó có thể chạy **qua hầm 4,1 km**. Đây là **thay đổi hành trình thật**, và game cần quyết định rõ bản đồ dùng hầm (hiện tại, 2026) hay đèo cũ (chế độ lịch sử). Ngoài ra tốc độ trong hầm bị giới hạn **80 km/h** — thấp hơn nhiều so với đường cao tốc.

### D7. ⚠️ Cần xác minh thêm ở phần D

| Mục | Tình trạng |
|---|---|
| Ngày thông xe từng đoạn CT.01 đoạn 26 (Phan Thiết – Dầu Giây) | **KHÔNG XÁC MINH ĐƯỢC** (xem D4) |
| **QL1C** (tuyến đường bộ ven biển Hạ Long – Hải Phòng – Thanh Hóa) và mối liên hệ với CT.01 | **KHÔNG XÁC MINH ĐƯỢC** — chưa tìm được văn bản nào trong phiên này |
| Tuyến **Vũng Rô – Bảo Lộc** — là một đoạn của CT.01 hay một mục quy hoạch riêng? | **KHÔNG XÁC MINH ĐƯỢC** |
| **Giới hạn tốc độ tối đa** của xe buýt / xe khách trên QL1 và trên cao tốc (theo Nghị định 168/2024/NĐ-CP và luật cũ) | **KHÔNG XÁC MINH ĐƯỢC.** Đã thử: vi.wikipedia (`Giới hạn tốc độ` → 404; opensearch `tốc độ tối đa` → 0 kết quả), en.wikipedia, `vanbanphapluat.co` (không kết nối được), `thuvienphapluat.vn` (403 Cloudflare), `luatvietnam.vn` (403), Bing. **Đây là dữ liệu nên lấy trực tiếp từ Nghị định 168/2024/NĐ-CP khi truy cập được Cơ sở dữ liệu quốc gia về văn bản pháp luật.** |
| Số làn / mặt cắt ngang chi tiết của QL1 ở từng đoạn trên tuyến | **KHÔNG XÁC MINH ĐƯỢC** (nguồn chỉ nêu chiều rộng chung 21 m) |

---

## E. ĐỊA DANH / ĐIỂM Đến (POI) TRÊN TUYẾN

> Nguồn toạ độ phần lớn: **OpenStreetMap + Nominatim** (bậc B). Cột "tỉnh sau sáp nhập" phản ánh đơn vị hành chính **mới** (xem mục B).

| POI | Loại | Tỉnh/TP sau sáp nhập | Phường/xã mới | Toạ độ | Ghi chú cho game | Nguồn |
|---|---|---|---|---|---|---|
| **TP Tuy Hòa** (trung tâm) | Thành phố | **Đắk Lắk** | **phường Tuy Hòa** | 13,0881 ; 109,2973 *(Ga Tuy Hòa)* | Thủ phô cũ của Phú Yên; giờ là phường thuộc Đắk Lắk | OSM + Nominatim |
| **Ga Tuy Hòa** | Đường sắt | Đắk Lắk | phường Tuy Hòa, đường **Lê Trung Kiên** | **13,08812 ; 109,29735** | node/668466047 (`railway=station`, wikidata Q60367240) | OSM + Nominatim |
| **Ga Đông Tác** | Đường sắt | Khánh Hòa | — | **13,05576 ; 109,32199** | node/10603324471 | OSM + Nominatim |
| **Đèo Cả** | Núi/đèo | Ranh **Đắk Lắk ↔ Khánh Hòa** | xã Hòa Xuân ↔ xã Đại Lãnh | **12,871059 ; 109,399146** | Đỉnh 333 m, đèo 12 km, trên QL1 | vi.wikipedia (bậc A) |
| **Hầm đường bộ Đèo Cả** | Hầm | Ranh Đắk Lắk ↔ Khánh Hòa | xã Đại Lãnh | **12,854025 ; 109,36525** | Mở 21/8/2017, 2×4,1 km, 80 km/h | vi.wikipedia (bậc A) |
| **Nha Trang** (trung tâm) | Thành phố | **Khánh Hòa** | **phường Nha Trang** | 12,2385 ; 109,1963 | Thủ phô Khánh Hòa | Nominatim |
| **Ga Nha Trang** | Đường sắt | Khánh Hòa | phường Tây Nha Trang, đường Trần Đường | **12,24851 ; 109,18419** | — | OSM + Nominatim |
| **Phan Rang** | Thị xã | **Khánh Hòa** | **phường Phan Rang** | 11,5860 ; 108,9864 (bến xe) | Km 1555 QL1 | OSM |
| **Phan Thiết** | Thành phố | **Lâm Đồng** | **phường Phan Thiết** | 10,9368 ; 108,0954 | Km 1701 QL1 | OSM |
| **Ga Phan Thiết** | Đường sắt | **Lâm Đồng** | **phường Bình Thuận**, đường Lê Duẩn | **10,94184 ; 108,08232** | Cách Bến xe Phan Thiết 3 km | OSM + Nominatim |
| **Mũi Né** | Phường | **Lâm Đồng** | **phường Mũi Né** | 10,95506 ; 108,22556 | Điểm đến du lịch, cách Bến xe Phan Thiết 12 km | OSM + Nominatim |
| **Đà Lạt** | Thành phố | **Lâm Đồng** | phường (nhóm phường Đà Lạt) | — | Thủ phô Lâm Đồng | en.wikipedia (mục A3) |
| **Buôn Ma Thuột** | Thành phố | **Đắk Lắk** | **phường Buôn Ma Thuột** | — | Thủ phô Đắk Lắk | en.wikipedia (mục A3) |
| **Trấn Biên** | Phường | **TP Đồng Nai** | **phường Trấn Biên** | — | Thủ phô TP Đồng Nai | [baochinhphu.vn](https://baochinhphu.vn/trinh-quoc-hoi-viec-thanh-lap-thanh-pho-dong-nai-truc-thuoc-trung-uong-du-kien-hieu-luc-tu-30-4-2026-102260420092248619.htm) |
| **Dầu Giây** | Phường | **TP Đồng Nai** | **phường Dầu Giây** | **10,941446 ; 107,139795** | 98,87 km² · 71.921 người (31/12/2024); giáp xã Gia Kiệm (N), phường Bình Lộc + Xuân Lập (E), xã Xuân Quế (S), xã Bàu Hàm + Hưng Thịnh + Bình An (W); **6 khu phố** | [vi.wikipedia – Dầu Giây](https://vi.wikipedia.org/wiki/D%E1%BA%A7u_Gi%C3%A2y) |
| **Hố Nai** | Phường | **TP Đồng Nai** | **phường Hố Nai** | 10,9669 ; 106,8866 (bến xe) | Bến xe ngay trên Xa lộ Hà Nội | OSM |
| **Biên Hòa** | Phường | **TP Đồng Nai** | **phường Biên Hòa** | 10,9542 ; 106,8091 (bến xe) | Km 1867 QL1; có nút "Tân Vạn" | OSM + Nominatim |
| **Tân Vạn** | Khu phố | **TP Đồng Nai** | **phường Biên Hòa** | **10,91056 ; 106,82787** | Nút giao lớn, cửa ngõ phía Tây Biên Hòa | OSM + Nominatim |
| **Long Bình** | Phường | **TP.HCM** *(trước: Thủ Đức)* | **phường Long Bình** | 10,88159 ; 106,81835 *(đường Hoàng Hữu Nam)* | Chứa Bến xe Miền Đông mới (phía Đông); tên "Thủ Đức" **không còn là tên đơn vị hành chính** | OSM + Nominatim |
| **KCN Nhơn Trạch** | Khu công nghiệp | **TP Đồng Nai** | **phường Nhơn Trạch** | **10,71916 ; 106,92288** | Có bến xe riêng tại 10,7289 ; 106,9050 | OSM + Nominatim |
| **Cầu Long Thành** | Cầu | **Ranh TP.HCM ↔ TP Đồng Nai** | phường Long Phước (TP.HCM) ↔ **xã An Phước** (TP Đồng Nai) | **10,78596 ; 106,86548** | Cầu nối trên CT.29; ranh giới tỉnh nằm **giữa cầu** | OSM + Nominatim |
| **Đông Hòa** | Phường | **TP.HCM** *(trước: Dĩ An, Bình Dương)* | **phường Đông Hòa** | 10,88305 ; 106,81667 *(đường Hoàng Hữu Nam)* | Phía Tây Bến xe Miền Đông mới; **trước đây thuộc tỉnh Bình Dương** | OSM + Nominatim |
| **Hoàng Hữu Nam** | Đường | **TP.HCM** | phường Long Bình | **10,88159 ; 106,81835** | Trục dẫn từ Suối Tiên ra Dầu Giây, song song QL1 | OSM + Nominatim |
| **Suối Tiên** | Khu vực | **TP.HCM** | phường Thủ Đức (nay thuộc TP.HCM) | **10,82833 ; 106,76147** *(Ga MRT số 1 phân đoạn Bến Thành – Suối Tiên)* | Khu vực lễ hội / Trung tâm triển lãm; **tên "Suối Tiên" là tên KHU VỰC, không phải tên phường** | OSM + Nominatim |
| **Bến xe Miền Đông mới** | Bến xe | **TP.HCM** | phường Đông Hòa / phường Long Bình | **10,88024 ; 106,81550** | Mở 10/10/2020; >16 ha; 4.000 tỷ | vi.wikipedia (bậc A) + OSM |
| **Bến xe Miền Đông cũ** | Bến xe (**đã dời**) | TP.HCM | phường Bình Thạnh | **10,81473 ; 106,71125** | 292 Đinh Bộ Lĩnh; ngừng hoạt động 2020 | vi.wikipedia (bậc A) + OSM |

### E1. POI **KHÔNG XÁC MINH ĐƯỢC**

| POI | Đã tìm ở đâu |
|---|---|
| **Cảng Cam Ranh** (Khánh Hòa) | Nominatim → không có kết quả. **KHÔNG XÁC MINH ĐƯỢC** |
| **Cảng Nam Triều** (Phan Rang, Khánh Hòa) | Nominatim → không có kết quả. **KHÔNG XÁC MINH ĐƯỢC** |
| **Ga Tháp Chàm** (Ninh Thuận cũ) | Nominatim → không có kết quả. **KHÔNG XÁC MINH ĐƯỢC** |
| **Bến đò Rạch Giá** | Nominatim → không có kết quả. **KHÔNG XÁC MINH ĐƯỢC** |
| **Phà Cầu Cỏ** | Chưa truy vấn trong phiên này. **KHÔNG XÁC MINH ĐƯỢC** |
| **KCN Nhơn Trạch 1 / 2 / 3 / 4** (từng khu riêng) | Chỉ xác minh được **KCN Nhơn Trạch** nói chung. **KHÔNG XÁC MINH ĐƯỢC** ranh giới từng khu |
| **Trung tâm hành chính các phường mới** (Tuy Hòa, Buôn Ma Thuột, Nha Trang…) | Nominatim (1 truy vấn thử) → không có kết quả. **KHÔNG XÁC MINH ĐƯỢC** |

---

## F. THAM CHIẾU THỜI GIAN & QUÃNG ĐƯỜNG

### F1. Quãng đường — số liệu gốc

| Tuyến | Quãng đường | Cách đo | Nguồn | Bậc |
|---|---|---|---|---|
| **Tuy Hòa → TP.HCM** | **560 km** | **Tự tính** từ mốc km QL1: 1889 − 1329 | [en.wikipedia – National Route 1](https://en.wikipedia.org/wiki/National_Route_1_(Vietnam)) | A–B (số liệu gốc) + tính toán |
| **Tuy Hòa → Sài Gòn** (bến xe → bến xe) | **~562 km** | Nguồn ghi trực tiếp | [motortrip](https://motortrip.vn/dich-vu/ben-xe-nam-tuy-hoa) | C |
| **Nha Trang → TP.HCM** (đường bộ) | **448 km** | Nguồn ghi trực tiếp, báo chí tỉnh | [Báo Khánh Hòa 11/07/2017](https://baokhanhhoa.vn/tau-xe-maybay/201707/cac-tuyen-xe-va-gio-xuat-ben-8046467/) | **A** |
| **Nha Trang → TP.HCM** (theo mốc km QL1) | **439 km** | Tự tính: 1889 − 1450 | cùng nguồn Wikipedia | A–B + tính toán |
| **Nha Trang → Qui Nhơn** | **235 km** | Nguồn ghi trực tiếp | [Báo Khánh Hòa](https://baokhanhhoa.vn/tau-xe-maybay/201707/cac-tuyen-xe-va-gio-xuat-ben-8046467/) | **A** |
| **Tuy Hòa → Bình Định** | **~110 km** | Nguồn ghi trực tiếp | [motortrip](https://motortrip.vn/dich-vu/ben-xe-nam-tuy-hoa) | C |

> ✅ **Đối chiếu chéo thành công:** hai cách đo độc lập cho cùng một cặp điểm (Nha Trang → TP.HCM) cho **448 km** (báo chí tỉnh) và **439 km** (mốc km QL1) — **chênh lệch 9 km ≈ 2%**. Hai cách đo cho Tuy Hòa → TP.HCM cho **560 km** và **562 km** — **chênh 2 km ≈ 0,4%**. ⇒ **Quãng đường ~560 km là chắc chắn.**

### F2. Thời gian — số liệu gốc

| Tuyến | Thời gian | Nguồn | Bậc |
|---|---|---|---|
| **Phú Yên (Tuy Hòa) → Sài Gòn** | **10 – 12 giờ** (tùy tình hình giao thông) | [motortrip](https://motortrip.vn/dich-vu/ben-xe-nam-tuy-hoa) | C |
| **Tuy Hòa → Bình Định** | **2 – 3 giờ** | cùng nguồn | C |
| Tốc độ trong hầm Đèo Cả | **80 km/h** (tốc độ tối đa) | [vi.wikipedia – Hầm đường bộ Đèo Cả](https://vi.wikipedia.org/wiki/H%E1%BA%A7m_%C4%91%C6%B0%E1%BB%9Dng_b%E1%BB%99_%C4%90%C3%A8o_C%E1%BA%A3) | A |
| Tốc độ thiết kế CT.29 | **120 km/h** (đoạn An Phú – Vành đai II: **80 km/h**; cầu Long Thành: **100 km/h**) | [en.wikipedia – CT.29](https://en.wikipedia.org/wiki/Ho_Chi_Minh_City%E2%80%93Long_Th%C3%A0nh%E2%80%93Dau_Giay_Expressway) | A–B |

> ⚠️ **KHÔNG XÁC MINH ĐƯỢC: giới hạn tốc độ tối đa theo luật của xe buýt / xe khách ≥ 29 chỗ** trên QL1 và trên cao tốc. Xem D7. Vì vậy bảng F2 **không có** một dòng "giới hạn tốc độ xe buýt" — đây là khoảng trống quan trọng, đã ghi rõ thay vì đoán bừa.

### F3. Tốc độ trung bình **suy ra được** từ số liệu gốc (không phải con số bịa)

Từ hai cặp (quãng đường, thời gian) ở F1 + F2, ta tính tốc độ trung bình thực tế:

| Tuyến | Quãng đường | Thời gian | Tốc độ trung bình suy ra |
|---|---|---|---|
| Tuy Hòa → Sài Gòn | 562 km | 10 h | **56,2 km/h** |
| Tuy Hòa → Sài Gòn | 562 km | 12 h | **46,8 km/h** |
| Tuy Hòa → Bình Định | 110 km | 2 h | **55,0 km/h** |
| Tuy Hòa → Bình Định | 110 km | 3 h | **36,7 km/h** |

> **Khoảng tốc độ trung bình thực tế của xe khách tuyến này: ~37 – 56 km/h, tâm ~46 – 56 km/h.**
> Đây **không phải** giới hạn tốc độ — đây là tốc độ *thực tế đạt được* sau khi trừ nghỉ dừng, kẹt xe ở các thị trấn, qua hầm 80 km/h, qua cầu, qua đèn đỏ ở đoạn nội thành. Nguồn gốc là nguồn bậc C, nên **coi đây là giá trị tham chiếu, không phải dữ liệu cứng.**

### F4. Quy đổi thời gian theo từng chặng (giả thiết 50 km/h trung bình)

> ⚠️ **Đây là BẢNG TÍNH TOÁN theo giả thiết, không phải số liệu nguồn.** Giả thiết 50 km/h nằm giữa khoảng 46,8 – 56,2 km/h ở F3.

| Chặng | Quãng đường (theo mốc km QL1) | ⏱ Thời gian @ 50 km/h |
|---|---|---|
| Tuy Hòa → Nha Trang | 121 km | 2 giờ 25 phút |
| Nha Trang → Phan Rang | 105 km | 2 giờ 06 phút |
| Phan Rang → Phan Thiết | 146 km | 2 giờ 55 phút |
| Phan Thiết → Biên Hòa | 166 km | 3 giờ 19 phút |
| Biên Hòa → TP.HCM | 22 km | 26 phút |
| **TỔNG Tuy Hòa → TP.HCM** | **560 km** | **11 giờ 12 phút** |

**Đối chiếu:** 11 giờ 12 phút nằm **đúng giữa** khoảng 10–12 giờ mà nguồn nêu. ⇒ Bảng quy đổi này **nhất quán với thực tế**, có thể dùng làm mốc cho game.

### F5. Những thứ **không** có nguồn, tuyệ đối không được bịa

| Cần cho game | Tình trạng |
|---|---|
| Lịch trình cụ thể từng chuyến (giờ xuất phát từng hãng) | **KHÔNG XÁC MINH ĐƯỢC.** Trang motortrip có bảng giờ nhưng **không gắn năm/ngày cập nhật**, dữ liệu lẫn lộn giữa nhiều hãng, **không dùng làm nguồn** |
| Giá vé tuyến Tuy Hòa – Sài Gòn | **KHÔNG XÁC MINH ĐƯỢC** trong phiên này (chưa truy vấn nguồn giá vé) |
| Thời gian nghỉ tại bến, thời gian chuyển bến, thời gian lên/xuống xe | **KHÔNG XÁC MINH ĐƯỢC** |
| Loại xe cụ thể (xe 34 chỗ, 45 chỗ…), số bánh ghế | **KHÔNG XÁC MINH ĐƯỢC** — cần dữ liệu riêng |
| Có bao nhiêu tuyến chính thức Phú Yên/Tuy Hòa ↔ TP.HCM | **KHÔNG XÁC MINH ĐƯỢC** |

---

## G. KẾT LUẬN CHO BUSDRIVEVN

### G1. Những gì đã CHẮC CHẮN và nên hardcode

1. **Chuỗi hành trình 5 tỉnh**: Tuy Hòa (Đắk Lắk) → Nha Trang/Phan Rang (Khánh Hòa) → Phan Thiết (Lâm Đồng) → Dầu Giây/Long Thành/Nhơn Trạch (TP Đồng Nai) → Suối Tiên (TP.HCM).
2. **Quãng đường ~560 km** trên QL1, mốc km từ 1329 (Tuy Hòa) tới 1889 (TP.HCM).
3. **Hệ thống đường là 2 hệ thống riêng**: QL1 (2.482 km, 21 m, 874 cầu) **và** hệ cao tốc CT.xx. Không được nhập làm một.
4. **Đèo Cả**: đèo 12 km / đỉnh 333 m **và** hầm 2×4,1 km (thông 21/8/2017, tốc độ 80 km/h). Đèo Cả nằm trên **ranh Đắk Lắk ↔ Khánh Hòa** (Hòa Xuân / Đại Lãnh) — đây là mốc địa lý để tách 2 tỉnh.
5. **Bến xe Miền Đông cũ đã ngừng hoạt động từ 2020** (292 Đinh Bộ Lĩnh). Bến mới ở Xa lộ Hà Nội, >16 ha, mở 10/10/2020.
6. **Bến xe phía Nam Nha Trang nằm ở xã Diên Khánh, KHÔNG phải trong phường Nha Trang.**
7. **Đơn vị hành chính cấp xã mới** của cả 4 tỉnh — xem mục B. Không còn cấp huyện.

### G2. Những gì CHƯA ĐƯỢC XÁC MINH — không dùng làm dữ liệu cứng

| Mục | Lý do |
|---|---|
| **Toạ độ chính xác Bến xe Nam Tuy Hòa** | OSM có 2 node cách nhau 5,6 km, bằng chứng mâu thuẫn hai chiều (C2) |
| **Phường/xã chứa Bến xe Nam Tuy Hòa** | "phường Phú Lâm" đã bị giải thể; 2 ứng viên rơi vào 2 đơn vị mới khác nhau |
| **Ngày thông xe CT.01 đoạn 26 (Phan Thiết – Dầu Giây)** | Không tìm được nguồn nào fetch được (D4) |
| **Giới hạn tốc độ xe buýt theo luật** | Nghị định 168/2024 không truy cập được (D7) |
| **Bến xe Mũi Né, Tân Biên, Ga Tháp Chàm, các bến nhỏ dọc QL1 phía Nam Phan Thiết** | Không có trong OSM, không có nguồn chữ (C4) |
| **Địa chỉ chữ của 18 bến xe còn lại** | OSM/Nominatim không có trường `addr:*` (C1) |
| **Cảng Cam Ranh, Cảng Nam Triều, Bến đò Rạch Giá, Phà Cầu Cỏ** | Nominatim không trả kết quả (E1) |
| **Lịch trình, giá vé, số chuyến/ngày** | Không có nguồn có đóng dấu thời gian (F5) |

### G3. Bước nghiên cứu tiếp theo (theo thứ tự ưu tiên)

1. **Xem ảnh vệ tinh / Street View tại 2 toạ độ ứng viên bến xe Nam Tuy Hòa** (C2) — nhanh nhất, giải quyết được điểm quan trọng nhất.
2. **Tải Nghị định 168/2024/NĐ-CP từ Cơ sở dữ liệu quốc gia về văn bản pháp luật** (`vbpl.vn`) hoặc Cổng Thông tin điện tử Chính phủ — lấy bảng giới hạn tốc độ theo loại xe (D7).
3. **Đào lại lịch sử thông xe CT.01 từ VEC / Son Hai Group / Bộ GTVT** (D4).
4. **Lấy danh sách hãng xe + tuyến + lịch trình** từ nguồn chính thức: Sở GTVT các tỉnh, hoặc **hiệp hội vận tải hành khách**, hoặc dữ liệu mở của **Vesive** / **Traveloka**. Không dùng trang đặt vé không ghi năm cập nhật.
5. **Bổ sung KCN**: Nhơn Trạch 1–4, và các KCN dọc QL1 ở Đắk Lắk/Khánh Hòa/Lâm Đồng.
6. **Bổ sung địa danh dọc tuyến**: Ga Dầu Giây, Ga Long Khánh, Ga Vũng Tàu, Cầu Cỏ, Bến đò Rạch Giá, Cảng Nam Triều, Cảng Cam Ranh, Bãi Trên Sóng, Kỳ Hòa.

### G4. Rủi ro khi dùng dữ liệu này

| Rủi ro | Mức | Cách xử lý |
|---|---|---|
| Tên phường/xã thay đổi tiếp (đợt rà soát 2026 đã đổi cả trăm đơn vị) | **Cao** | Lưu kèm **ngày hiệu lực** cho mọi tên đơn vị. Đừng hardcode tên mà không có mốc thời gian |
| Toạ độ OSM sai lệch 1–6 km (đã gặp ở Tuy Hòa) | **Cao** | Mọi toạ độ phải có nhãn nguồn bậc B. Không tin tuyệt đối |
| Nguồn bậc C (đặt vé) sai địa chỉ / SĐT / thời gian | **Cao** | Chỉ dùng để gợi ý, không đưa vào dữ liệu map |
| Dùng nhầm "QL1A" thay vì "QL1" | **Trung bình** | **Quyết định 1454/QĐ-TTg quy định tên là "Quốc lộ 1"** |
| Dùng "phường Phú Lâm" / "tỉnh Phú Yên" / "huyện" | **Trung bình** | Tất cả đã bị bãi bỏ hoặc giải thể |
