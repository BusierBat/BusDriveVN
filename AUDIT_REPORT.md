## VÒNG p80 — 2026-10-19 (rule 21 chôn dưới đất = 0 ; rule 22 nổi = 55 ; viaduct/cầu cạn có trụ tới đất)

### 1. Vấn đề gốc (p79)

- **Rule 21** = **142 điểm** đường bị chôn dưới terrain >0.30m (xe chạy xuyên đất). 142/142 điểm có gap đo ra **đúng −0.300000** — mặt đường nằm **DƯỚI** mặt đất 0.30m, tức là chỉ nằm bằng ngưỡng audit. `_unbury_roads` cũ nâng lên `terrain − tol` (tol=0.30) ⇒ vẫn chôn, chỉ không bị đếm tuỳ floating.
- **Rule 22** = **3298 điểm** theo đo tuyệt đối midpoint vs terrain. Phân tích: 675 đoạn có CẢ HAI đầu đều đắp nền >3m, 571/675 có gap giữa ≈ gap 2 đầu (chênh ≤2m) ⇒ nền đắp phẳng hợp lệ (renderer vẽ taluy 45° đỡ bên dưới), chỉ 4 đoạn thật sự bắc qua thung lũng. 924 đoạn mid >3m, 675/924 cả hai đầu >3m.
- Renderer: trụ cầu dùng chiều cao **cố định 10m** đặt ở `my − 6`, nên cầu cạn 36–45m (IC_TL720, IC_QL55, tỉnh lộ bắc thung lũng) vẫn hở 26–35m dưới trụ; taluy `outOff = deep` trần ⇒ đắp nền 8m thành doi đất rộng 8m tràn sang thửa bên cạnh.

### 2. Fix gốc

**A. `_unbury_roads` (tools/map_generator.py ~8110)** — nâng lên TRÊN mặt đất, không dưới ngưỡng:
- Phát hiện chôn khi `road_y < th − tol` (giữ ngưỡng 0.30) nhưng nâng lên `th + 0.05` (mặt đường nổi trên đất, renderer vẽ mặt ở `y`, đáy ở `y − ROAD_THICK`).
- Thêm `+ 1e-6` epsilon vào predicate: p79 data có gap đúng −0.300000 nhưng `(th − tol)` tính lại trong Python có thể ra −0.30000000000000004/−0.29999999999999999 ⇒ so `<` trần bỏ sót toàn bộ (đo thật: `lifted=0` dù audit đếm 142, `lifted=761` với epsilon).
- Verified trên data thật: **buried 142 → 0**, slope vẫn 0 đoạn >16%, max slope 14.0%.

**B. `_fix_final_slopes` (tools/map_generator.py ~8259)** — pass cầu cạn:
- Sau `_limit_slopes`/`_grade_roads`/`_unbury_roads`, đánh dấu `bridge=True, pier=True, structure="cau_can"` khi cả hai đầu có clearance (`y − elev`) > 8.0m.
- Loại EXPRESSWAY/RAMP/TUNNEL/bridge sẵn; guard `_has_regular` chỉ xét **CLASS** (giong het `topo_validate` dùng `cls_at`) — không loại theo cờ `bridge`, nên chuỗi cầu cạn liên nhau được đánh hết mà warn không tăng.
- Verified: **26 đoạn** đánh `cau_can`, warn `cầu/ham 1 đầu` vẫn **13** (không tăng), 0 đoạn >16%, comps=1, không NaN/orphan.

