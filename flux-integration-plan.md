# Kế hoạch tích hợp Flux RPC vào AlphaHunter AI

Mục tiêu: bổ sung dữ liệu **on-chain Solana** (qua Flux RPC) vào pipeline săn gems, thứ mà CoinMarketCap hiện không có — đặc biệt là phát hiện token mới, kiểm tra rug/honeypot, và đo thanh khoản thực.

## Cách dùng bảng này

- Cột **Hàm Flux dùng** để trống → **bạn điền tên hàm RPC** từ `function-flux.md` vào từng dòng.
- Khi bạn điền xong, tôi sẽ đọc đúng phần tài liệu tương ứng và code theo đó.
- Nếu một dòng bạn không muốn làm, ghi `SKIP` vào cột đó.

Tên các hàm hợp lệ (tham chiếu nhanh từ `function-flux.md`):
`getAccountInfo`,
 `getBalance`, `getLargestAccounts`, `getMultipleAccounts`, `getProgramAccounts`, `getMinimumBalanceForRentExemption`, `getBlock`, `getBlockHeight`, `getBlocks`, `getBlocksWithLimit`, `getBlockTime`, `getFirstAvailableBlock`, `getTransaction`, `getTransactionCount`, `getSignaturesForAddress`, `getTransactionsForAddress`, `getSignatureStatuses`, `getRecentPrioritizationFees`, `sendTransaction`, `simulateTransaction`, `getFeeForMessage`, `getPriorityFeeEstimate`, `getTokenAccountBalance`, `getTokenAccountsByOwner`, `getTokenAccountsByDelegate`, `getTokenLargestAccounts`, `getTokenSupply`, `getTokenAccountsCount`, `getEpochInfo`, `getEpochSchedule`, `getSlot`, `getSlotLeader`, `getSlotLeaders`, `getMaxRetransmitSlot`, `getMaxShredInsertSlot`, `minimumLedgerSlot`, `getClusterNodes`, `getHealth`, `getIdentity`, `getVersion`, `getHighestSnapshotSlot`, `getGenesisHash`, `getRecentPerformanceSamples`, `getInflationGovernor`, `getInflationRate`, `getInflationReward`, `getStakeMinimumDelegation`, `getVoteAccounts`, `getSupply`, `getLatestBlockhash`, `isBlockhashValid`, `getLeaderSchedule`

---

## Giai đoạn 0 — Hạ tầng kết nối

| # | Việc cần làm | File dự kiến | Hàm Flux dùng (bạn điền) | Ghi chú |
|---|--------------|--------------|--------------------------|---------|
| 0.1 | Thêm biến môi trường Flux RPC (URL + API key) | `.env.example` | — | Không cần hàm RPC |
| 0.2 | Tạo client JSON-RPC gọi Flux (`fluxRpc<T>(method, params)`) | `src/lib/flux.ts` (mới) | — | Lớp fetch chung, xử lý lỗi + timeout |
| 0.3 | Health check node trước khi chạy pipeline | `src/lib/flux.ts` | | |
| 0.4 | Kiểm tra version / kết nối (tùy chọn) | `src/lib/flux.ts` | | |

## Giai đoạn 1 — Phát hiện token mới (early detection)

| # | Việc cần làm | File dự kiến | Hàm Flux dùng (bạn điền) | Ghi chú |
|---|--------------|--------------|--------------------------|---------|
| 1.1 | Lấy chữ ký giao dịch gần đây của program tạo token / pool DEX | `src/lib/flux-solana.ts` (mới) | | Địa chỉ program: bạn cung cấp (Raydium / Pump.fun / SPL Token) |
| 1.2 | Giải mã giao dịch để trích xuất mint address + thời điểm tạo | `src/lib/flux-solana.ts` | | |
| 1.3 | Quét lịch sử địa chỉ có lọc/phân trang (thay cho 1.1+1.2 nếu hiệu quả hơn) | `src/lib/flux-solana.ts` | | |

## Giai đoạn 2 — Chấm điểm an toàn on-chain (chống rug/honeypot)

