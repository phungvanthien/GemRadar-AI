
# Kế hoạch: Chuyển AlphaHunter sang "Săn Gems / Meme mới mint trên Solana"

> Mục tiêu: nút **Find Hidden Gems** thôi quét CoinGecko, thay bằng luồng quét
> token **mới mint trên Solana** — lấy từ RugCheck live feed, làm giàu on-chain
> (Flux) + giá/thanh khoản (Jupiter) + volume/giao dịch thật (DexScreener) + risk
> (RugCheck) + social (Telegram worker), chấm điểm theo `gem-score.md`, rồi để AI
> phân tích và xếp hạng.
>
> **TRẠNG THÁI: cả 5 phase + các phần mở rộng (volume/money-flow, social config, X)
> đã XONG.** Còn lại: bạn tự chạy worker Telegram (số phụ) và/hoặc điền
> `X_BEARER_TOKEN` (trả phí) để bật hạng mục Social, và tự test luồng thật với
> `npm run dev` + key Flux/RugCheck trong `.env.local`.

---

## 0. Hiện trạng đã xác minh (không phải giả định)

Đã đọc code và test endpoint thật. Những gì **đã có sẵn và dùng được**:

| Thành phần | File | Ghi chú |
|---|---|---|
| Nguồn token mới mint (realtime) | `src/lib/rugcheck-socket.ts` → `src/app/api/rugcheck-stream/route.ts` | WebSocket RugCheck, đã chạy, đẩy SSE về browser |
| UI feed realtime | `src/components/dashboard/live-feed.tsx` + `src/hooks/useRugcheckStream.ts` | Hiển thị token mới, có risk badge |
| On-chain enrichment | `src/lib/flux-solana.ts` | holder concentration, mint/freeze authority, tuổi, LP vault |
| RugCheck bulk report | `src/lib/rugcheck.ts` → `getRugcheckReportBulk` | score, LP lock %, insider networks, liquidity |
| Link socials của token | `src/lib/rugcheck.ts` → `getRugcheckValidation` | trả `socials.telegram` — endpoint public, no key |
| API chấm điểm gem Solana | `src/app/api/solana-gems/route.ts` | nhận `{ tokens: [...] }`, enrich, gọi AI |
| AI phân tích | `src/lib/ai.ts` → `analyzeSolanaGems` | trả gemScore/riskScore/upside/explanation |

Endpoint ngoài đã test sống:
- **Jupiter giá/thanh khoản**: `https://lite-api.jup.ag/price/v3?ids=<mint>` — free, **không cần key**. Trả `usdPrice`, `liquidity`, `priceChange24h`, `decimals`. Endpoint cũ `price.jup.ag/v6` đã **chết**.
- **DexScreener volume/giao dịch**: `https://api.dexscreener.com/tokens/v1/solana/<mint>,...` — free, **không cần key**, batch nhiều mint. Trả `volume.h24`, `txns.h24.{buys,sells}`, `priceChange.h24`, `liquidity.usd`, `marketCap`, `pairCreatedAt`. Lấp khoảng trống volume thật của Jupiter.

**Khoảng trống dữ liệu — trạng thái cuối:**
- ✅ Volume 24h thật + buy/sell ratio: **đã lấp** bằng DexScreener (phần mở rộng, mục 3).
- ⚠️ Smart Money win-rate thật (theo dõi ví có tỷ lệ thắng): **không có nguồn free** → thay bằng proxy "Money Flow" (buy/sell pressure + insider concentration), đặt tên trung thực, KHÔNG mạo danh smart-money.
- ⚠️ Cookie.fun mindshare: endpoint public trả 404 khi test → cần key, hoãn.

---

## 1. Mô hình điểm (bám theo `gem-score.md`) — TRẠNG THÁI CUỐI

`gem-score.md` đặt 4 hạng mục: Security 35%, Volume&Liquidity 25%,
Social&SmartMoney 20%, Holder Distribution 20%. Nhóm "Social & Smart Money 20%"
được **tách làm hai nửa** đúng như tài liệu mô tả: Social (cộng đồng Telegram) 10%
+ Money Flow (buy/sell pressure + insider) 10%. Thành 5 hạng mục:

| Hạng mục | Trọng số | Dữ liệu dùng | Nguồn | Trạng thái |
|---|---|---|---|---|
| Security & Safety | 35% | mint/freeze revoked, LP locked %, top risks, `scoreNormalised` | RugCheck + Flux | ✅ đầy đủ |
| Volume & Liquidity | 25% | LP depth (70%) + turnover volume/mcap (30%) | DexScreener + Jupiter + RugCheck | ✅ đầy đủ (volume thật) |
| Holder Distribution | 20% | top10 share, largest holder share, holder count | Flux + RugCheck | ✅ đầy đủ |
| Money Flow | 10% | buy/sell ratio (60%) + insider concentration nghịch đảo (40%) | DexScreener + RugCheck | ✅ đầy đủ |
| Social | 10% | Telegram (members/msg-rate/tuổi) + X (followers/engagement/verified) — trung bình khi có cả hai | Telegram worker + X API v2 | ⚠️ cần chạy worker / X key |

