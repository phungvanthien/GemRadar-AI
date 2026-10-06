# Bug: Token báo "rugpull" sai (false positive) trên UI

**Ngày:** 2026-10-05
**Mức độ:** P0 — ảnh hưởng trực tiếp kết quả giao dịch (ghi lỗ giả, đóng vị thế đang lành)

---

## 1. Hiện tượng

Trong ví vẫn còn token, token **chưa** bị rugpull, nhưng giao diện portfolio
hiển thị vị thế đã bị `rugpull` và book một khoản lỗ đã-thực-hiện (realized loss).

Đây là **false positive**: vị thế lành bị đóng và ghi mất vốn chỉ vì
worker bán hụt vài lần, không phải vì token thực sự bị rug.

---

## 2. Nguyên nhân gốc rễ

Logic phát hiện rugpull dựa **chỉ** vào số lần bán thất bại liên tiếp, mà
**không phân biệt loại lỗi**.

### Luồng code

1. Mỗi tick, exit worker gọi `sell()`. Nếu swap lỗi, một fill có `error` được
   ghi vào ledger. Chuỗi lỗi có dạng `${status}:${reason}`
   (xem [jupiter-swap.ts:257-266](src/lib/jupiter-swap.ts#L257-L266) — `applyOutcome`).

2. [`consecutiveSellFails()`](src/lib/position-store.ts#L283) đếm **mọi** fill
   sell có `error` liên tiếp (chỉ bỏ qua `reason === "reconcile"`):

   ```ts
   if (f.error) { run += 1; } else { break; }
   ```

3. [`RUGPULL_WRITEOFF_FAILS = 3`](src/lib/trade-exit.ts#L64). Khi chuỗi lỗi đạt 3,
   [`maybeWriteOffRugpull()`](src/lib/trade-exit.ts#L68) gọi
   [`writeOffPosition(pos.id, "rugpull")`](src/lib/position-store.ts#L305):
   - `soldPct = 100`, `status = "closed"`, `closedReason = "rugpull"`
   - book phần vốn còn lại thành lỗ đã-thực-hiện (`realizedPnlSol -= lostSol`)

### Vì sao sai

Không phải mọi lỗi bán đều có nghĩa token bị rug. Các mã lỗi mà `sell()` có thể
sinh ra:

| Mã lỗi (chuỗi `error`)        | Ý nghĩa thật                                  | Có phải rug không?        |
|-------------------------------|-----------------------------------------------|---------------------------|
| `failed:onchain:...`          | TX bị cluster từ chối on-chain                | Có thể — cần xem lý do    |
| `quote-no-route` *            | Jupiter không tìm được route swap             | **Đúng tín hiệu rug**     |
| `price-impact` *              | Price impact vượt trần cấu hình               | Thanh khoản cạn — ~rug    |
| `unknown:fetch failed`        | Jupiter host chết / mạng lỗi                  | **KHÔNG** — hạ tầng       |
| `unknown:confirm-timeout`     | Không xác nhận được; TX **có thể đã land**    | **KHÔNG** — không rõ      |
| `unknown:status-null`         | RPC chưa thấy status                          | **KHÔNG** — tạm thời      |
| `quote-http` / `swap-http`    | Jupiter trả HTTP 5xx tạm thời                 | **KHÔNG** — hạ tầng       |

\* `quote-no-route` và `price-impact` được throw dưới dạng `GuardError` trước khi
`executeSwap` chạy, nên nằm trong `error` của fill qua khối `catch` ở
[trade-exit.ts:362-389](src/lib/trade-exit.ts#L362-L389).

Điểm nguy hiểm nhất là nhóm `unknown:*`. Theo chính comment trong
[jupiter-swap.ts:86-95](src/lib/jupiter-swap.ts#L86-L95), `unknown` nghĩa là
**"TX CÓ THỂ ĐÃ thực hiện"** — không được coi là bằng chứng token không bán được.
Vậy mà hiện tại nó vẫn bị tính vào chuỗi "rugpull".

### Khớp với lịch sử

Memory `alphahunter-external-api-bugs` ghi: Jupiter host `quote-api.jup.ag/v6` từng
chết và trả về lỗi `fetch failed`. Đúng loại lỗi `unknown:fetch failed` ở trên — nếu
tái diễn (hoặc chỉ cần mạng chập chờn 3 tick), mọi vị thế đang mở sẽ bị ghi
"rugpull" sai hàng loạt dù token hoàn toàn lành.

### Nguyên nhân gốc THỨ HAI: feed gap ở Jupiter Price API v3

Exit engine lấy giá từ **Jupiter Price API v3** (`lite-api.jup.ag/price/v3`),
KHÁC với quote endpoint dùng để bán. Nếu một mint tạm thời không có trong phản hồi
Price v3, `monitorPositions` thấy `price == null` →:

1. Bỏ qua mọi quyết định bán bình thường (stop-loss, ladder...) cho tick đó, VÀ
2. Trong chế độ live, chạy nhánh **rugpull-probe**
   ([trade-exit.ts:264-320](src/lib/trade-exit.ts#L264-L320)) — probe một lệnh bán
   để "lỗi no-route/price-impact tích lũy vào chuỗi fail".

Nhưng token vẫn bán được qua quote endpoint — chỉ là **Price v3 thiếu giá tạm
thời**, không phải rug. Bằng chứng từ `gemradar-positions.json`: cả 3 vị thế
(WSOS, CEZ, ECTF) đều có fill sell với `priceUsd: 0` → feed không trả giá. Chúng bị
`manual-writeoff` (bạn bấm nút trên UI khi thấy báo không bán được), chứ không phải
code tự động — nhưng gốc rễ giống nhau: **feed gap bị hiểu nhầm là token chết.**

---

## 3. Hệ quả

- Vị thế lành bị đóng, giải phóng slot sai thời điểm.
- Lỗ giả được book vào `realizedPnlSol` → sai mandate equity, drawdown, đường P&L.
- Moon-bag bị vứt (write-off không tôn trọng phần hold).
- Token vẫn nằm trong ví nhưng hệ thống coi như đã mất → lệch sổ sách vs on-chain.

---

## 4. Phương án khắc phục

### 4.1. Phân loại lỗi — chỉ đếm lỗi "token không bán được" (ưu tiên cao nhất)

Sửa `consecutiveSellFails()` để **chỉ** đếm các fill có lỗi thuộc nhóm thật sự chỉ
ra token không thể bán, và **reset/bỏ qua** nhóm lỗi hạ tầng/không-rõ.

- **Đếm (tín hiệu rug):** `quote-no-route`, `price-impact`,
  `failed:onchain:*` (TX bị chain từ chối một cách xác định).
- **Bỏ qua (không phải rug):** `unknown:*` (gồm `fetch failed`, `confirm-timeout`,
  `status-null`), `quote-http`, `swap-http`, `swap-no-tx`, `missing-signer`.

Cách triển khai gợi ý: thêm một helper phân loại dựa trên tiền tố chuỗi `error`
(vì `error` đã mang sẵn `status:reason` hoặc `GuardError.code`). Để làm sạch, nên
ghi thêm `errorCode` (lấy từ `GuardError.code`) vào `Fill` khi record, thay vì
so khớp chuỗi message dễ vỡ.

```ts
// position-store.ts — phác thảo
const RUG_ERROR_CODES = new Set(["quote-no-route", "price-impact"]);

function isRugSignal(f: Fill): boolean {
  if (!f.error) return false;
  if (f.errorCode && RUG_ERROR_CODES.has(f.errorCode)) return true;
  if (f.error.startsWith("failed:onchain:")) return true; // TX bị chain từ chối xác định
  return false; // unknown:*, *-http, fetch failed... = hạ tầng, KHÔNG tính
}
```

Trong `consecutiveSellFails()`: một fill có `error` nhưng **không** phải tín hiệu
rug thì **bỏ qua** (continue), không cộng run và cũng không break — để một hiccup
hạ tầng xen giữa không che mất chuỗi rug thật, nhưng cũng không tự tạo ra chuỗi rug giả.

### 4.1b. Fallback giá qua quote khi Price v3 thiếu giá (đã làm)

Trong `monitorPositions`, sau `fetchPrices`, với mỗi mint thiếu giá (live), lấy giá
qua **sell quote** (`quotePriceUsd`: quote token → WSOL, suy giá USD từ giá SOL —
WSOL luôn có trong Price v3). Nếu quote có route → token vẫn bán được → điền giá và
để exit engine quyết định bình thường, KHÔNG rơi vào nhánh rugpull-probe. Nếu quote
no-route → đúng là tín hiệu rug, đi tiếp đường cũ. Đây là tín hiệu phân biệt
feed-gap vs rug chính xác nhất vì nó mô phỏng đúng lệnh exit thật.

### 4.2. Xác minh bằng số dư on-chain trước khi write-off (chốt chặn an toàn)

Trước khi `writeOffPosition(..., "rugpull")`, kiểm tra lại số dư token on-chain
(đã có sẵn `getTokenBalance` + `reconcileFromChain` dùng ở
[trade-exit.ts:248-258](src/lib/trade-exit.ts#L248-L258)):

- Nếu ví **vẫn còn** token và có **route báo giá hợp lệ** (quote không lỗi) →
  **không** write-off; đây là bằng chứng token vẫn bán được.
- Chỉ write-off khi: hết route **và** (số dư ~0 hoặc mọi quote đều no-route).

Đây là chốt chặn độc lập với 4.1, chống đúng kịch bản bạn gặp: "token còn trong ví
nhưng bị báo rugpull".

### 4.3. Tăng ngưỡng + yêu cầu kéo dài theo thời gian (phòng thủ chiều sâu)

- Nâng `RUGPULL_WRITEOFF_FAILS` (vd 3 → 5) **và** yêu cầu chuỗi lỗi kéo dài tối
  thiểu một khoảng thời gian thực (vd ≥ N phút) chứ không chỉ đếm số tick — tránh
  việc 3 tick sát nhau trong một sự cố mạng ngắn gây write-off.

### 4.4. Khôi phục & minh bạch trên UI

- Với các vị thế **đã bị** đánh dấu `rugpull` sai mà token còn trong ví: cần một
  đường phục hồi (reconcile lại từ on-chain, mở lại vị thế hoặc đảo khoản lỗ giả).
- UI nên phân biệt rõ: `closed (rugpull — không bán được)` vs
  `tạm thời không bán được (đang thử lại)` để không hiển thị "rugpull" khi chỉ là
  lỗi hạ tầng.

---

## 5. Thứ tự ưu tiên đề xuất

1. **4.1** — chặn ngay nguồn gây false positive (thay đổi nhỏ, tác động lớn).
2. **4.2** — chốt chặn on-chain trước mọi write-off.
3. **4.4** — khôi phục dữ liệu đã sai + làm rõ UI.
4. **4.3** — gia cố thêm.

## 6. Kiểm thử cần có

- Unit test `consecutiveSellFails`: chuỗi `unknown:fetch failed` × 5 → **0** (không rug).
- Unit test: chuỗi `quote-no-route` × 3 → đạt ngưỡng rug.
- Unit test: `onchain-fail × 2` + `unknown:fetch failed × 2` + `no-route × 1` →
  đếm đúng theo quy tắc (hạ tầng không che chuỗi rug thật).
- Integration: giả lập Jupiter host chết → vị thế **không** bị write-off.

## 7. File liên quan

- [src/lib/position-store.ts](src/lib/position-store.ts) — `consecutiveSellFails`, `writeOffPosition`
- [src/lib/trade-exit.ts](src/lib/trade-exit.ts) — `maybeWriteOffRugpull`, `RUGPULL_WRITEOFF_FAILS`, nhánh rugpull-probe
- [src/lib/jupiter-swap.ts](src/lib/jupiter-swap.ts) — `applyOutcome`, phân loại `SendOutcome`, các mã `GuardError`
- [src/lib/trade-wallet.ts](src/lib/trade-wallet.ts) — `GuardError`, `assertPriceImpactOk`
- [src/components/dashboard/portfolio-panel.tsx](src/components/dashboard/portfolio-panel.tsx) — hiển thị write-off / rugpull
