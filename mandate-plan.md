# Kế hoạch: Cơ chế uỷ thác ví săn gems bằng vốn SOL

## Mục tiêu

Người dùng uỷ thác ví (server tự quản — giữ mô hình `TRADE_WALLET_SECRET_KEY` hiện tại)
để bot tự động săn gems bằng **một phần vốn SOL được chỉ định**, với:

1. **Phân bổ & position sizing** — tách vốn uỷ thác khỏi tổng số dư ví; size lệnh theo
   % vốn thay vì SOL cố định; giữ reserve; giới hạn số vị thế mở đồng thời.
2. **Risk management tổng** — drawdown stop toàn danh mục, daily loss limit, auto
   kill-switch khi thủng ngưỡng.
3. **Minh bạch & rút vốn** — dashboard tách gốc/lãi, user dừng uỷ thác / rút gốc bất kỳ
   lúc nào, audit log mọi quyết định.

## Nguyên tắc nền

- **KHÔNG đụng** logic ký/swap/guard đã kiểm thử: `jupiter-swap.ts`, các `assert*` trong
  `trade-wallet.ts`, cổng `canTradeLive()`. Lớp mandate chèn *phía trên* chúng.
- Mandate là **nguồn chân lý về vốn**. `buyVolumeSol` cố định trong settings được thay
  bằng size tính từ mandate (giữ settings cho các field khác).
- State lưu **JSON atomic file** (temp + rename) — y hệt `position-store.ts` /
  `settings-store.ts`. Thêm `alphahunter-mandate.json` vào `.gitignore`.
- Mọi ngưỡng rủi ro là **fail-closed**: thiếu dữ liệu/số dư → không vào lệnh.
- Test theo quy ước dự án: **plain `.mjs` script** trong `scripts/`, hàm thuần
  (pure, chain-free) để test không cần mạng — giống `test-trade-exit.mjs`.

---

## Mô hình dữ liệu: Mandate

File mới `src/lib/mandate-store.ts` (Next-free, dùng `node:fs/promises`, atomic write).

```ts
export type MandateStatus = "active" | "paused" | "stopped";

export interface Mandate {
  status: MandateStatus;
  // Vốn gốc user uỷ thác (SOL). Nguồn chân lý cho mọi phép tính sizing & risk.
  principalSol: number;
  // Thời điểm bắt đầu phiên uỷ thác hiện tại (ISO). Dùng cho reporting & reset ngày.
  startedAt: string;

  // ── Phân bổ / sizing ────────────────────────────────────────────────
  // % vốn gốc cho mỗi lệnh (vd 10 => mỗi vị thế dùng 10% principal).
  perTradePctOfPrincipal: number;
  // SOL luôn chừa lại trong vốn uỷ thác, không bao giờ đem mua (phí gas + đệm).
  reserveSol: number;
  // Trần số vị thế mở đồng thời.
  maxOpenPositions: number;

  // ── Risk tổng ───────────────────────────────────────────────────────
  // Dừng vào lệnh mới khi tổng (realized+unrealized) <= -maxDrawdownPct% của principal.
  maxDrawdownPct: number;
  // Dừng vào lệnh mới trong ngày khi realized âm vượt ngưỡng này (% principal).
  dailyLossLimitPct: number;
  // Khi drawdown chạm trần: chỉ "halt entries" hay "halt + liquidate tất cả".
  onDrawdownBreach: "halt" | "halt-and-liquidate";

  // ── Audit ───────────────────────────────────────────────────────────
  updatedAt: string;
}
```

Giá trị mặc định an toàn: `status:"stopped"`, `perTradePctOfPrincipal:10`,
`reserveSol:0.05` (khớp `TRADE_MIN_WALLET_SOL`), `maxOpenPositions:5`,
`maxDrawdownPct:25`, `dailyLossLimitPct:15`, `onDrawdownBreach:"halt"`.

### Capital accounting (hàm thuần, test được)

File `src/lib/mandate.ts` — logic thuần, không I/O, không chain:

