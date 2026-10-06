#Luồng Làm Việc Của Bot Và Agent - GemRadar AI

## Tổng Quan

GemRadar AI là hệ thống phân tích và phát hiện các token "gem" tiềm năng trên mạng lưới Solana, kết hợp giữa phân tích on-chain, AI (Claude Sonnet 4.6, GPT-4o) và các tín hiệu xã hội để lọc ra các cơ hội đầu tư chất lượng cao trong khi quản lý rủi ro rugpull hiệu quả.

---

## Phase 1: Quét Token Mới (Token Scanning)

### Cơ chế tự động (Live Feed)
- Đọc danh sách token mới được tạo gần đây từ **RugCheck Live Stream**
- Chỉ quét các token có thời gian tạo trong **30 phút gần nhất**
- Lọc sơ bộ: bỏ qua các token đã có điểm rugcheck cao hơn 60

### Cơ chế chủ động (Client Request)
- Người dùng hoặc hệ thống khác có thể gửi danh sách token cụ thể qua API
- Số lượng tối đa: 15 token mỗi lần scan

### Xác thực mint address
-Kiểm tra định dạng Base58: `[1-9A-HJ-NP-Za-km-z]{32,44}`
- Đảm bảo vault addresses (nếu có) cũng hợp lệ

---

## Phase 2: Làm Phong Phú Dữ Liệu On-Chain

Tất cả các nguồn dữ liệu chạy song song để tối ưu thời gian:

### RugCheck Report (Risk Assessment)
- Điểm rugcheck chuẩn hóa (0-100, càng cao càng nguy hiểm)
- Top 3 rủi ro nổi bật
- Tỷ lệ LP đã lock
- Số lượng insider networks (wallet clusters phối hợp gian lận)
- Tổng thanh khoản thị trường

### Jupiter Prices (Price & Liquidity)
- Giá USD hiện tại
- Tổng thanh khoản trong pool
- Biến đổi giá 24h

### DexScreener Data (Real Volume)
- Khối lượng giao dịch 24h thực tế
- Số lượng mua/bán
- Market cap

### Enrichment On-Chain
Từ mỗi mint address, trích xuất:
- **Holder concentration top 10**: Tỷ lệ supply thuộc 10 tài khoản lớn nhất (>0.5 = rủi ro cao)
- **Largest holder share**: Tỷ lệ thuộc tài khoản lớn nhất
- **Holder count**: Số ví holding token
- **Mint authority revoked**: Có thể mint thêm token không
- **Freeze authority revoked**: Có thể khóa token không (honeypot indicator)
- **Age seconds**: Thời gian kể từ hoạt động on-chain đầu tiên
- **Supply**: Tổng cung token

---

## Phase 3: Tính Điểm Gem Deterministic

Điểm số 0-100 được tính từ 5 danh mục với trọng số khác nhau:

| Danh mục | Trọng số | Thành phần |
|----------|----------|------------|
| **Security** | 35% | Authorities, LP lock %, RugCheck risk |
| **Liquidity** | 25% | Pool depth, volume turnover |
| **Money Flow** | 10% | Buy/sell ratio, insider networks |
| **Social** | 10% | Telegram score + X buzz score |
| **Distribution** | 20% | Holder concentration, largest holder |

### Coverage Metric
- Đo lường mức độ đầy đủ của dữ liệu cho mỗi token
- Nếu < 0.5: điểm không đáng tin cậy, bị filter bỏ

---

## Phase 4: Phân Tích AI (Gem Analysis)

### Input cho AI Model
Chỉ các token nằm trong **top candidates** dựa trên:
- Điểm deterministic cao nhất
- Rủi ro thấp nhất
- Tối đa 15 token gửi cho AI

### Prompt Calibration (Học từ kinh nghiệm)
AI được cung cấp thống kê từ lịch sử phân tích trước đó:

```
- Trong số token được score 'strong' (gemScore >= 8):
  X% tăng giá mạnh (>=2x), Y% rugged (<=-80%) trong 24h
- Token có insiderNetworkCount > 0 rugged Z.x lần thường xuyên hơn
```

### Output từ AI
```json
{
  "gemScore": 1-10,        // Chất lượng cơ hội
  "riskScore": 1-10,       // Mức độ rủi ro (càng cao càng nguy hiểm)
  "potentialUpside": "2-5x medium-term",
  "explanation": "1-2 câu phân tích ngắn gọn"
}
```

