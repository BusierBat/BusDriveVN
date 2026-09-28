# BusDriveVN

Game mô phỏng lái xe khách Việt Nam. Tuyến chính: **Phú Yên → Khánh Hòa → Ninh Thuận
→ Bình Thuận → Đồng Nai → TP.HCM**.

Slogan: *PentiumStudio — Code. Create. Play.*

---

## 1. KIẾN TRÚC — file nào là gì

| File | Vai trò | Ghi chú |
|---|---|---|
| `tools/map_generator.py` | **SOURCE OF TRUTH** của thế giới | Sinh ra toàn bộ `generated/maps/` |
| `js/map.js` | **MAIN LOADER** — terrain, road, chunk streaming, bến xe, giao lỡ | Không có loader thứ hai |
| `js/RuntimeRoadGraph.js` | Đồ thị đường + A* (routing) | Source of truth cho world / minimap / NPC |
| `js/main.js` | Vòng game, xe người chơi, input | |
| `generated/maps/world.json` | terrain (coast, corridor, anchors), water, spawn | |
| `generated/maps/roads.json` | nodes / segments (hierarchy, class, width, bridge, tunnel) | |
| `generated/maps/stations.json` | bến xe, trạm nghỉ, cây xăng, điểm dừng, trạm thu phí | |
| `generated/maps/sectors/` | chunk địa hình 4×4 chunk / 1 file (1024m) | ~1.9k file thay vì ~14k |

**Lớp Y (bất biến của cả project):**

```
terrainY   = world.getElevation(x, z)      // js/map.js, COPY NGUYÊN VĂN Python
node.y     = generator.get_road_datum(x,z) // = terrainY tại điểm đó
road top   = node.y + ROAD_LIFT  (0.12)
bus.y      = map.getTerrainHeight(x,z) + 0.5
```

Hệ quả: bánh xe luôn chạm mặt đường → **không bay, không chìm**. Đo bằng
`tools/verify_parity.py` (sai số JS↔Python phải < 1cm).

---

## 2. CHẠY GAME

```powershell
python -m http.server 8137
# mở http://127.0.0.1:8137/index.html
```

Cần server (không mở `file://` trực tiếp — game dùng `fetch` + ES module).

## 3. SINH LẠI MAP

```powershell
python tools\map_generator.py
```

Mất ~15-20 phút (giai đoạn `[5/8] Buildings` là nặng nhất). Ghi đè
`generated/maps/`. **Phải chạy lại generator sau mọi thay đổi topology/terrain.**

### 3a. Smoke test tầng topology (~2.5 phút, không đặt nhà)

```powershell
python _smoke_topo_no_virus_trust_me_bro.py
```

Chạy đúng `generate_topology()` rồi in `topo_validate()`, phân bố bậc node
toàn mạng và **phân bố bậc node trong từng sân bến**. Dùng để lặp luật mà
không mất 15 phút cho mỗi lần chạy đầy đủ. **Luôn chạy cái này trước khi
chạy generator đầy đủ** — 6/10 lần sửa lỗi chỉ lộ ra ở đây.

### 3b. TẦNG TOPOLOGY — đừng sửa hậu xử lý, hãy sửa thuật toán sinh

`tools/map_generator.py` có một tầng riêng, **không phải** hậu xử lý vá từng
bến:

| Thành phần | Vai trò |
|---|---|
| `TOPO_RANK` | bậc phân cấp: 0 cao tốc … 5 đường trong sân |
| `TOPO_LEGAL` | ma trận cấp nối hợp pháp, **tự kiểm đối xứng lúc import** |
| `TOPO_DEGREE_CAP` | trần bậc **theo rank** (4/4/6/6/6/8), không phải hằng số |
| `TOPO_JUNCTION_SPACING` | khoảng cách tối thiểu giữa 2 nút giao trên 1 đường |
| `CROSS_MISS = 100` | ngưỡng "ngã giao bị THIẾU thật" (dùng chung với audit) |
| `topo_link_ok()` | **cổng chặn duy nhất**; trả `(False, lý do)` đếm vào `_topo_reject` |
| `topo_branch_h()` | hướng nhánh mới = **giữa khe góc trống lớn nhất** |
| `_split_road_near()` | tạo ngã giao thật bằng cách **chia đôi** đường tại điểm cắt |
| `_resolve_crossings()` | mọi cặp cắt → nút giao thật (tách trước, nối sau) |
| `_add_segment_like()` | tạo lại segment mà **giữ** cờ `bridge`/`pier` |
| `topo_validate()` | cổng thứ hai, chạy đầu `validate()` và **chặn export** |
| `topo_report()` | in đường nào bị từ chối + vì sao, và phân bố bậc |

