# Post-mortem: 3 lệnh live đầu tiên (2026-10-02 → 2026-10-03)

Kết luận và đề xuất cải tiến sau 3 lệnh live, tổng kết quả lỗ. Dựa trên
`alphahunter-positions.json` và code hiện tại (`trade-exit.ts`, `worker.py`,
`spam-filter.ts`).

## 1. Kết quả thực tế

Vốn mỗi lệnh: 0.05 SOL. Cả 3 đều là token pump.fun (đuôi `pump` / meme).

| Token   | Entry (USD)   | Peak    | Kết thúc            | PnL SOL     | Lý do đóng       |
|---------|---------------|---------|---------------------|-------------|------------------|
| SIP     | 0.00066148    | 1.03x   | −99.5% so với entry | **−0.0448** | stop-loss (muộn) |
| CATGPT  | 0.00019643    | 1.31x   | priceless / 0       | **−0.0500** | manual-writeoff (rugpull) |
| POKEMON | 0.00063188    | 2.29x   | chốt t2 @2x rồi sập | **+0.0032** | ladder-t2 + stop-loss |

**Tổng: −0.0916 SOL / 0.15 SOL vốn ≈ −61%.**

Win rate 1/3, nhưng con thắng (POKEMON) chỉ +0.0032 trong khi 2 con thua
lấy đi −0.095. Đây là mẫu hình kinh điển: **lời thì nhỏ, lỗ thì to.**

## 2. Nguyên nhân gốc

### 2.1 Stop-loss vô dụng vì poll quá chậm (nghiêm trọng nhất)

- Config `x.pollIntervalMinutes: 60` ([worker.py:115](scripts/tg-worker/worker.py#L115)),
  và `monitorPositions` chỉ chạy mỗi tick.
- SIP: stop-loss đặt 35% → lẽ ra bán ở ~$0.00043. Thực tế bán ở
  **$0.0000031 (−99.5%)**. Nghĩa là giữa 2 tick, giá đã sập hết và bot
  không kịp phản ứng.
- Logic stop-loss trong [trade-exit.ts:112](src/lib/trade-exit.ts#L112) là
  **đúng** — vấn đề nằm ở tần suất quan sát, không phải ở ngưỡng.

> Token pump.fun sập trong vài giây đến vài phút. Một exit engine quan sát
> 60 phút/lần về bản chất không có stop-loss cho lớp tài sản này.

### 2.2 Không có bộ lọc entry cho token pump.fun / tuổi đời

- `spam-filter.ts` chỉ lọc **tín hiệu social** (bot X, group Telegram ảo),
  không hề đánh giá bản thân token: tuổi, thanh khoản, LP đã khoá chưa,
  phân bổ holder, % top-10.
- CATGPT rugpull mất sạch 100% — không có cổng nào chặn trước khi vào.
- Cả 3 đều là meme pump.fun đời rất ngắn → rủi ro rug cực cao, nhưng bot
  vẫn vào full size như nhau.

### 2.3 Sizing cào bằng, không theo niềm tin / rủi ro

- Cả 3 lệnh đều 0.05 SOL bất kể điểm gem hay mức rủi ro rug.
- Với lớp tài sản mà kỳ vọng là "1 con 10x gánh 9 con về 0", sizing phẳng
  khiến đường vốn phụ thuộc hoàn toàn vào việc có trúng con 10x hay không.

### 2.4 Ladder chốt lời quá sớm so với kỳ vọng gem

- POKEMON đạt peak 2.29x nhưng ladder-t2 chốt 50% ngay ở 2x, phần còn lại
  dính stop-loss khi sập. Lời thực chỉ +0.0032.
- Với chiến lược săn gem (kỳ vọng vài con 10x+), chốt 50% ở 2x cắt mất đuôi
  lợi nhuận — đúng thứ mà cả mô hình dựa vào.

## 3. Đề xuất cải tiến (ưu tiên từ cao xuống thấp)

### P0 — Giảm poll interval cho exit engine (bắt buộc, rẻ, hiệu quả nhất)
- Tách **tần suất quan sát exit** khỏi tần suất quét social. Exit nên chạy
  **mỗi 15–30 giây** (hoặc dùng websocket giá), social vẫn 60 phút.
- Nếu không muốn tách tiến trình: thêm vòng lặp exit riêng với
  `exitPollSeconds` mặc định ~20s, độc lập với `pollIntervalMinutes`.
- Kỳ vọng: stop-loss SIP sẽ kích ở ~−35% thay vì −99.5% → cứu được
  ~0.03 SOL/lệnh trong tình huống tương tự.

### P0 — Thêm cổng lọc token trước khi vào lệnh
Trước khi mua, kiểm tra on-chain / API:
- LP đã khoá / mint authority đã revoke chưa (chặn rug kiểu CATGPT).
- Thanh khoản tối thiểu (vd ≥ $20–30k) để stop-loss còn khớp được giá.
- Phân bổ holder: top-10 không quá X%, số holder tối thiểu.
- Tuổi token tối thiểu (vài phút sống sót lọc được phần lớn snipe-và-rug).
- Giữ nguyên triết lý "conservative" như spam-filter: nhiều tín hiệu yếu
  cộng lại, không hard-block bằng một tín hiệu đơn.

### P1 — Dynamic position sizing theo điểm gem + rủi ro rug
- Size = f(gemScore, rugRisk). Rug risk cao → size nhỏ hơn hoặc bỏ qua.
- Giới hạn tổng vốn đồng thời ở nhóm rủi ro cao nhất.

### P1 — Chốt lời theo bậc "để đuôi chạy" cho chiến lược gem
- Giữ moon bag lớn hơn, hoặc đẩy tier đầu lên 3x thay vì 2x, để không cắt
  đuôi 10x. Cân nhắc trailing-stop thay cho ladock cứng khi đã qua 2x
  (POKEMON đã `trailingArmed: true` nhưng ladder vẫn bán trước).

### P2 — Hạ tỷ trọng / gắn cờ riêng cho token pump.fun thuần meme
- Nếu dữ liệu tiếp theo xác nhận pump.fun = EV âm, giảm size mặc định hoặc
  yêu cầu điểm social/holder cao hơn hẳn mới cho vào.

## 4. Việc cần làm tiếp để kết luận vững hơn
3 lệnh là **mẫu quá nhỏ** để kết luận chiến lược. Trước khi đổi lớn:
- Chạy lại ở **sim mode** với poll interval mới + cổng lọc token, so sánh
  trên ≥ 30–50 lệnh.
- Log thêm: lý do vào lệnh (điểm gem, nguồn tín hiệu), thanh khoản tại
  entry, khoảng cách giữa 2 tick khi stop-loss kích.

---
*Tạo tự động từ phân tích 3 lệnh đầu. Số liệu PnL lấy trực tiếp từ
`realizedPnlSol` trong ledger.*
