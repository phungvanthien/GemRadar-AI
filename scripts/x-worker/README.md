# X (Twitter) Buzz Worker — chấm điểm Social (FREE, không cần API trả phí)

Chấm điểm **xScore** cho gem Solana bằng cách scrape X: tìm `$SYMBOL`, đo mức độ
được bàn tán (số tweet, số tài khoản khác nhau, tương tác, độ mới), quy về 0-100.
Đây là tín hiệu **buzz** cho hạng mục *Social & Smart Money* trong `gem-score.md`.

Khác với `src/lib/x.ts` (dùng **X API v2 trả phí** trên handle chính thức đã biết
để đo follower + verified), worker này **không cần key** — nó đo độ lan toả tự
nhiên quanh ticker. Hai nguồn bổ sung cho nhau; cả hai cùng nạp vào `xScore`.

## ⚠️ Cảnh báo rủi ro — ĐỌC TRƯỚC KHI CHẠY

- Scrape X bằng tài khoản đã đăng nhập có thể khiến tài khoản **bị giới hạn hoặc
  khoá**. Đây là rủi ro **không đảo ngược**.
- Giảm thiểu: dùng **tài khoản PHỤ (throwaway)** cho `cookies.json`, giữ số token
  mỗi lượt thấp, và **giữ nguyên các delay giả-người** trong code.
- Chỉ scrape token đã qua lọc on-chain của Next.js (ghi trong `watchlist.json`).
- Bạn tự chịu trách nhiệm khi chạy.

## Thiết lập

```bash
cd scripts/x-worker
npm install
npx playwright install chromium
```

### cookies.json (khuyến nghị)

Không có cookie, worker vẫn chạy ở chế độ search **chưa đăng nhập** (ít kết quả
hơn nhưng vẫn dùng được). Để có đầy đủ tab *Latest*:

1. Đăng nhập X bằng **tài khoản phụ** trên trình duyệt.
2. Export cookie bằng extension dạng *Cookie-Editor* (định dạng JSON).
3. Lưu vào `scripts/x-worker/cookies.json`. File này đã nằm trong `.gitignore` —
   **không bao giờ commit**.

## Chạy worker

```bash
npm run scrape        # một lượt quét watchlist hiện tại
npm run watch         # quét lại khi watchlist đổi + theo lịch (pollIntervalMinutes)
```

Worker sẽ:
- Đọc `../tg-worker/watchlist.json` (Next.js ghi khi bạn bấm Find Hidden Gems).
- Với mỗi mint `status=active`: tìm `$SYMBOL` trên X (tab Latest), cuộn thu thập
  tweet, tính `xScore`.
- Ghi `../x-scores.json` sau **mỗi** token (crash giữa chừng vẫn giữ kết quả trước).

Next.js đọc lại `x-scores.json` qua `src/lib/social-store.ts` và trộn `xScore` vào
hạng mục Social của gem score. Nếu đường dẫn X API trả phí có điểm cho cùng mint,
điểm trả phí được **ưu tiên**; điểm scrape là fallback.

## Các file dữ liệu

- `../tg-worker/watchlist.json` (Next.js ghi, worker đọc):
  `{ [mint]: { telegram, symbol, status } }` — dùng `symbol` để tạo query `$SYMBOL`.
- `../x-scores.json` (worker ghi, Next.js đọc):
  `{ [mint]: { xScore, symbol, tweetCount, uniqueAuthors, avgEngagement, recentTweets, searchQuery, scrapedAt, source, error } }`.

## xScore đo gì (và KHÔNG đo gì)

Đo tín hiệu **định lượng** đọc được từ kết quả search:
- Số tweet thu thập được cho `$SYMBOL` (độ lớn buzz).
- Số tài khoản khác nhau (độ rộng — smell test sock-puppet thô).
- Tương tác trung bình mỗi tweet (likes + RT + replies).
- Độ mới (tỷ lệ tweet trong 24h gần nhất).

KHÔNG đo (không tin cậy được, nên không bịa):
- Phân biệt engagement **thật vs bot** một cách chắc chắn — tỷ lệ tài khoản khác
  nhau chỉ là smell test yếu, không phải bằng chứng. Ticker nhiều tweet nhưng rất
  ít tài khoản bị **giới hạn trần 50 điểm**.
- Sentiment nội dung.

## Cấu hình

Đọc phần `x` của `social-monitor.config.json` (gốc dự án) khi có:
- `x.maxAccountsPerRun` → số token tối đa mỗi lượt.
- `x.pollIntervalMinutes` → chu kỳ `--watch`.

Các giá trị khác (thời lượng cuộn, timeout cứng, headless) để mặc định an toàn
trong `twitter_scraper.ts`.