**Nguyên tắc số 1: cổng chặn phải nói lý do.** `_topo_reject` là bảng đồ đo
"map thiếu đường là do lựa chọn hay do lỗi". Không có nó thì mỗi lần map mỏng
đi ta không biết mình đã hy sinh bao nhiêu và vì sao.

**Nguyên tắc số 2: node bậc ≥ 3 mới là "ngã giao thật".** Node bậc 2 chỉ là
*điểm hình học giữa đường*. Generator và audit phải dùng **cùng định nghĩa**
(`_topo_near_junction(..., min_deg=3)`) — lệch định nghĩa thì một bên in
"0 nút giao mới" trong khi bên kia báo 218 giao lỗ.

### 3c. Đo đúng đại lượng, đừng đo đại lượng khác

Mỗi dòng dưới đây là một bug đã **đo được** rồi mới sửa:

| Kiểm tra | Sai lầm | Đúng là |
|---|---|---|
| Giao lỗ | "2 đường cắt mà không chia sẻ node" (239 cái) | điểm cắt **cách ngã giao thật > 100m** |
| Bậc node | trần cứng 8 | trần **theo rank** — không thì node 7-9 nhánh không bao giờ bị xử lý rồi validate mới lỡ ra |
| Hierarchy | "lệch > 1 bậc" (660 lỗi sai) | dùng **chính `TOPO_LEGAL`** của generator (import, không viết lại) |
| Degree-1 | đếm cả ALLEY/INTERNAL/SERVICE | chỉ đường **phủ** bị cắt (làn đỗ cụt là đúng thiết kế) |
| Trùng góc | đếm node bậc 2 với ngưỡng 26° (427 lỗi) | chỉ node bậc ≥ 3, ngưỡng **9°** — khớp audit |
| Khoảng cách điểm dừng | chênh lệch **chainage** trên trục tuyến, ngưỡng 600m | **khoảng cách 2D thật**; 2 điểm dừng xen kẽ 2 bên đường chiếu cùng 1 node tuyến nên chainage bằng nhau → báo "0m" giả. Đo thật: cặp gần nhất **4955m**. Ngưỡng trùng lặp **150m** |
| Object trong vùng bến | AABB không xoay, bỏ bán kính | cùng rect **đã xoay** + bán kính như lúc đặt |
| T7 đoạn dài | không có luật nào | > 2km cảnh báo, > 8km **chặn export** |

### 3d. Bug hình học "im lặng" — luật chặn phải có sẵn

`_add_link_road` từng dùng **vector pháp tuyến chưa chuẩn hoá**:

```python
nx, nz = -dz, dx                       # độ lớn = L, KHÔNG phải 1
off = math.sin(math.pi * t) * 60       # ≤ 60
pts.append((lerp(a.x, b.x, t) + nx*off, ...))   # lệch ngang L*60
```

Với `L = 2km` thì lệch **120.000m**; `sin(πt)` đối xứng nên ra đúng **vòng
đi–về 100km** (đo được: `RING3_LINK_QL` 19 đoạn / 562km, đoạn dài nhất
51 334m). Hệ quả: 588km **mặt tiền ảo** → ~63.000 **nhà phát sinh trên đường
không tồn tại**.

Hai bài học:
1. Vector pháp tuyến **luôn** phải chuẩn hoá (`-dz/L, dx/L`).
2. Loại bug này **im lặng** — không có luật nào bắt. Phải có luật T7 *trước khi*
   nó xảy ra, không phải sau.

Ngoài ra còn một loại node mất âm thầm: `_build_provincial_routes` cố chia
nhỏ mỗi 400m nhưng khi `add_segment` thất bại thì `continue` và **giữ `prev`
cũ** → 2 node còn lại cách nhau 17km. Sửa tổng quát bằng
`_densify_long_segments(900.0)`: bất kỳ đoạn nào dài hơn 900m đều được cắt
bằng node hình học (không qua cổng khoảng cách vì đây **không phải** tạo ngã
giao).

### 3e. Đừng tin "số nhà giảm" là mất chất lượng

225.939 → 162.879 nhà trông như mất 28% chất lượng. Đo mặt tiền mới biết:
2378.5km → 1764.1km, trong đó **588km là ARTERIAL ảo** sinh ra từ bug pháp
tuyến ở trên. Số nhà giảm vì **63.000 nhà nằm trên đường không tồn tại** —
đó là sửa, không phải mất. Đừng kết luận từ một con số tổng.

### 3f. 8 nguyên nhân gốc đã sửa (không hard-code bến nào)