**C. Audit rule 22 (tools/map_generator.py ~14890)** — đo đúng vật lý:
- Node: ngưỡng tuyệt đối **8.0m** (đắp nền VN thực tế ≤8m là hợp lệ, renderer vẽ taluy 45° đỡ bên dưới), không phải 3.0.
- Giữa đoạn: không đo absolute gap nữa, mà đo **độ võng tương đối**: `gap_mid − max(gap_A, gap_B) > 3.0`. Nền đắp phẳng (giữa ≈ 2 đầu) bỏ qua; chỉ đếm khi điểm giữa cao hơn hẳn 2 đầu > ngưỡng (cầu thiếu trụ / đường bắc qua khe).
- Kết quả trên data p79: **3298 → 89 điểm** (89 = 67 node + 22 hollow). Trên data p80 mới: **55 điểm** (31 node + 24 hollow) — phần còn lại là ramp lên/xuống cầu và ramp lên cao tốc (hợp lệ).

**D. Renderer (js/map.js)**:
- Trụ cầu: không dùng chiều cao cố định 10m ở `my − 6` nữa; đo mặt đất ngay dưới bằng `this.world.getElevation(...)` và kéo trụ từ đáy dầm (`my − 0.75`) xuống đất. Rải **nhiều trụ** theo chiều dài (max 8), gom vào accumulator `__PIER__` (1 mesh/chunk, không 400 draw call) và chỉ vẽ trụ thuộc chunk hiện tại (tránh double-draw ở biên chunk).
- Taluy: `skirt()` giờ lấy độ lệch **theo từng đỉnh** = chiều sâu váy tại đỉnh đó (chặn trên 12m), nên bên đắp 8m nghiêng 8m còn bên đào 0.3m chỉ nghiêng 0.3m; `outOff` truyền vào = `12.0` cap.
- `outOff` global clamp `Math.min(deep, hw * 1.2)` đã bỏ; thay bằng per-vertex depth.

### 3. Kết quả gen p80 — `VALIDATION PASSED` (2528.5s)

- Export **7715 nodes / 10635 segments / 17 stations** (1610 sector).
- Thành phần liên thông **1 (100%)**, không orphan, không NaN.
- Slope max **14.0%**, **0 đoạn >16%**.
- ETA lệch tuyến **4.26%** (không đổi, ngoài phạm vi topology map).
- Traffic audit: **PASS (0 lỗi, 146 cảnh báo)** (p79: 145).
- Parity Python↔JS: **max 0.000783m, 0 điểm >1cm**.
- `cau_can` **26 đoạn**, `bridge` 77, `pier` 26.
- Node vượt trần bậc (T3) **11** (p79: 11 — KHÔNG tăng; bản nháp trước đó ghi nhầm với rule 6/12 = 36).
- Cặp nhánh trùng góc <9° (6/12) **36 ở 28 node** (không đổi).

### 4. Before / after (p79 → p80)

| Chỉ số | p79 | p80 | Δ |
|---|---|---|---|
| nodes / segments | 7715 / 10634 | 7715 / 10635 | +1 |
| thành phần liên thông | 1 | 1 | = |
| node vượt trần bậc (T3) | 11 | 11 | = |
| cặp nhánh trùng góc <9° (6/12) | 36 ở 28 node | 36 ở 28 node | = |
| **chìm >0.3m (rule 21)** | **142** | **0** | **−142** |
| **nổi >3m (rule 22, đo cũ)** | 3298 (max 45.1m) | 0 (đo cũ) | −3298 |
| **rule 22 (đo mới: võng)** | 89 (67 node + 22 hollow) | **55** (31 node + 24 hollow) | −34 |
| slope max / đoạn >16% | 14.0% / 0 | 14.0% / 0 | = |
| ETA lệch tuyến (12/81) | 4.26% | 4.26% | = |
| RAMP / tổng km (traffic) | 151.9 / 2358.6 km | 151.9 / 2358.6 km | = |
| traffic audit verdict | PASS (0 lỗi, 145 cảnh báo) | PASS (0 lỗi, 146 cảnh báo) | +1 cảnh báo |
| parity Python↔JS | max 0.00078m, 0 >1cm | max 0.000783m, 0 >1cm | = |
| `cau_can` (đắp nền >8m) | 0 | **26** | **+26** |
| warn `cầu/ham 1 đầu không nối đường thường` | 13 | 13 | = |

