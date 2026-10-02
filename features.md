# AlphaHunter AI — Tài liệu tính năng

AlphaHunter AI là một dashboard phân tích thị trường crypto tích hợp AI. Ứng dụng kết hợp dữ liệu thị trường trực tiếp từ CoinMarketCap với phân tích của OpenAI để cung cấp trợ lý chat, các widget thị trường theo thời gian thực, và một trình quét **Hidden Gems** (token tiềm năng vốn hóa thấp).

Tài liệu này mô tả chi tiết từng tính năng và cách chúng được triển khai trong mã nguồn.

---

## 1. Tổng quan kiến trúc

| Thành phần | Công nghệ |
|------------|-----------|
| Framework | Next.js 16 (App Router) |
| Ngôn ngữ | TypeScript 5 |
| Giao diện | Tailwind CSS v4 + component kiểu shadcn/ui (Radix + CVA) |
| AI | OpenAI SDK — model `gpt-4o-mini` |
| Dữ liệu thị trường | CoinMarketCap Pro API |
| Chỉ số tâm lý | Alternative.me Fear & Greed API (không cần key) |
| Triển khai | Vercel-ready |

Ứng dụng chạy theo mô hình client-server của Next.js: các API route ở phía server gọi CoinMarketCap và OpenAI (giữ API key an toàn), còn giao diện dashboard là các React client component gọi lại các API route đó.

Biến môi trường cần cấu hình ([.env.example](.env.example)):
- `OPENAI_API_KEY`
- `COINMARKETCAP_API_KEY`

---

## 2. Giao diện Dashboard ba cột

Dashboard là bố cục ba panel dark mode, được điều phối bởi [dashboard.tsx](src/components/dashboard/dashboard.tsx):

- **Header** ([header.tsx](src/components/dashboard/header.tsx)) — logo thương hiệu với gradient amber/orange, tagline, và chỉ báo "Live" nhấp nháy.
- **Cột trái** ([left-sidebar.tsx](src/components/dashboard/left-sidebar.tsx)) — thống kê thị trường tổng quan.
- **Cột giữa** ([chat-panel.tsx](src/components/dashboard/chat-panel.tsx)) — chat AI + trình quét Hidden Gems.
- **Cột phải** ([right-sidebar.tsx](src/components/dashboard/right-sidebar.tsx)) — token đang trending.

**Responsive**: trên desktop (`lg:`) hiển thị lưới ba cột (trái 288px, phải 320px, giữa co giãn). Trên mobile các panel xếp chồng dọc với đường viền phân cách.