1. **Mọi làn đỗ nối vào 2 node góc** → lưng thang + hành lang nối zíc-zắc;
   bãi phân bố **đều theo chỉ số** (đừng chọn node gần nhất: bãi dồn cục bộ
   làm chạm trần bậc, đo được 22/24).
2. **Node giữa đường là `junction` mới 70m** → `type: "link"`, chỉ tạo nút giao
   khi đủ khoảng cách.
3. **`_grow_road` ngoắt vào bất kỳ node nào cách < 16m** → chỉ nối node hợp lệ
   qua cổng.
4. **Nhánh lấy góc `random ± 90°`** → giữa khe góc trống lớn nhất.
5. **Lưới thị trấn warp bằng bán kính (418m) trong khi bước lưới 195m** → lưới
   tự gấp lên trên thân chính nó; đổi thành `0.36 × bước lưới`.
6. **Phố cắt QL1A đều "ngoắt" vào cùng node QL** (fallback `_ql_near`) →
   `_split_road_near()` chia đôi QL tại điểm cắt, **mỗi nút QL1A chỉ nhận
   đúng 1 phố cắt qua**, và phố song song QL (<35°) không tạo nút giao.
7. **Mũi làn đỗ chọc vào nhà ga** (4/5 bến) → spine đặt sau mặt trước nhà ga.
8. **`_topo_rank` khởi tạo `best = 4`** → node chỉ có INTERNAL (rank 5) bị kẹp
   về 4, trần bậc lấy nhầm `[4]=6`; mọi bến chỉ đặt được **đúng 16 bãi** (kể cả
   Miền Đông Mới 16/50). Khởi tạo `9` + `n_spine` scale theo số bãi.

### 3g. Những thứ khác phát hiện khi **verify** (không phải lúc code)

| Lỗi | Nguyên nhân | Sửa |
|---|---|---|
| **PARITY FAIL 39.8m** | `world.json` không có key `uz` → JS tự dựng lại bảng u từ corridor đã làm tròn. **Hai bảng độc lập của cùng một bảng** | generator export `terrain.uz` + `uzAmbig`; JS đọc thẳng |
| **PARITY còn 52.75m** | `_uAtZ` tính bin key bằng `Math.ceil` cho số âm, Python dùng `int(math.floor(...))` → lệch 1 bin, JS rơi vào nhánh `_uNearest` | `Math.floor` |
| **Cầu vượt mất cờ `bridge`** | `_split_*` / `_safe_relocate` tạo lại segment chỉ copy class/width/name → 22 nhánh cầu vượt thành đường thường cắt ngang cao tốc | `_add_segment_like()` giữ `bridge`/`pier` |
| **JS vẽ sân bến lệch khung** | JS tự hardcode layout; phép quy đổi World→cục bộ **hoán ox/oz và sai dấu** → 4/5 bến mũi làn đỗ nằm trong nhà ga | generator export `yardOx`/`yardOz`/`structures[]`; JS dùng thẳng toạ độ cục bộ + `_toLocalX/_toLocalZ` đúng chiều |
| **Tuyến minimap rách** | `routes.json` tham chiếu node đã bị xoá (đo được `n_109`) | `_repair_route_refs()` + `_node_xy_hist` nhớ toạ độ node đã chết |
| **QL1A nối thẳng mặt cao tốc** | nút có cả EXPRESSWAY + NATIONAL | `_split_ql_from_expressway()` tách thành cầu vượt, giữ liên thông `nid→nn→far` |
| **QL1A giao CT01 bị gọi là lỗi** | audit T5 xét class, không xét cờ `bridge` | giao khác mức hợp pháp — audit bỏ qua node có nhánh cầu |
| **3 đường "nối mù" đâm cao tốc** | `_build_facilities`, `noi_manh` (2 chỗ), `_link_dangling_major` gọi `add_segment` **trực tiếp**, bỏ qua cổng | chặn `_node_touches_expressway` ở cả 4 |

### 3i. 12 sửa tìm ra khi VERIFY data, không phải lúc code (P16 → P29)

Toàn bộ dưới đây là lỗi **đã có trong data** và chỉ lộ ra khi chạy audit +
đọc lại con số — không phải lúc viết code. Không cái nào vá được bằng cách
"thêm vài dòng cho đỡ lỗi"; tất cả đều sửa nguyên nhân gốc ở tầng thuật toán.

