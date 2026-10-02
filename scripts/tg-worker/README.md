# AlphaHunter Social Worker — Telegram + X (Twitter)

Worker Python duy nhất chấm điểm **cả Telegram lẫn X** cho mỗi gem trong một
lượt chạy, ghi kết quả vào hai file mà Next.js đọc để tính hạng mục **Social**
của gem score.

```
watchlist.json          ← Next.js ghi (gem scan)
    ↓
worker.py               ← chạy 1 lần / theo lịch
    ├── Telegram (Telethon)  → social-scores.json   { [mint]: socialScore }
    └── X / Twitter (Nitter) → x-scores.json        { [mint]: xScore }
                                    ↓
                            social-store.ts (Next.js đọc)
                                    ↓
                            gem-score.ts → Social 10%
```

---

## ⚠️ Cảnh báo rủi ro — ĐỌC TRƯỚC KHI CHẠY

**Telegram:**
- Worker dùng **Telethon (MTProto)** — đăng nhập bằng **tài khoản Telegram
  người dùng thật**, KHÔNG phải Bot API.
- Telegram **cấm** tự động join/leave nhiều group. Rủi ro **ban vĩnh viễn**.
- **Dùng SỐ ĐIỆN THOẠI PHỤ**, không phải số chính.
- Join rất chậm (mặc định ≤ 3 kênh/lượt, delay ngẫu nhiên 45–120s).
- Chỉ đọc metadata — KHÔNG gửi tin.

**X / Twitter:**
- Dùng **Nitter public RSS** — không cần account, không cần API key, không
  có rủi ro ban. Nitter là frontend mã nguồn mở không chính thức cho X.
- Nếu tất cả Nitter instance đều down, phần X tự động bỏ qua (graceful).
- Danh sách instance cập nhật: https://status.d420.de (lọc RSS ✓).

---

## Thiết lập

### 1. Credentials (Telegram)

Lấy API credentials tại https://my.telegram.org → **API development tools**.

Điền vào `.env.local` ở gốc dự án:

```env
TELEGRAM_API_ID=1234567
TELEGRAM_API_HASH=<hex 32 ký tự>
TELEGRAM_PHONE=+84...            # NÊN dùng số phụ
TELEGRAM_SESSION=scripts/tg-worker/alphahunter.session
TELEGRAM_2FA_PASSWORD=           # chỉ khi tài khoản bật 2FA
```

### 2. Cài dependencies

```bash
cd scripts/tg-worker
python3 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt   # chỉ cần: telethon
```

### 3. Đăng nhập một lần

```bash
python login.py
```

Nhập OTP Telegram gửi về app. Tạo file session — các lần sau không cần lại.

### 4. Cấu hình hành vi (không phải secrets)

Chỉnh `social-monitor.config.json` ở gốc dự án:

```json
{
  "telegram": {
    "enabled": true,
    "maxJoinsPerRun": 3,
    "minJoinDelaySeconds": 45,
    "maxJoinDelaySeconds": 120
  },
  "x": {
    "enabled": true,
    "source": "nitter",
    "maxAccountsPerRun": 10,
    "pollIntervalMinutes": 60
  }
}
```

---

## Chạy worker

```bash
# Trong virtualenv (source .venv/bin/activate)

python worker.py           # một lượt quét watchlist hiện tại
python worker.py --watch   # quét lại mỗi pollIntervalMinutes phút
```

---

## Cách hoạt động — mỗi mint trong watchlist

### Telegram
1. Nếu `status = fail|sold` và đã join → **rời kênh**, ghi `leftAt`.
2. Nếu chưa join và còn slot (`maxJoinsPerRun`) → **join chậm** → đọc:
   - `members` — số thành viên
   - `msgPerHour` — tần suất tin nhắn (100 msg gần nhất)
   - `groupAgeDays` — tuổi group
3. Tính `socialScore` (0–100):
   | Tín hiệu | Điểm | Saturate |
   |---|---|---|
   | Members | 50 pts | 2 000 |
   | Msg/hour | 35 pts | 30 msg/h |
   | Group age | 15 pts | 7 ngày |
4. Ghi vào `scripts/social-scores.json`.

### X / Twitter (Nitter RSS)
1. Probe Nitter instances, lấy instance đầu tiên phản hồi.
2. Fetch RSS: `https://<nitter>/search/rss?q=$SYMBOL&f=tweets`
3. Parse XML — thu thập tối đa 60 tweet.
4. Tính `xScore` (0–100):
   | Tín hiệu | Điểm | Saturate |
   |---|---|---|
   | Tweet count | 35 pts | 40 tweets |
   | Unique authors | 25 pts | 25 accounts |
   | Avg engagement | 25 pts | 50 (likes+RT) |
   | Freshness (<24h) | 15 pts | 100% |
   | Sock-puppet cap | nếu authors/tweets < 30% → tối đa 50 pts |
5. Ghi vào `scripts/x-scores.json`.

---

## File dữ liệu

| File | Ai ghi | Ai đọc | Nội dung |
|---|---|---|---|
| `watchlist.json` | Next.js | worker.py | `{ [mint]: { telegram, symbol, status } }` |
| `social-scores.json` | worker.py | Next.js | `{ [mint]: { socialScore, members, msgPerHour, ... } }` |
| `x-scores.json` | worker.py | Next.js | `{ [mint]: { xScore, tweetCount, uniqueAuthors, ... } }` |

`src/lib/social-store.ts` đọc cả hai file, merge vào `SocialSignals`,
`gem-score.ts` dùng để tính hạng mục Social (10% tổng điểm).

---

## socialScore và xScore đo gì (và KHÔNG đo gì)

**Đo (định lượng):**
- TG: số thành viên, tần suất hoạt động, tuổi group.
- X: số tweet về $SYMBOL, độ rộng (unique authors), engagement, độ mới.

**KHÔNG đo (không thể tin cậy từ dữ liệu công khai):**
- Engagement thật vs bot — unique-author ratio chỉ là smell test yếu.
- Nội dung / sentiment.
- Voice chat activity.