**Tự động làm mới**: dữ liệu thị trường được fetch khi tải trang và tự động refresh mỗi **120 giây** thông qua `setInterval` trong [dashboard.tsx:31](src/components/dashboard/dashboard.tsx#L31).

Toàn app dùng dark theme cố định (`className="dark"` ở [layout.tsx:33](src/app/layout.tsx#L33)), font Geist Sans/Mono, cùng metadata SEO/OpenGraph.

---

## 3. Chat AI phân tích thị trường

Panel chat ([chat-panel.tsx](src/components/dashboard/chat-panel.tsx)) là trung tâm tương tác:

- **Trợ lý crypto chuyên biệt**: hệ thống dùng system prompt định danh AI là "AlphaHunter AI" — chuyên gia phân tích thị trường, hỗ trợ khám phá cơ hội, so sánh token, phân tích tiềm năng tăng trưởng trên nhiều chain (gồm cả BNB Chain). Prompt yêu cầu AI trả lời cô đọng, dựa trên dữ liệu, nêu rõ rủi ro, không hứa hẹn lợi nhuận và đóng khung mọi nội dung như phân tích giáo dục thay vì lời khuyên tài chính ([openai.ts:12-17](src/lib/openai.ts#L12-L17)).
- **Lịch sử hội thoại nhiều lượt**: toàn bộ mảng `messages` được gửi lại mỗi lượt để AI giữ ngữ cảnh ([chat-panel.tsx:52-62](src/components/dashboard/chat-panel.tsx#L52-L62)).
- **Gợi ý nhanh (suggestions)**: ba chip gợi ý có sẵn — "Find promising BNB Chain tokens", "Analyze token growth potential", "Compare BTC vs ETH for the next cycle" ([chat-panel.tsx:12-16](src/components/dashboard/chat-panel.tsx#L12-L16)).
- **Trải nghiệm chat**: bong bóng tin nhắn phân biệt user (amber) và assistant (violet) với icon riêng, tự cuộn xuống cuối khi có tin nhắn mới, hiển thị trạng thái "AlphaHunter is analyzing..." khi đang chờ.
- **Xử lý lỗi**: lỗi chat hiển thị trong card đỏ riêng, không làm gián đoạn phần còn lại của app.

**Cấu hình model** ([openai.ts:19-31](src/lib/openai.ts#L19-L31)): `gpt-4o-mini`, `temperature: 0.7`, `max_tokens: 1200`.

**API**: `POST /api/chat` ([route.ts](src/app/api/chat/route.ts)) — nhận `{ messages: [...] }`, xác thực rằng tin nhắn cuối phải đến từ user và không rỗng, trả về `{ message }`.

---

## 4. Trình quét Hidden Gems (tính năng chủ đạo)

Đây là tính năng đặc trưng nhất: quét thị trường để tìm các token vốn hóa thấp có tiềm năng, rồi chấm điểm bằng AI. Kích hoạt bằng nút "Find Hidden Gems".

### 4.1 Pipeline xử lý

Chạy qua `POST /api/gems` ([route.ts](src/app/api/gems/route.ts)) theo các bước:

1. **Lấy dữ liệu**: fetch **500 token** hàng đầu từ CoinMarketCap ([route.ts:10](src/app/api/gems/route.ts#L10)).
2. **Lọc theo tiêu chí** (`filterHiddenGems` trong [coinmarketcap.ts:115-128](src/lib/coinmarketcap.ts#L115-L128)):

   | Bộ lọc | Giá trị |
   |--------|---------|
   | Vốn hóa | > $1.000.000 và < $100.000.000 |
   | Khối lượng 24h | > $300.000 |
   | Thay đổi 24h | > -5% |

3. **Xếp hạng & giới hạn**: sắp xếp ứng viên theo mức tăng 24h giảm dần, lấy tối đa **15 token** ([route.ts:21-23](src/app/api/gems/route.ts#L21-L23)).
4. **Phân tích bằng AI** (`analyzeGems` trong [openai.ts:33-102](src/lib/openai.ts#L33-L102)).
5. **Trả kết quả** kèm số liệu `filteredCount` và `analyzedCount`.

> Lưu ý: README mô tả tiêu chí là "cap < $50M, volume > $100K", nhưng mã nguồn hiện tại dùng ngưỡng chặt hơn (cap $1M–$100M, volume > $300K, change > -5%). Mã nguồn là nguồn chuẩn xác.

### 4.2 Chấm điểm bằng AI

OpenAI được yêu cầu trả về JSON có cấu trúc (`response_format: json_object`, `temperature: 0.4`, `max_tokens: 4000`) với mỗi token gồm:

- **Gem Score (1–10)** — chất lượng cơ hội.
- **Risk Score (1–10)** — mức rủi ro (càng cao càng rủi ro).
- **Potential Upside** — chuỗi ngắn mô tả tiềm năng, ví dụ "2-5x medium-term".
- **Explanation** — 1–2 câu giải thích.

Sau khi nhận kết quả, mã nguồn **ghép lại** điểm AI với dữ liệu giá/vốn hóa/khối lượng thực từ CoinMarketCap (dựa theo symbol), **kẹp điểm** trong khoảng 1–10, và **sắp xếp** theo Gem Score giảm dần ([openai.ts:81-101](src/lib/openai.ts#L81-L101)).

### 4.3 Hiển thị thẻ Gem

Component [gem-cards.tsx](src/components/dashboard/gem-cards.tsx) render mỗi gem thành một card giàu thông tin:

- **Badge "Top pick"** cho token có điểm cao nhất.
- **4 ô số liệu**: giá hiện tại, vốn hóa, khối lượng 24h, thay đổi 24h (màu xanh/đỏ theo dấu).
- **Gem Score & Risk Score**: hiển thị dạng số lớn kèm thanh tiến trình gradient (`ScoreBar`).
- **Ô Potential Upside** (viền xanh emerald) và **AI Explanation** (icon violet).
- **Skeleton loading**: hiển thị 3 card giả + banner "Scanning for hidden gems" khi đang xử lý.
- **Trạng thái rỗng/lỗi**: thông báo riêng khi không có token nào khớp tiêu chí hoặc khi quét thất bại (kèm gợi ý kiểm tra API key). Đáng chú ý, lỗi gem scan **không** ảnh hưởng đến chat và dữ liệu thị trường.
- **Accessibility**: section có `aria-live="polite"` và `aria-busy` để hỗ trợ screen reader.

`maxDuration = 60` giây được đặt cho route gems để phù hợp thời gian xử lý AI ([route.ts:6](src/app/api/gems/route.ts#L6)).

---

## 5. Widget thống kê thị trường (cột trái)

[left-sidebar.tsx](src/components/dashboard/left-sidebar.tsx) hiển thị 4 khối:

- **BTC Dominance** — phần trăm thống trị của Bitcoin + tổng vốn hóa thị trường (định dạng compact, ví dụ "$2.34T").
- **Top Gainers** — 5 token tăng mạnh nhất 24h.
- **Top Losers** — 5 token giảm mạnh nhất 24h.
- **Fear & Greed Index** — chỉ số tâm lý thị trường (0–100) với nhãn phân loại, badge đổi màu theo ngưỡng, và thanh gradient đỏ→amber→xanh phản ánh giá trị.
- **Dấu thời gian**: hiển thị thời điểm cập nhật gần nhất.

Có skeleton loading và trạng thái lỗi riêng cho toàn cột.

---

## 6. Widget token trending (cột phải)

[right-sidebar.tsx](src/components/dashboard/right-sidebar.tsx) hiển thị **12 token có khối lượng giao dịch 24h cao nhất** (`getTrending` trong [coinmarketcap.ts:142-146](src/lib/coinmarketcap.ts#L142-L146)):

- Danh sách xếp hạng đánh số kèm symbol, tên, xếp hạng CMC (`#rank`), giá và % thay đổi 24h.
- Cuộn được trong khu vực giới hạn chiều cao (`ScrollArea`), có hiệu ứng hover.

---

## 7. Lớp dữ liệu & tích hợp API

### 7.1 CoinMarketCap ([coinmarketcap.ts](src/lib/coinmarketcap.ts))

- `cmcFetch` — hàm fetch chung, gắn header `X-CMC_PRO_API_KEY`, có cache `revalidate: 60` giây.
- `fetchListings(limit)` — lấy danh sách token mới nhất (`/cryptocurrency/listings/latest`).
- `fetchGlobalMetrics()` — lấy BTC dominance + tổng vốn hóa (`/global-metrics/quotes/latest`).
- `fetchFearGreed()` — gọi Alternative.me (cache 1 giờ, không cần API key).
- `getTopMovers()` / `getTrending()` / `filterHiddenGems()` — các hàm xử lý dữ liệu thuần túy phía client-side logic.
- `mapListing()` — chuẩn hóa dữ liệu CMC thô thành kiểu `MarketToken`.

### 7.2 API tổng hợp thị trường

`GET /api/market` ([route.ts](src/app/api/market/route.ts)) chạy **song song** (`Promise.all`) ba lời gọi: listings (200 token), global metrics, và fear/greed — rồi trả về một object `MarketOverview` duy nhất gồm dominance, tổng vốn hóa, fear/greed, gainers, losers, trending và `updatedAt`.

### 7.3 Kiểu dữ liệu ([types.ts](src/lib/types.ts))

Định nghĩa các interface trung tâm: `MarketToken`, `MarketOverview`, `GemAnalysis`, `ChatMessage` — đảm bảo type-safe xuyên suốt server và client.

### 7.4 Tiện ích ([utils.ts](src/lib/utils.ts))

- `cn()` — gộp class Tailwind (clsx + tailwind-merge).
- `formatCurrency()` — định dạng USD, hỗ trợ chế độ compact (K/M/B) và tăng độ chính xác cho giá < $1.
- `formatPercent()` — định dạng % kèm dấu +/-.

---

## 8. Thư viện component UI

Thư mục [src/components/ui/](src/components/ui/) chứa các primitive kiểu shadcn/ui, xây trên Radix và class-variance-authority:

- **Button** — nhiều biến thể và kích thước.
- **Badge** — biến thể `default`, `muted`, `success`, `danger`.
- **Card** (+ CardHeader, CardContent, CardTitle).
- **Input**, **ScrollArea**, **Separator**, **Skeleton**.

Các component này được tái sử dụng nhất quán trên toàn dashboard.

---

## 9. Tham chiếu API endpoints

| Endpoint | Method | Chức năng |
|----------|--------|-----------|
| `/api/chat` | POST | Chat AI phân tích thị trường (nhận `{ messages }`) |
| `/api/gems` | POST | Chạy pipeline Hidden Gems (lọc CMC → chấm điểm AI) |
| `/api/market` | GET | Trả về dominance, gainers, losers, trending, fear/greed |

Tất cả route đều đặt `dynamic = "force-dynamic"` để luôn lấy dữ liệu mới, và có xử lý lỗi trả về mã 500 kèm thông báo.

---

## 10. Triển khai & vận hành

- **Vercel-ready**: có [vercel.json](vercel.json), chỉ cần thêm hai biến môi trường khi import project.
- **Scripts** ([package.json](package.json)): `dev`, `build`, `start`, `lint`.
- **Bảo mật API key**: mọi lời gọi CoinMarketCap và OpenAI đều nằm ở server-side, key không bao giờ lộ ra client.

---

## Miễn trừ trách nhiệm

Ứng dụng chỉ phục vụ mục đích giáo dục và nghiên cứu. Đây **không** phải là lời khuyên tài chính. Tài sản crypto có mức rủi ro rất cao.