| # | Lỗi đo được | Nguyên nhân gốc | Sửa ở đâu |
|---|---|---|---|
| P16 | 149 nút có 2 nhánh trùng góc (<9°) | `TOPO_MIN_ANGLE` **khai báo từ trước nhưng không dùng ở đâu cả** | đưa vào `topo_link_ok` → còn 28 |
| P17 | Game **không vào được** | `importmap` trỏ `cdn.jsdelivr.net`; browser bị proxy chặn (`ERR_TUNNEL_CONNECTION_FAILED`) trong khi PowerShell vẫn tải được 1.27MB | **vendor Three.js** vào `vendor/three/` — game chạy offline |
| P18 | Sàn bến "bị nâng", xe xuyên vào | `baySlots[].y = get_road_datum(...) + 0.5` — **nơi duy nhất trong toàn file** cộng 0.5 vào toạ độ vật thể; mọi chỗ khác dùng datum trần | bỏ `+0.5` |
| P19 | 34 cảnh báo "object trong vùng bến" | `validate` đo bằng **AABB không xoay**, lúc đặt dùng **rect đã xoay** + bán kính | dùng đúng `_seg_hits_rect` như lúc đặt |
| P20 | 38 nút trùng góc còn lại đều là nút QL1A | `_build_settlements._link` gọi `add_segment` **trực tiếp**, bỏ qua cổng | cho qua `topo_try_link` |
| P21 | 5 cảnh báo "object trong vùng bến" còn lại | Chính là **tâm sân** — `_station_complex` reserve đúng `(cx,cz)` để chặn nhà mọc trong sân, rồi validator quét lại chính nó | bỏ qua tâm sân |
| P22 | **Tuyến dài 3357km**, hop tới 379km | `_node_xy_hist` (bảng nhớ toạ độ node đã chết) **bị mất khỏi `add_node`** ⇒ `hint = None` ⇒ `d = 0.0` cho *mọi* node ⇒ 4 node chết thay bằng 4 node bất kỳ | ghi lại lịch sử toạ độ; **không bao giờ gép node khi không biết nó ở đâu** (bỏ waypoint còn hơn lệch 379km) |
| P23 | 41 nhánh địa phương chạm thẳng mặt cao tốc (39 cái **không có tên**) | Chúng đến từ *nhiều* nơi gọi `add_segment` trực tiếp. Vá từng hàm thì lần sau lại lọt | **đặt luật trong chính `add_segment`** — một điểm duy nhất, không chỗ nào lách được |
| P24 | 34 nút trùng góc | `tinh_lo_*` bám QL1A ở góc **5.1–5.5°** (đo ở `n_52`, `n_70`) — đường chạy song song QL1A rồi dí vào | cho qua cổng |
| P25 | Cần miễn cho `INTERNAL`/`STATION_ACCESS` | Chúng cùng `hierarchy = 5` nên bị P23 chặn, mà đường nội bộ là đường **cuối cùng** nối sân ra cổng | chỉ chặn `TOPO_SMALL_ROAD` — đúng danh sách mà `audit_world.py` rule 11 dùng |
| P26 | Audit và generator trôi lệch nhau | Mỗi bên tự định nghĩa "đường địa phương" / ngưỡng riêng | `TOPO_SMALL_ROAD` + `TOPO_MIN_LINK_LEN` **import chung từ generator** |
| P28 | 191 cặp nút giao cách nhau <45m | **Không phải lỗi toàn bộ.** Đo lại: phân bố mượt (8/25/21/20/22/31/27/37 theo nhóm 5m) ⇒ phần lớn là **ngõ 30m giữa hai khối, bình thường**. Chặn 45m đại trà sẽ xoá 191 đoạn thật và **làm thưa khu phố** | `TOPO_MIN_LINK_LEN` **theo bậc**: cao tốc 60m, ramp 25m, QL1A/tỉnh lộ 45m, phố 0 (không chặn) |
| P27 | 48 cặp nút <6m | 48/48 là class `INTERNAL` **trong sân bến**, dài 5.92m — **chính là layout bãi đỗ** (mỗi bãi 1 node). "Sửa" theo cảnh báo này sẽ xếp 48 node làm 1 và xoá sân | bỏ qua sân trong `topo_validate` |

#### Ba bài học rút ra (đắt hơn code)

1. **Hằng số khai báo mà không dùng là một lỗi chưa nổ.** `TOPO_MIN_ANGLE` nằm
   đó từ lâu, ai cũng tưởng luật góc đã có. Grep `TOPO_MIN_ANGLE` mới thấy
   nó **chỉ xuất hiện 1 lần** — ngay ở chỗ khai báo.
2. **Đặt luật ở tầng thấp nhất, đừng rải ở các hàm gọi.** P23 ban đầu vá
   4 chỗ; chỗ thứ 5 thì lọt. Chuyển vào `add_segment` là xong — mọi đường
   đều đi qua đúng một điểm đó.