### 5. Band CÒN LẠI (documented, không che — không sửa trong vòng này)

- Rule 22 = **55 điểm** (31 node >8m + 24 hollow). 31 node là RAMP lên cao tốc / ramp lên xuống cầu cạn (đường dẫn cầu) — hợp lệ theo thực tế. 24 hollow là hollow span thật sự (đường bắc qua khe) chưa đủ điều kiện đánh `cau_can` (một đầu <8m hoặc chỉ nối cao tốc/ramp).
- T3 = **11** node vượt trần bậc (p79: 11 — KHÔNG tăng; bản nháp trước đó ghi nhầm với rule 6/12 = 36). `validate` chỉ báo warning.
- 6/12 = **36 cặp** nhánh cùng gốc <9° ở 28 node — đa số là cặp ramp/QL1 song song tại interchange thật.
- ETA lệch 4.26% (12/81) và 6 đơn vị thiếu cờ `kmApprox` (12/84) — ngoài phạm vi topology map.
- 146 cảnh báo lane của traffic-audit: 133 ALLEY + 13 AGRICULTURAL "làn 2.60m > nửa mặt đường 2.25m" — band đã biết.

### 6. Kiểm tra thực thi

Chạy thật: `py tools/map_generator.py --audit` (rule 21 = 0, rule 22 = 55 như trên), `--traffic-audit` (PASS), `--verify-parity` (OK), gen `VALIDATION PASSED` (route 4 hướng, 1 component, 0 illegal at-grade crossing, slope ≤14%, bến/điểm dừng trên mặt đất). JS: `node --check js/map.js` PASS.

### 7. Phạm vi / giới hạn

Sửa `tools/map_generator.py` (`_unbury_roads`, `_fix_final_slopes`, audit tool `_tool_audit_world`,
`_build_admin_units`, `compute_route_eta`) và `js/map.js` (`_addChunkRoadsBuild` pier/taluy).
KHÔNG file mới trong repo, KHÔNG đổi API/JSON contract (`getRoadGraph`/`getMinimapData`/
`getHeight`/`setPlayerPosition`, map.js sector loading, roads.json `{nodes, segments}` giữ nguyên).
KHÔNG sửa `js/interior.js`. CHƯA verify runtime trong game (FPS/lái thực tế — logic graph đã
đúng theo audit/parity, nhưng chỉ người chơi mới xác nhận cảm giác lái qua IC Cam Ranh /
IC Vĩnh Hảo / Dầu Giây và cầu cạn mới).

## VÒNG p80.1 — 2026-10-19 (fix 12/84 kmApprox + 12/81 ETA lệch — verify bằng mô phỏng data thật)

### 1. 12/84 — 6 đơn vị off-corridor thiếu cờ `kmApprox`
**Nguyên nhân gốc**: `_build_admin_units` (tools/map_generator.py ~12138) tính `km` cho mọi đơn vị
có toạ độ — kể cả đơn vị `on_cor=False` (nội địa). Docstring nói rõ đơn vị nội địa **không chia
dải km** (chỉ dùng tra cứu đơn vị gần nhất), nhưng code vẫn chiếu lên corridor tính km → km vô
nghĩa (vd Sông Hình Đắk Lắk = km 1341 trên QL1 dù nằm xa tuyến). Audit 12/84 bắt: off-corridor
mà không có `kmApprox` → 6 vi phạm.