### Mô hình sử dụng
- **FridayAIX/Anthropic**: Claude Sonnet 4.6 (mặc định)
- **OpenAI**: GPT-4o

---

## Phase 5: Tổng Hợp Tín Hiệu Xã hội

### Telegram Monitoring (Worker)
- Worker thường xuyên check các channel/group trong watchlist
- Tín hiệu từ Telegram: socialScore (0-100)
- Dùng spam-filter.ts để loại bot/inflation groups

### X (Twitter) Integration
Hai đường dẫn:

#### Official API (Paid)
- Truy cập profile metrics qua X API chính thức
- Tính xScore dựa trên:
  - Tuổi tài khoản
  - F/F ratio (follower/following)
  - Engagement rate
  - Tweet frequency
- Số lượng account mỗi scan bị giới hạn (cfg.x.maxAccountsPerRun)

#### Scraped Signal
- X buzz từ các nguồn public
- Đã được filter spam bởi worker

### Ưu tiên tín hiệu
- **Official API xScore** > Scraped xScore > Telegram socialScore
- Kết quả social signals được lưu vào social-store.json

---

## Phase 6: Lọc Spam và Bot Detection

### filterXAccount()
Tính toán **authenticityScore** từ:
- Account age (ngày)
- Follower/Following ratio
- Average engagement rate
- Tweet frequency
- Profile completeness

### filterXTweet()
Phân tích nội dung tweet:
- URL ngắn (bit.ly, tinyurl...)
- Kêu gọi mua bán (PUMP, TO THE MOON...)
- Tần suất bất thường
- Nội dung generic/spammy

### filterTelegramMessage()
- Đo lường sự lặp lại nội dung
- URL patterns
- Ký hiệu pump signals
- Tỷ lệ bot messages trong group

### filterTelegramGroup()
- Phát hiện inflation groups
- Mức độ tương tác bất thường

### Quyết định
```typescript
interface SpamVerdict {
  authenticityScore: number; // 0-100
  isSpam: boolean;
  flags: string[];
}
```

---

## Phase 7: Ra Quyết Định Giao Dịch

### Điều kiện tiên quyết
- **autoBuyEnabled** = true trong settings
- **Mandate status** = "active"
- **Kill switch** = false

### Các lớp bảo vệ (Gates)

#### 1. Token Safety Gate
- Market liquidity >= $20,000
- Top holder < 30%
- Top 10 holder < 60%
- Token age >= 5 phút
- Holder count >= 50
- Rug risk score < 60

#### 2. Mandate Entry Gate
- Drawdown hiện tại < max drawdown cho phép
- Loss ngày hiện tại < max daily loss
- Số pos mở < max open positions
- Vốn khả dụng đủ cho trade mới

#### 3. Balance & Pool Depth
- Wallet balance >= min wallet (0.05 SOL)
- Buy <= 2% pool liquidity
- Single trade <= max SOL per trade (0.25 SOL)
- Daily trades <= max trades per day (10)

### Risk-Adjusted Sizing
```typescript
riskMultiplier = 1 - (0.6 * (rugRisk / maxRugRiskScore))
positionSize = mandateClip * riskMultiplier
```

- Rug risk 0: dùng 100% mandate
- Rug risk cao: giảm xuống còn 40% mandate

### Chế độ giao dịch
- **Dry-run**: Chỉ log, không thực sự mua
- **Live**: Thực hiện swap thực qua Jupiter

---

## Phase 8: Ghi Nhận Kết Quả & AI Calibration

### recordGemOutcome()
Ghi lại mọi gem đã score với:
- mint address, symbol
-_scores tại thời điểm scoring (hardScore, aiGemScore, riskScore)
- priceAtScore (giá Jupiter tại thời điểm)
- insiderNetworkCount

### Reconcile Worker (Chạy định kỳ)
- Đo lường hiệu suất token theo các mốc thời gian:
  - **1h**: price1h sample
  - **24h**: price24h sample → classify outcome
  - **7d**: price7d sample

### Classification (24h horizon)
```typescript
ratio = price24h / priceAtScore

rug:   ratio <= 0.2   (mất >= 80%)
pump:  ratio >= 2.0   (tăng >= 100%)
flat:  0.2 < ratio < 2.0
```