```ts
// deployedSol: tổng entrySol của các vị thế đang mở (phần vốn đang "ngoài thị trường").
// realizedPnlSol: tổng từ position-store.
// unrealizedPnlSol: tổng từ position-store theo giá hiện tại.

export interface MandateAccounting {
  principalSol: number;
  deployedSol: number;        // Σ entrySol vị thế open
  availableSol: number;       // principal - deployed - reserve  (>= 0)
  realizedPnlSol: number;
  unrealizedPnlSol: number;
  equitySol: number;          // principal + realized + unrealized
  drawdownPct: number;        // (equity - principal)/principal*100, âm = lỗ
  perTradeSizeSol: number;    // principal * perTradePct/100, clamp <= available & <= maxSolPerTrade
}

// Quyết định có được MỞ vị thế mới không (fail-closed).
export type EntryGateReason =
  | "ok" | "mandate-not-active" | "max-open-reached"
  | "insufficient-available" | "drawdown-breach" | "daily-loss-limit";

export function evaluateEntryGate(input: {
  mandate: Mandate;
  acct: MandateAccounting;
  openCount: number;
  realizedTodaySol: number;    // realized trong ngày UTC hiện tại
  perTradeSizeSol: number;
}): { allowed: boolean; reason: EntryGateReason; sizeSol: number };
```

`evaluateEntryGate` kiểm tra, theo thứ tự fail-first:
1. `mandate.status !== "active"` → chặn.
2. drawdown: `acct.drawdownPct <= -maxDrawdownPct` → chặn (và báo caller liquidate nếu
   `onDrawdownBreach === "halt-and-liquidate"`).
3. daily loss: `realizedTodaySol <= -(principal * dailyLossLimitPct/100)` → chặn.
4. `openCount >= maxOpenPositions` → chặn.
5. `perTradeSizeSol <= 0 || perTradeSizeSol > acct.availableSol` → chặn.
6. ngược lại → `ok` với `sizeSol = perTradeSizeSol`.

---

## Tích hợp vào 3 điểm có sẵn (không viết lại engine)

### 1. Entry — `src/lib/trade-entry.ts`
Trong `maybeEnterPositions`, trước vòng lặp gem:
- Load mandate; nếu `status !== "active"` → trả toàn bộ `skipped` reason
  `"mandate-not-active"` (song song với check `autoBuyEnabled` hiện có — giữ cả hai, AND).
- Tính `MandateAccounting` từ `getOpenPositions()` + `getAllPositions()` (realized) +
  giá hiện tại (có thể bỏ unrealized ở entry để nhẹ — drawdown entry-gate dùng realized
  là đủ bảo thủ; unrealized sẽ do exit tick xử lý).
- Thay `const sol = settings.buyVolumeSol` bằng `sizeSol` từ `evaluateEntryGate`.
- Mỗi vòng lặp: sau khi mở 1 vị thế, giảm `availableSol` và tăng `openCount` cục bộ
  (giống cách code đang giảm `balanceSol` / tăng `tradesToday`).
- Guard cũ (`assertUnderMaxSol`, `assertBalanceFloorOk`, `assertPoolDepthOk`) **giữ nguyên** —
  chạy sau entry-gate như lớp phòng thủ thứ hai.

### 2. Exit — `src/lib/trade-exit.ts`
Trong `monitorPositions`, đầu mỗi tick:
- Load mandate + tính accounting (có unrealized vì đã fetch giá sẵn trong tick).
- Nếu `drawdownPct <= -maxDrawdownPct` và `onDrawdownBreach === "halt-and-liquidate"`:
  đặt một cờ `forceLiquidate` cho tick này → `decideSells` trả `kill-switch`-style
  (bán hết sellable) cho mọi vị thế. **Tận dụng** nhánh kill-switch sẵn có: truyền
  `killSwitch: cfg.killSwitch || forceLiquidate` vào `DecideContext`. Không cần sửa
  `decideSells`.
- `status === "paused"` → chỉ ngừng entry (exit vẫn chạy để bảo vệ vị thế). `"stopped"`
  sau khi đã đóng hết vị thế → worker không làm gì.

### 3. Minh bạch — `src/app/api/portfolio/route.ts` + UI
- API: thêm block `mandate` vào response: principal, deployed, available, equity,
  drawdownPct, realizedToday, status, perTradeSizeSol, openCount/maxOpen.
- Tách rõ **gốc vs lãi**: `equitySol = principal + realized + unrealized`; "lãi/lỗ" là
  `equity - principal`.

---

## API điều khiển mandate — `src/app/api/mandate/route.ts` (mới)