| # | Việc cần làm | File dự kiến | Hàm Flux dùng (bạn điền) | Ghi chú |
|---|--------------|--------------|--------------------------|---------|
| 2.1 | Lấy tổng cung của mint | `src/lib/flux-solana.ts` | | |
| 2.2 | Lấy top holder → tính mức độ tập trung (top 10 nắm %) | `src/lib/flux-solana.ts` | | Chỉ báo rug quan trọng nhất |
| 2.3 | Đếm số holder | `src/lib/flux-solana.ts` | | Holder tăng nhanh = tín hiệu tốt |
| 2.4 | Đọc mint account → kiểm tra mintAuthority / freezeAuthority đã revoke chưa | `src/lib/flux-solana.ts` | | Chưa revoke = nguy cơ honeypot |

## Giai đoạn 3 — Đo thanh khoản & sức khỏe pool

| # | Việc cần làm | File dự kiến | Hàm Flux dùng (bạn điền) | Ghi chú |
|---|--------------|--------------|--------------------------|---------|
| 3.1 | Đọc số dư vault trong pool DEX → tính TVL/thanh khoản | `src/lib/flux-solana.ts` | | |
| 3.2 | Đọc nhiều tài khoản pool trong 1 lời gọi (batch) | `src/lib/flux-solana.ts` | | Giảm round-trip khi quét nhiều token |
| 3.3 | (Tùy chọn) Liệt kê toàn bộ pool của một DEX program | `src/lib/flux-solana.ts` | | Nặng — chỉ dùng khi cần quét toàn diện |

## Giai đoạn 4 — Metadata phụ trợ

| # | Việc cần làm | File dự kiến | Hàm Flux dùng (bạn điền) | Ghi chú |
|---|--------------|--------------|--------------------------|---------|
| 4.1 | Tính tuổi token (slot/thời gian tạo) | `src/lib/flux-solana.ts` | | Token non = rủi ro cao, upside cao |
| 4.2 | (Tùy chọn) Ước tính phí ưu tiên nếu sau này có auto-trade | `src/lib/flux-solana.ts` | | Để dành cho tính năng giao dịch |

## Giai đoạn 5 — Nối vào pipeline gems & định kiểu

| # | Việc cần làm | File dự kiến | Hàm Flux dùng (bạn điền) | Ghi chú |
|---|--------------|--------------|--------------------------|---------|
| 5.1 | Thêm interface `SolanaOnChainMetrics` (concentration, holderCount, authorities, liquidity, ageSlots...) | `src/lib/types.ts` | — | Định kiểu, không gọi RPC |
| 5.2 | Hàm tổng hợp `enrichWithOnChain(mint)` gọi các hàm giai đoạn 2–4 | `src/lib/flux-solana.ts` | (dùng lại các hàm trên) | Chạy song song bằng `Promise.all` |
| 5.3 | Ghép on-chain metrics vào ứng viên trước khi `analyzeGems` | `src/app/api/gems/route.ts` | — | Chỉ áp dụng cho token Solana |
| 5.4 | Cập nhật `GEM_SYSTEM_PROMPT` để AI dùng thêm dữ liệu on-chain khi chấm điểm | `src/lib/ai.ts` | — | Prompt engineering |
| 5.5 | (Tùy chọn) Endpoint riêng `/api/solana-gems` chỉ quét on-chain | `src/app/api/solana-gems/route.ts` (mới) | — | Nếu muốn tách khỏi luồng CMC |

---

## Câu hỏi cần bạn xác nhận (điền cùng lúc với bảng)

1. **Endpoint Flux RPC**: URL đầy đủ? Tên biến env mong muốn (vd `FLUX_RPC_URL`, `FLUX_RPC_API_KEY`)?
2. **Program addresses** cho giai đoạn 1: bạn muốn quét DEX nào? (Raydium AMM, Pump.fun, Meteora, Orca...) — cần địa chỉ program cụ thể.
3. **Phạm vi**: chỉ làm giai đoạn 2 (chấm điểm an toàn) trước, hay làm cả 1 (phát hiện token mới)?
4. **Cách kết hợp CMC**: enrich token Solana đã có trên CMC, hay quét độc lập on-chain rồi mới đối chiếu CMC?

> Sau khi bạn điền cột "Hàm Flux dùng" và trả lời các câu hỏi trên, tôi sẽ đọc đúng phần trong `function-flux.md` cho từng hàm và triển khai theo tài liệu.