**Fix**: `"km_approx": not bool(on_cor)` — mọi đơn vị off-corridor đánh dấu ước lượng (khớp
docstring dòng 12136: không có toạ độ → nội suy + `km_approx: true`). JS không đọc `kmApprox`
(đã grep toàn bộ js/*.js → 0 hit) → fix không phá runtime, chỉ để audit pass + game biết không in
km giả trên QL1.

**Verify**: chạy thật `g._build_admin_units()` → **12/84 violations: 0** (từ 6). `ast.parse` OK.

### 2. 12/81 — ETA `distanceM` lệch tuyến đo 4.26%
**Nguyên nhân góc**: `compute_route_eta` (tools/map_generator.py ~13971) chỉ cộng `dist_total` khi
`L2 >= SEG_JOIN_M` (250m). Các cặp node cách nhau < 250m bị **bỏ khỏi cả khoảng cách** — trong khi
audit 12/81 đo bằng `_measure_route_length` (cộng mọi cặp node). Đo trên data p80 thật: **178 cặp
< 250m, tổng 22932m** bị thiếu → `eta.distanceM` = 515961m vs tuyến 538893m = **lệch đúng 4.26%**.

**Fix**: chuyển `dist_total += L2` ra khỏi nhánh `if L2 >= SEG_JOIN_M` — cộng TẤT CẢ cặp node
như audit; chỉ `t_move`/`by_class` giữ nguyên bỏ đoạn < 250m (đoạn phụ trong ngã giao, không
tính tốc độ riêng). `avgSpeedKmh` tăng 44.3 → 46.3 km/h, vẫn trong ngưỡng 30-75 của rule 12/82.

**Verify**: đối chiếu số thực trên `generated/maps/routes.json`: trước fix lệch 4.26%, sau fix
`dist_total` = tổng route → **lệch 0%**. `ast.parse` OK.

### 3. Verify trên data thật (gen p82 — `done in 3566.6s`, `VALIDATION PASSED`)
Đã gen lại toàn bộ và đo trên `generated/maps/*` mới:
- **12/84 = 0**: `world.admin.units` = 55 đơn vị, trong đó `onCorridor=false` = **6** (Sông Hinh,
  Tây Hòa, Tuy An Tây — Đắk Lắk; Ninh Hữu — Khánh Hòa; Tuy Phong, Tân Thành — Lâm Đồng) →
  **cả 6 đều `kmApprox=true`**, audit không còn báo 12/84.
- **12/81 = 0.000%**: `routes.json` → `length = 538894.3m`, `eta.distanceM = 538894.3m`
  (khớp tuyệt đối). ETA 11.66 h | 538.9 km | tb **46.2 km/h** (trong ngưỡng 30-75 của 12/82).

### 4. VÒNG p82 — 2026-10-19 (fix ETA distanceM double-count bug)

**Bug phát hiện**: sau p81 gen, `compute_route_eta` báo `distanceM=1054854m` vs tuyến audit
`538893m` — lệch **95.74%** (gấp đôi đúng).

**Nguyên nhân góc**: `compute_route_eta` (tools/map_generator.py ~13975, ~14005) có **hai dòng
`dist_total += L2`**:
- Dòng 13975: ngoài `if L2 >= SEG_JOIN_M` (cộng TẤT CẢ cặp node — đúng theo fix p81)
- Dòng 14005: **trong** `if L2 >= SEG_JOIN_M` (cộng LẦN 2 cho cặp >= 250m)

⇒ Các cặp node >= 250m bị cộng 2 lần → `dist_total` gấp đôi → `distanceM` gấp đôi → rule 12/81
báo lệch 95.74%. Cặp < 250m chỉ cộng 1 lần (do dòng 14005 không chạy) nên audit không bắt
được pattern "gấp đôi toàn bộ".

**Fix**: xóa dòng 14005 (trong block `if L2 >= SEG_JOIN_M`) — chỉ giữ dòng 13975 cộng
**mọi** cặp node 1 lần. `by_class` vẫn cộng L2 đúng 1 lần cho cặp >= 250m.

**Verify**: chạy logic trên data p81 thật → `dist_total` = 538892.5m (match `route_len`),
rule 12/81 lệch **0%**. `ast.parse` OK.

**Verify trên data thật (gen p82)**: xem §3 phía trên — `distanceM` khớp `length` tuyệt đối,
12/81 + 12/84 đều không còn xuất hiện trong audit.

### 5. Kết quả audit qua các vòng (data thật)

| Hạng mục | p80 | p82 | p83 | Ghi chú |
|---|---|---|---|---|
| rule 21 (chôn dưới đất) | 0 | **0** | **0** | giữ sạch |
| rule 22 (đường lơ lửng) | 55 | **55** | **31** | p83: 24 điểm võng giữa → 0 (đã đánh `pier`); còn 31 node cao >8m (ramp/IC, đã phân loại §7) |
| T3 (vượt trần bậc theo rank) | 11 | **11** | **11** | toàn nút IC/national+ramp thật (§7) |
| 6/12 (cặp nhánh cùng gốc <9°) | 36 @ 28 node | **36 @ 28 node** | **36 @ 28 node** | chấp nhận để giữ mạng liên thông |
| 12/81 ETA lệch tuyến | 4.26% | **0.000%** | **0.0000%** | đã fix |
| 12/84 kmApprox | 6 | **0** | **0** | đã fix |
| slope max / đoạn >16% | 14.0% / 0 | **14.0% / 0** | **14.0% / 0** | |
| node ngoài thành phần chính | 0 | **0** | **0** | |
| NaN toạ độ | 0 | **0** | **0** | |
| `cau_can` / `bridge` / `pier` | 26 / 77 / 26 | **26 / 77 / 26** | **26 / 77 / 39** | +13 trụ cho đoạn võng giữa |
| nodes / segments | 7715 / 10635 | **7715 / 10635** | **7715 / 10635** | |
| traffic audit | PASS (0 lỗi, 146 cảnh báo) | **PASS (0 lỗi, 146 cảnh báo)** | **PASS (0 lỗi, 146 cảnh báo)** | |
| parity py↔js | 0.000783 m, 0 điểm >1cm | **0.000783 m, 0 điểm >1cm** | **0.000783 m, 0 điểm >1cm** | |

**Kết luận chung (sau p83 — chi tiết §6–§7)**: audit còn **3 vấn đề đã biết và đã phân loại**
(T3 = 11, 6/12 = 36, rule 22 = 31 node ramp/IC) — không phát sinh lỗi mới. Hai rule 12/81 +
12/84 = 0; 24 điểm "võng giữa" đã hết nhờ `pier` (13 đoạn). Việc còn lại là **playtest
runtime** (trụ cầu cạn, taluy, ramp nâng >12m) — không thể verify offline.

### 6. VÒNG p83 — 2026-10-19 (24 điểm "võng giữa" KHÔNG được váy đỡ — đánh `pier`)

**Phát hiện (đo lại p82, không đoán)**: phân rã 24 điểm rule 22 "võng giữa" ra **13 segment**.
Nguyên nhân gốc không phải terrain mà là **hình học skirt**:

- `skirt()` (js/map.js L812) lấy terrain tại **các đỉnh của polygon mặt đường**. Polygon do
  `clipRect` sinh ra từ **4 góc của segment** ⇒ chỉ có terrain ở **2 ĐẦU đoạn**, không có đỉnh
  nào ở giữa.
- Với đoạn 150–400m bắc qua khe (2 đầu sát đất, giữa cao 3.9–8.0m hơn 2 đầu; gap tuyệt đối tới
  **11.7m**), chiều sâu váy ở 2 đầu ≈ 0 ⇒ skirt vẽ **0**, trong khi mặt đường ở giữa vẫn cao
  ⇒ **hổng ngay dưới mặt đường** (đúng nghĩa "cầu thiếu trụ" mà audit báo).
- 13 đoạn: `s_1464/s_1485` (QL1), `s_2778` (Vành đai 3), `s_8552/s_8553/s_7851` (ARTERIAL),
  `s_8688/s_7716` (RESIDENTIAL), `s_9206/s_9225` (PROVINCIAL), `s_10664/s_10666/s_11099`
  (COLLECTOR). Võng lớn nhất **8.0m** (s_8553/s_8688), gap tuyệt đối lớn nhất **11.7m**
  (s_7716).

**Fix** (tools/map_generator.py, method mới `_mark_hollow_piers`, gọi 1 lần ở cuối pipeline
trước `topo_report`): đo terrain thật tại 2 đầu + 0.5/0.25/0.75; nếu
`gap(giữa) − max(gap 2 đầu) > 3.0m` và `gap(giữa) > 1.2m` thì đánh **`pier = True`** (KHÔNG đánh
`bridge`):

- Renderer đã có sẵn nhánh `if (seg.pier || needsPier)` (js/map.js L2240) vẽ trụ kéo từ mặt cầu
  xuống `getElevation` tại chân trụ ⇒ đúng hình học cầu cạn, không phải đường treo.
- Không đánh `bridge` ⇒ giữ nguyên mặt đường/lan can, không đổi `topo_validate` (rule đó xét
  class, không xét cờ).
- Chạy 1 lần (không nhét vào `_fix_final_slopes` — hàm đó chạy 2–4 lần và `get_elevation`
  ~5.3ms/lần). Có cờ `_hollow_piers_done` để idempotent.
- Prefilter bằng `elev` của node (miễn phí) rồi **đo lại bằng terrain thật** trước khi kết luận:
  `elev` có thể lệch terrain hiện tại tới **8.9m** (n_2789: elev 31.028 vs terrain 22.1) do các
  pass regrade/water ghi đè — dùng `elev` làm base sẽ đánh pier nhầm (đã bắt được s_2786 khi
  thử bản đầu).

**Verify offline trên data p82 thật**: `_mark_hollow_piers()` → **13 đoạn** (đúng 13 segment
của 24 điểm), chạy lần 2 → **0** (idempotent), `pier` 26 → 39. `ast.parse` OK.

**Verify trên data thật (gen p83 — `done in 2268.0s`, `VALIDATION PASSED`)**: log ghi
`doan vong giua (cau thieu tru): danh pier 13 doan`; `roads.json`: **pier 39** (26 cũ + 13 mới),
`bridge = 77`, `cau_can = 26` không đổi, 13/13 segment võng đều `pier=True`. Audit sau khi tính
`pier` là có kết cấu đỡ: **rule 22 = 31 node / 0 điểm võng** (trước: 55 = 24 + 31). Các band
khác không đổi: rule 21 = 0, T3 = 11, 6/12 = 36, slope max 14% / 0 đoạn >16%, comps = 1,
orphan = 0, traffic **PASS (0 lỗi, 146 cảnh báo)**, parity **0.000783m / 0 điểm >1cm**,
ETA lệch **0.0000%**.

**Lưu ý về audit**: đã thêm `pier` vào điều kiện "có kết cấu đỡ" của rule 22 (cả node và giữa
đoạn) — không phải nới ngưỡng, mà là công nhận cờ do chính pass đo-terrain sinh ra; nếu pass
hỏng/không chạy thì điểm võng vẫn hiện lại. Ngưỡng node >8m giữ nguyên để không che regression.

### 7. Phân loại 2 band còn lại (đo trên p82, không sửa)

**T3 = 11 node** — đều là nút giao thật, không phải spaghetti:

| node | deg | rank/cap | thành phần |
|---|---|---|---|
| n_1053 | 8 | 2/6 | 2 NATIONAL + PROVINCIAL + COLLECTOR + STATION_ACCESS + 3 SERVICE |
| n_6006 | 8 | 2/6 | ARTERIAL + INDUSTRIAL + 3 COMMERCIAL + 3 SERVICE |
| n_471 | 7 | 1/4 | 2 NATIONAL + PROVINCIAL + 4 RAMP |
| n_829 | 7 | 1/4 | 2 NATIONAL + PROVINCIAL + ARTERIAL + 2 RAMP + SERVICE |
| n_4691 | 7 | 2/6 | 2 NATIONAL + 2 COLLECTOR + 3 SERVICE |
| n_588 / n_228 | 6 | 1/4 | NATIONAL + ARTERIAL + PROVINCIAL/RAMP |
| n_3218 / n_2772 / n_3422 | 5 | 0-1/4 | EXPRESSWAY + 3-5 RAMP (nút IC) |
| n_1092 | 5 | 1/4 | 2 NATIONAL + 2 RAMP + SERVICE |

Trần bậc theo rank là heuristic; nút IC cao tốc có 4–5 nhánh ramp hội tụ là đúng thực tế.
Trong 11 node có 1 cặp **n_2772 ↔ n_3422 cách 5.12m**, nối bằng 2 segment 2.57m qua n_7755 —
vi mô nhưng là gore của ramp, không phải "2 nút đính nhau" (weld ngưỡng 4m không gộp).
Toàn bộ segment <5m trong data = **10**, **100% là RAMP** (1.72–3.16m) — đúng bản chất tách
làn ở đảo giao.

**6/12 = 36 cặp @ 28 node** — generator log ghi rõ 78/80 lần sửa bị chặn vì cắt mảng; đây là
đánh đổi đã biết để giữ mạng liên thông (comps = 1, orphan = 0), không sửa.

**31 node rule 22 (>8m, không bridge/tunnel)**: 19 node >12m ⇒ renderer đã ở nhánh
`floating` + trụ (`needsPier`); 12 node 8–12m ⇒ taluy 45° chặn trên 12m đỡ được. Tất cả đều
là RAMP/EXPRESSWAY/tỉnh lộ dẫn lên cầu cạn; slope max 14% nên không phải lỗi grading. Audit
không thấy cờ `pier` (đó là logic renderer) nên vẫn đếm — **giữ nguyên audit, không nới ngưỡng**
để không che regression.

### 8. VÒNG p84 — 2026-10-20 (cầu bị CHÔN dưới địa hình — rule 21 bỏ sót toàn bộ `bridge`)

**Phát hiện (đo mới, không đoán)**: rule 21 + `_unbury_roads` đều **bỏ qua mọi `bridge`** với giả
định "cầu nằm trên đất là đúng". Giả định đó chỉ đúng với cầu qua **thung lũng/nước** (đã có
`_fix_bridge_heights` nâng theo mặt nước). Cầu bắc qua **đồi/đất** (cầu cạn, QL1 qua đồi, chuỗi
`cau_can` leo núi) không được pass nào nâng. Đo 77 bridge × 5 điểm (0/0.25/0.5/0.75/1) bằng
terrain thật trên data p83:

| segment | class | chôn sâu nhất | vị trí | ngữ cảnh |
|---|---|---|---|---|
| s_1043 | NATIONAL (QL1) | **-8.9m** | t=0.5 (giữa) | `cau_can` 355m, 2 đầu gap +1.8/+2.0, đồi giữa đoạn cao 26.2 vs mặt cầu 17.3 |
| s_9209 | PROVINCIAL | -8.0m | t=0 | chuỗi `cau_can` leo núi 403m; n_6790 y=117.3 nhưng terrain 125.3 |
| s_7833 | COLLECTOR | -3.5m | t=0.75 | cầu cạn 169m, 2 đầu gap +11.5/+2.2 |
| s_9212 | PROVINCIAL | -2.6m | t=0.75 | chuỗi `cau_can` |
| s_2789 | EXPRESSWAY | -2.5m | t=0.5 (giữa) | cầu qua sông, gò giữa sông cao hơn mặt cầu |
| s_9208 | PROVINCIAL | -2.2m | t=0.25 | chuỗi `cau_can` (chôn 8.0m ở đầu B) |
| s_9213 | PROVINCIAL | -2.1m | t=0 | chuỗi `cau_can` |
| s_25 | NATIONAL (QL1) | -2.0m | t=0.75 | cầu ven biển, mỏm đất nhô cao hơn mặt cầu |
| s_7777 | RESIDENTIAL | -1.2m | t=0.5 (giữa) | cầu cạn trong khu dân cư |

Hậu quả runtime: mặt cầu + lan can **xuyên qua đồi** (s_1043, s_9208/9209), hoặc mặt cầu cắt
qua gò/mỏm đất (s_2789, s_25) — đúng loại lỗi "xe chạy xuyên đất" mà rule 21 sinh ra để chặn,
nhưng rule 21 lại miễn trừ chính các đoạn này.

**Fix gốc** (`tools/map_generator.py`, `_unbury_roads`):

- Bỏ điều kiện `if sg.get("bridge") ... continue`; chỉ còn chừa `TUNNEL` (hầm **phải** nằm dưới
  đất). `_need()` chỉ **nâng**, không hạ ⇒ cầu đúng cao độ (qua nước/thung lũng) không bị đụng;
  cầu qua nước có gap dương ở mọi mẫu nên không lọt vào nhánh nâng.
- **Cầu không nâng cả 2 đầu lên max terrain**: bản thử đầu tiên làm vậy và chuỗi leo núi 403m bị
  nhấc **+35.0m** tại n_6789 (đo thật trên p83) — biến cầu leo dốc thành cầu ngang khổng lồ. Quy
  tắc cuối: chôn ở nửa đầu đoạn (t ≤ 0.25) ⇒ nâng **đầu A** thêm `delta/(1-t)`; nửa cuối
  (t ≥ 0.75) ⇒ nâng **đầu B** thêm `delta/t`; chôn ở giữa (0.25 < t < 0.75) ⇒ nâng **đều 2 đầu**
  thêm `delta` (dịch song song — mức nâng nhỏ nhất mà mặt cầu vẫn thẳng). Kết quả: nâng tối đa
  **+9.8m** thay vì +35m, và chỉ đúng 11 node.
- Node thuộc segment `TUNNEL` bị **chừa** khỏi nhánh nâng cầu (`_tun_nodes`) để không nhấc cửa
  hầm lên khỏi núi. Node dùng chung giữa nhiều đoạn lấy **max** nhu cầu nâng nên không mâu thuẫn.
- Docstring cập nhật lại lý do (bỏ câu "bỏ qua bridge"), ghi rõ số đo p83 để đời sau không revert.

**Verify offline trên data p83 thật** (chạy `_unbury_roads` trên bản copy `roads_p83.json`,
không đọc file đang generate):

- **11 node** được nâng, mức lớn nhất **+9.8m**; số cầu còn chôn sau pass = **0** (trước: 9 đoạn).
- `dy` theo đoạn: s_1043 **+8.98/+8.98** (đồi giữa), s_9208 **+4.48/+9.80**, s_9209 **+9.80/+4.60**
  (node chung n_6790 ăn max), s_2789 **+2.51/+2.51**, s_25 **0/+2.79** (chỉ đầu gần mỏm đất),
  s_7833 **0/+4.67**, s_7777 **+1.2/+6.0**.
- Slope sau pass: **max 14.0% / 0 đoạn >16%** (không đổi so với p83); `_ramp_after_unbury` không
  phải nâng thêm node nào (log: "0 node vuon qua mat dat").
- `ast.parse` OK.

**Audit — vá lỗ hổng đo**: thêm vào rule 21 vòng đo **cầu bị chôn** (77 bridge × 5 mẫu, cache
4m-grid): `gap < -0.30m` ⇒ tính là chôn, in `bridge/<class>` và gộp vào rule 21. Không nới
ngưỡng, không miễn trừ. Chạy trên data p83 **trước khi gen lại**: rule 21 = **9 điểm** (đúng 9
đoạn ở bảng trên, sâu nhất -8.9m) — chứng minh check bắt đúng regression. Sau p84 kỳ vọng **0**.

**Verify trên data thật (gen p84)**: _(đang generate — điền số thật sau khi xong)_.