3. **Cảnh báo sai cũng là một loại bug, và nguy hiểm hơn bug vì nó dạy mày
   sửa sai.** P19 (34 lỗi giá) và P27 (48 cặp) đều là cảnh báo sai. Nếu tao
   "sửa" theo chúng thì map sẽ mất sân bến. Đo lại đại lượng trước khi tin
   cảnh báo.

### 3h. BẢO VỆ FILE KHỎI BỊ MẤT

`tools/map_generator.py` và `tools/audit_world.py` **không được git track cho
tới 2026-09-27**. Một lần khôi phục working tree về snapshot cũ đã **xoá sạch
tầng topology** mà không có cách nào khôi phục — `git checkout` không đụng tới
file untracked. Từ nay cả hai đã được `git add` (commit `2cfaeac`).

**Đừng bao giờ để file nguồn chính nằm ngoài git.**

---

## 4. TEST — bắt buộc chạy, không "thấy là được"

### 4.1 Audit data (Python, chỉ đọc)

```powershell
python tools\audit_world.py
```

Kiểm tra rule 6/7/8/9/11/12/14/15/16/20/22/31/34/39/53/57/58/59/60/62/63:
topology, đường chồng nhau, nhánh trùng góc, node >6 nhánh, dead-end spam,
bến xe nằm trên cao tốc / không có lối vào, nhà trên đường, station chồng nhau,
route, bbox thế giới, data contract.

Exit code ≠ 0 nghĩa là còn lỗi. Sửa tới khi sạch.

### 4.2 Parity terrain JS ↔ Python (chống xe bay)

```powershell
python tools\verify_parity.py
```

### 4.3 Probe trong game (đo thật, không cần nhìn mắt)

Mở game, bấm **LÁI XE THÔI**, rồi trong Console:

```js
await import('/tools/world_probe.js');
WP.probeAll()        // chạy tất cả
```

| Hàm | Đo gì |
|---|---|
| `WP.driveRoute(step)` | quét dọc tuyến 518km: chỗ mất đường, chỗ giật cao, chỗ xe chìm |
| `WP.driveGrounding(step)` | bus.y vs mặt đường dọc tuyến (rule 20/35) |
| `WP.junctionPatch(n)` | raycast sàn giao lỡ: có lỗ không, node có nằm trong sàn không |
| `WP.junctions()` | phân bố bậc node, ngã tư, nhánh bay |
| `WP.structures()` | cấu trúc từng bến: bay, đường nội bộ, lối ra đường chính |
| `WP.occupancy()` | nhà nào nằm trên mặt đường |
| `WP.perf(frames)` | FPS, draw call, triangle, instance, RAM |

`window.__busvn.tick(n)` dựng n khung hình thủ công (tab ẩn thì `requestAnimationFrame`
bị treo nên không đo được FPS).

### 4.4 Test thủ công

Lái thật qua: Nam Tuy Hòa → Đèo Cả → Nha Trang → Phan Rang → Phan Thiết →
Dầu Giây → Hoàng Hữu Nam → Bến xe Miền Đông Mới. Kiểm: xe không bay/chìm,
ngã ba không có vạch vẽ xuyên nhau, bến xe có xe, minimap khớp world.

---

## 5. NGUYÊN TẮC ĐỤNG ĐOẠN NÀY THÌ ĐỪNG SỬA

1. **`js/map.js` là loader chính.** Không tạo loader thứ hai.
2. **Generator là source of truth.** Sửa data phải sửa `tools/map_generator.py`,
   không sửa JSON tay.
3. **Lớp Y là bất biến.** Đổi công thức terrain phải sửa **cả hai** bên
   (Python + `js/map.js`) rồi chạy `verify_parity.py`.
4. **Giao lỡ là polygon thật.** Không được vẽ chồng quad rồi hy vọng engine hiểu.
5. **Không hard-code map theo kiểu spawn → vài đường → hết.**
6. **Không tạo file rác / hệ thống song song.** Mọi thứ vào `tools/`.
7. **Sửa xong phải chạy game thật**, không chỉ compile.

---

## 6. TỦ CHỨC

```
BusDriveVN/
├── index.html
├── style.css
├── js/                     runtime
├── assets/                 texture / model
├── tools/
│   ├── map_generator.py    SOURCE OF TRUTH
│   ├── audit_world.py      kiem tra data (rule ...)
│   ├── verify_parity.py    parity terrain JS <-> Python
│   └── world_probe.js      probe trong game (do that)
└── generated/maps/         du lieu sinh ra (KHONG sua tay)
```