- `GET` → trả mandate hiện tại + accounting (giống portfolio nhưng gọn).
- `POST` → tạo/cập nhật mandate (sanitize + clamp như `settings/route.ts`):
  - `principalSol` ∈ [0.1, 100], `perTradePctOfPrincipal` ∈ [1, 100],
    `reserveSol` ≥ `TRADE_MIN_WALLET_SOL`, `maxOpenPositions` ∈ [1, 50],
    `maxDrawdownPct` ∈ [1, 100], `dailyLossLimitPct` ∈ [1, 100].
  - **Chặn nâng principal vượt số dư ví thật** khi live: đọc balance qua
    `getBalanceSol`, yêu cầu `principalSol + reserveSol <= balanceSol`.
- `POST ?action=pause|resume|stop`:
  - `pause` → `status:"paused"` (ngừng entry, giữ vị thế).
  - `stop` → `status:"stopped"`; nếu còn vị thế mở, trả cảnh báo + tuỳ chọn
    `liquidate=true` để đóng hết (reuse đường kill-switch/force-liquidate ở exit tick).
- Audit: mọi POST ghi 1 dòng vào `alphahunter-mandate-audit.log` (append-only):
  timestamp, action, field thay đổi, principal trước/sau. (Không log secret.)

---

## UI: tab "Uỷ thác" (Mandate)

- `PortfolioPanel` hiện **chưa gắn** vào `dashboard.tsx` — sẽ thêm điều hướng tab
  (Chat / Danh mục / Uỷ thác / Cài đặt) ở `header.tsx` hoặc `dashboard.tsx`.
- Component mới `src/components/dashboard/mandate-panel.tsx`:
  - Thẻ vốn: **Gốc / Đang triển khai / Khả dụng / Equity / Drawdown** (màu theo lời-lỗ).
  - Slider: principal, % mỗi lệnh, reserve, max vị thế, max drawdown, daily loss.
  - Nút lớn: **Bắt đầu uỷ thác / Tạm dừng / Dừng & rút** (confirm dialog cho "Dừng & rút",
    nêu rõ sẽ bán hết vị thế nếu chọn liquidate).
  - Banner trạng thái live/dry-run (đọc từ portfolio API: `mode`).
- Tiếng Việt, tông amber/zinc nhất quán với `settings-panel.tsx`.

---

## Thứ tự thực hiện (từng bước, build/test sau mỗi bước)

1. `mandate-store.ts` + `mandate.ts` (hàm thuần) + `.gitignore` entry.
2. `scripts/test-mandate.mjs` — test `evaluateEntryGate` & accounting (các case: drawdown
   breach, daily loss, max-open, insufficient-available, happy path). Chạy bằng
   `node scripts/test-mandate.mjs` (tsc compile như test-trade-exit).
3. Chèn entry-gate vào `trade-entry.ts`; cập nhật `test-mandate` phủ sizing.
4. Chèn force-liquidate vào `trade-exit.ts` (qua killSwitch flag); test đường drawdown.
5. `api/mandate/route.ts` + mở rộng `api/portfolio/route.ts`.
6. `mandate-panel.tsx` + điều hướng tab + gắn `PortfolioPanel`.
7. `npm run build` + `npm run lint`; chạy toàn bộ `scripts/test-*.mjs` liên quan.
8. Cập nhật `.env.example` nếu cần (không thêm secret mới — mandate ở JSON, không ở env).

## Rủi ro & quyết định mở

- **Solana không có allowance native** → với mô hình "server tự quản", principal chỉ là
  *con số logic* (bot tự giới hạn), không phải ràng buộc on-chain. Nếu server bị xâm nhập,
  key vẫn tiêu được toàn bộ ví. Mandate giảm blast-radius bằng *kỷ luật phần mềm*, không
  phải mật mã. Khuyến nghị trong UI: nạp đúng vốn muốn uỷ thác vào ví này (burner mindset).
- **Nguồn SOL/USD cho sizing USD**: hiện entry dùng `estSolUsd = 200` cứng. Sizing SOL
  thuần (theo principal) không cần giá USD → đơn giản hơn và chính xác hơn cho mục tiêu này.
- Có nên cho **compound lãi** vào principal không? Mặc định KHÔNG (principal cố định, lãi
  tách ra để rút) — khớp yêu cầu "tách gốc/lãi". Có thể thêm toggle `compound` sau.