Quy tắc (đã triển khai trong `src/lib/gem-score.ts`): mỗi hạng mục trả về
`{ score: 0-100, covered, notes }`. Điểm tổng = tổng có trọng số **chỉ trên các
hạng mục `covered`**, chuẩn hoá lại về 100. Trả kèm `coverage` (0–1). Khi có đủ
DexScreener nhưng chưa có Telegram, coverage = **0.9**.

---

## 2. Các bước triển khai (làm tuần tự, mỗi phase tự chạy được)

### Phase 1 — Bộ chấm điểm gem thuần TS ✅ XONG
Chỉ dùng dữ liệu đã có (Flux + RugCheck). Có điểm số ngay.

- [x] `src/lib/gem-score.ts`: `GemScoreBreakdown`, `scoreSecurity`, `scoreDistribution`, `scoreLiquidity`, `scoreSocial`, `computeGemScore` (re-normalize theo `covered`).
- [x] Unit test `scripts/test-gem-score.mjs` — token an toàn/rủi ro/thiếu dữ liệu. **20/20 pass** (sau khi mở rộng Money Flow).

### Phase 2 — Tích hợp Jupiter (giá + thanh khoản) ✅ XONG
- [x] `src/lib/jupiter.ts`: `getJupiterPrices(mints)` gọi `lite-api.jup.ag/price/v3` (batch 50, degrade an toàn). Trả `{ mint, usdPrice, liquidity, priceChange24h, decimals }`. Xử lý đúng: response không theo thứ tự input (map theo key), mint lạ bị bỏ. **8/8 test live pass.**
- [x] Nối vào `scoreLiquidity` + route: marketCap = `usdPrice × supply` khi thiếu.
- [x] `.env.example`: ghi chú Jupiter không cần key.

### Phase 3 — Đổi nút "Find Hidden Gems" sang luồng Solana ✅ XONG
- [x] `src/lib/recent-mints.ts`: ring buffer in-memory (dedup, cap 200, lọc score/liquidity/tuổi). RugCheck stream route nạp mỗi token vào buffer.
- [x] `src/app/api/solana-gems/route.ts`: gọi **không body** → tự lấy ≤15 mint gần nhất (30 phút, score ≤ 60), enrich + `computeGemScore` + AI, trả breakdown + `source`.
- [x] Front-end: nút trỏ `/api/solana-gems`; `GemCards` hiện gemScore + breakdown + coverage. Text đổi sang Solana. Luồng CoinGecko cũ bỏ (`/api/gems` vẫn tồn tại nhưng không còn được nút gọi).
- [x] Verify: typecheck + lint + `npm run build` sạch.

### Phase 4 — Worker Telegram (Social) ✅ XONG (cần bạn tự chạy với số phụ)
Worker **Python + Telethon**, chạy độc lập, ghi `scripts/social-scores.json`.

> Cảnh báo rủi ro: Telethon đăng nhập bằng **tài khoản user thật** qua MTProto.
> Telegram cấm auto join/leave hàng loạt → **dễ ban**. Bắt buộc: dùng **số phụ**,
> join **rất chậm** (vài kênh/giờ, delay ngẫu nhiên), chỉ join token đã qua lọc
> on-chain. Đây là rủi ro không đảo ngược — chấp nhận trước khi chạy.

- [x] `.env.example` — biến `TELEGRAM_*` (kèm cảnh báo, để trống = bỏ Social):
  ```
  TELEGRAM_API_ID=          # từ my.telegram.org → API development tools
  TELEGRAM_API_HASH=        # hex 32 ký tự
  TELEGRAM_PHONE=+84...      # NÊN dùng số phụ
  TELEGRAM_SESSION=scripts/tg-worker/alphahunter.session
  TELEGRAM_2FA_PASSWORD=     # chỉ khi tài khoản bật 2FA
  ```
- [x] `scripts/tg-worker/{requirements.txt, README.md, common.py, login.py, worker.py}`.
- [x] `login.py` — login thủ công 1 lần (nhập OTP), tạo session.
- [x] `worker.py` — đọc `watchlist.json`, join **chậm** (≤3 kênh/lần, delay 45–120s), đọc metadata (members/msg-rate/tuổi), tính `socialScore`, ghi `scripts/social-scores.json`, **rời kênh** khi status = fail/sold. Không gửi tin. **Test logic (parse link + score): 10/10 pass.**
- [x] Cầu nối Next.js `src/lib/social-store.ts`: route resolve `socials.telegram` → ghi `watchlist.json`; `getSocialSignalsBulk` đọc `social-scores.json` vào `computeGemScore`.
- [x] `.gitignore`: chặn commit `*.session` (chứa credential), `watchlist.json`, `social-scores.json`, `.venv`.