### getScoringCalibration()
Tính toán thống kê hồi quy:
- strongRugRate: Tỷ lệ token strong bị rug
- strongPumpRate: Tỷ lệ token strong tăng mạnh
- insiderRugMultiplier: Tỷ lệ rug của token có insider networks

---

## Phase 9: Watchlist & Candidate Tracking

### Watchlist Candidates
Chỉ các token đạt ngưỡng mới được theo dõi xã hội:
- aiGemScore >= ngưỡng
- total score >= ngưỡng
- coverage >= 0.5

### Watchlist Ingestion
- **Near-miss tracking**: Token có điểm cao nhưng không mua
- **AI-high unbought**: Token AI score cao nhưng chưa được mua
- Cập nhật watchlist.json cho Telegram worker

---

## Flow Diagram Tóm Tắt

```
┌─────────────────────────────────────────────────────────────────┐
│                     SOLANA GEMS API                             │
└───────────────────────┬─────────────────────────────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 1: Token Scanning            │
        │  - Live feed (30min recent mints)   │
        │  - Or client-provided tokens        │
        └─────────────────┬───────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 2: On-Chain Enrichment       │
        │  - RugCheck (parallel)              │
        │  - Jupiter Prices                   │
        │  - DexScreener                      │
        │  - Flux RPC (holder, age, etc)      │
        └─────────────────┬───────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 3: Deterministic Scoring     │
        │  - Security (35%)                   │
        │  - Liquidity (25%)                  │
        │  - Money Flow (10%)                 │
        │  - Social (10%)                     │
        │  - Distribution (20%)               │
        │  - Coverage metric                  │
        └─────────────────┬───────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 4: AI Analysis               │
        │  - Claude Sonnet 4.6 / GPT-4o       │
        │  - Calibrated with past performance │
        │  - gemScore, riskScore, explanation │
        └─────────────────┬───────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 5: Social Signals            │
        │  - Telegram worker (socialScore)    │
        │  - X Official API (xScore)          │
        │  - Spam/Filter detection            │
        └─────────────────┬───────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 6: Trade Entry Decision      │
        │  - Token safety gates               │
        │  - Mandate gates                    │
        │  - Balance & pool depth             │
        │  - Risk-adjusted sizing             │
        └─────────────────┬───────────────────┘
                        │
                        ▼
        ┌─────────────────────────────────────┐
        │  PHASE 7: Outcome Recording         │
        │  - Record gem + price               │
        │  - Reconcile at 1h/24h/7d           │
        │  - Update AI calibration            │
        └─────────────────────────────────────┘
```

---

## Các Ngưỡng Quan Trọng

| Ngưỡng | Giá trị | Mô tả |
|--------|---------|-------|
| **maxScore (pre-filter)** | 60 | Bỏ qua token RugCheck > 60 |
| **minGemScoreToTrigger** | 70 (0-100) | Điểm deterministic tối thiểu |
| **coverage** | 0.5 | Độ đầy đủ dữ liệu tối thiểu |
| **minLiquidityUsd** | $20,000 | Thanh khoản tối thiểu |
| **maxTopHolderShare** | 0.3 |Single holder max 30% |
| **maxTop10Share** | 0.6 | Top 10 holder max 60% |
| **minTokenAgeSeconds** | 300 | Token phải >= 5 phút |
| **minHolderCount** | 50 | Số ví holding tối thiểu |
| **maxRugRiskScore** | 60 | Rug risk tối đa cho phép |
| **maxPoolShare** | 0.02 | Buy <= 2% pool liquidity |

---

## Kết Luận

GemRadar AI tạo thành một hệ sinh thái khép kín:
1. **Quét** token mới liên tục
2. **Phân tích** đa chiều (on-chain + AI + social)
3. **Lọc** spam và bot
4. **Quyết định** giao dịch với quản lý rủi ro
5. **Học hỏi** từ kết quả thực tế để cải thiện AI

Hệ thống được thiết kế để:
- Tự động trong dry-run mode để test
- Cần nhiều điều kiện mới chạy live
- Liên tục học từ outcomes để điều chỉnh AI
- Phân tích đa chiều để tránh các bẫy rugpull phổ biến