### Phase 5 — Hoàn thiện UI ✅ XONG
- [x] Bảng gem: gemScore tổng, thanh breakdown, **badge coverage màu** (xanh ≥90% / vàng 60-89% / đỏ <60%), thanh Social hiện "n/a" khi chưa có worker.
- [x] Nút "Re-scan" (đổi nhãn khi đã có kết quả); hiện `failures` (token enrich lỗi).
- [x] Verify: typecheck + lint + build sạch.

### Phần mở rộng — Volume 24h thật + Money Flow ✅ XONG
- [x] `src/lib/dexscreener.ts`: `getDexScreenerData(mints)` — free, no key, batch 30. Trả volume24h/buys/sells/liquidity/marketCap. **7/7 test live pass.**
- [x] `scoreLiquidity` = 70% LP depth + 30% turnover (volume/mcap). Bỏ cờ "volume N/A" khi có DexScreener.
- [x] `scoreMoneyFlow` (10%) = 60% buy/sell ratio + 40% insider concentration nghịch đảo. **Proxy trung thực, KHÔNG phải wallet win-rate.**
- [x] Nối vào route + UI (thanh "Money Flow"). Coverage lên 0.9 khi có DexScreener.

### Phần mở rộng — Social monitoring config + X (Twitter) ✅ XONG
- [x] `social-monitor.config.json` (commit được, KHÔNG secret): ngưỡng điểm, cấu hình Telegram + X, rate-limit, watchlist. `src/lib/social-config.ts` đọc + validate + default an toàn; `shouldTrackSocial` = gemScore AI ≥ 7 **VÀ** total ≥ 70 **VÀ** coverage ≥ 0.7.
- [x] Chỉ gem đủ ngưỡng mới được ghi vào `watchlist.json` (worker không join kênh token điểm thấp). Worker đọc rate-limit từ config.
- [x] `src/lib/x.ts`: X API v2 (`api.x.com/2`, endpoint đã xác minh path). `getXProfileMetrics` (followers/verified/tuổi/engagement) + `computeXScore` (0-100: 55đ followers + 30đ engagement + 15đ verified, cap 50 nếu account < 14 ngày). Degrade null khi disabled/lỗi. **Test parse/score: 14/14 pass.**
- [x] `scoreSocial` kết hợp Telegram + X (trung bình khi có cả hai). Route resolve X handle từ RugCheck `socials.twitter`, fetch có điều kiện (config bật + có `X_BEARER_TOKEN`), cap `maxAccountsPerRun`. Tái dùng validation cho watchlist (không gọi RugCheck 2 lần).
- [x] `.env.example`: `X_BEARER_TOKEN` (kèm cảnh báo API trả phí). Verify: gem-score 25/25, typecheck + lint + build sạch.

**Trung thực về X:** xScore đo **reach + engagement**, KHÔNG đo authenticity (bot followers không phát hiện tin cậy từ public metrics). Chưa test live vì cần bearer token trả phí — đã xác minh endpoint tồn tại + đúng path, test toàn bộ logic thuần.

---

## 3. Việc còn để mở (chưa làm)
- Smart Money win-rate thật (theo dõi ví có tỷ lệ thắng cao): cần tập ví "smart" đã gán nhãn + parse toàn bộ lịch sử giao dịch mỗi ví. Không có nguồn free đáng tin (Nansen/GMGN tính phí). Đã thay bằng proxy Money Flow.
- Cookie.fun mindshare: endpoint public trả 404 khi test → cần API key/đăng ký, hoãn.
- Birdeye/GMGN smart-money labels: cần API key trả phí — bật sau nếu bạn cung cấp key.
- X monitoring: khung + fetch đã xong, nhưng **chưa test live** (cần `X_BEARER_TOKEN` trả phí). Bật bằng `x.enabled: true` trong config + điền token.

## 4. Nguyên tắc xuyên suốt
- Không bịa dữ liệu thiếu; luôn trả `covered/coverage` để điểm số trung thực.
- Mọi nguồn ngoài (Jupiter, DexScreener, RugCheck, Telegram, X) phải degrade an toàn khi lỗi — không sập luồng scan.
- Secret (API hash, bearer token) ở `.env.local`; config hành vi ở `social-monitor.config.json`. Không commit credential.
- Telegram worker: ưu tiên an toàn tài khoản hơn tốc độ; số phụ; rate-limit chậm.
- Endpoint đã đổi/deprecate phải test lại trước khi code (như Jupiter v6 → v3).
