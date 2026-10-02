Dưới đây là tổng hợp các hàm gọi dữ liệu (RPC HTTP Methods) được hỗ trợ trên trang FluxRPC Docs, được chia theo từng nhóm danh mục:

1. Account (Tài khoản)
getAccountInfo: Trả về toàn bộ thông tin liên kết với tài khoản của Pubkey được cung cấp.

getBalance: Trả về số dư lamport của tài khoản theo Pubkey.

getLargestAccounts: Trả về 20 tài khoản lớn nhất tính theo số dư lamport.

getMultipleAccounts: Trả về thông tin tài khoản cho một danh sách các Pubkey.

getProgramAccounts: Trả về tất cả các tài khoản thuộc sở hữu của Pubkey chương trình được cung cấp.

getMinimumBalanceForRentExemption: Trả về số dư tối thiểu cần thiết để tài khoản được miễn phí thuê (rent exempt).

2. Block (Khối)
getBlock: Trả về thông tin định danh và giao dịch về một khối đã được xác nhận trong sổ cái.

getBlockHeight: Trả về chiều cao khối hiện tại của node.

getBlocks: Trả về danh sách các khối đã được xác nhận giữa hai slot.

getBlocksWithLimit: Trả về danh sách các khối đã được xác nhận bắt đầu từ slot được chỉ định.

getBlockTime: Trả về thời gian sản xuất ước tính của một khối.

getFirstAvailableBlock: Trả về slot của khối đã được xác nhận thấp nhất chưa bị xóa khỏi sổ cái.

3. Transaction (Giao dịch)
getTransaction: Trả về chi tiết giao dịch cho một giao dịch đã được xác nhận.

getTransactionCount: Trả về tổng số lượng giao dịch hiện tại từ sổ cái.

getSignaturesForAddress: Trả về chữ ký cho các giao dịch đã xác nhận có chứa địa chỉ được cung cấp trong danh sách accountKeys.

getTransactionsForAddress: Truy vấn lịch sử giao dịch với các tính năng lọc nâng cao, sắp xếp hai chiều và phân trang hiệu quả.

getSignatureStatuses: Trả về trạng thái của một danh sách chữ ký (txid).

getRecentPrioritizationFees: Trả về danh sách phí ưu tiên từ các khối gần đây.

sendTransaction: Gửi một giao dịch đã được ký lên cluster để xử lý.

simulateTransaction: Mô phỏng việc gửi giao dịch.

getFeeForMessage: Lấy mức phí mà mạng lưới sẽ tính cho một thông điệp cụ thể.

getPriorityFeeEstimate: Ước tính phí ưu tiên (tính bằng microlamport) cần thiết cho một giao dịch.

4. Token
getTokenAccountBalance: Trả về số dư token của một tài khoản SPL Token.

getTokenAccountsByOwner: Trả về tất cả tài khoản SPL Token theo chủ sở hữu token.

getTokenAccountsByDelegate: Trả về tất cả tài khoản SPL Token theo đại biểu được ủy quyền.

getTokenLargestAccounts: Trả về 20 tài khoản lớn nhất của một loại SPL Token cụ thể.

getTokenSupply: Trả về tổng nguồn cung của một loại SPL Token.

getTokenAccountsCount: Trả về số lượng tài khoản token đã được tạo cho mint này.

5. Epoch
getEpochInfo: Trả về thông tin về epoch hiện tại.

getEpochSchedule: Trả về thông tin lịch trình epoch từ cấu hình genesis của cluster.

6. Slot
getSlot: Trả về slot đã đạt đến mức cam kết được chỉ định hoặc mặc định.

getSlotLeader: Trả về slot leader hiện tại.

getSlotLeaders: Trả về các slot leader cho một khoảng slot được cho.

getMaxRetransmitSlot: Lấy slot tối đa được ghi nhận từ giai đoạn truyền lại (retransmit stage).

getMaxShredInsertSlot: Lấy slot tối đa được ghi nhận sau khi chèn shred.

minimumLedgerSlot: Trả về slot thấp nhất mà node có thông tin trong sổ cái của nó.

7. Cluster & Node
getClusterNodes: Trả về thông tin về tất cả các node tham gia vào cluster.

getHealth: Trả về trạng thái sức khỏe hiện tại của node.

getIdentity: Trả về pubkey định danh cho node hiện tại.

getVersion: Trả về phiên bản Solana hiện đang chạy trên node.

getHighestSnapshotSlot: Trả về thông tin slot cao nhất mà node có bản snapshot.

getGenesisHash: Trả về mã hash genesis.

getRecentPerformanceSamples: Trả về danh sách các mẫu hiệu suất gần đây theo thứ tự slot đảo ngược.

8. Inflation (Lạm phát)
getInflationGovernor: Trả về bộ điều tiết lạm phát hiện tại.

getInflationRate: Trả về các giá trị lạm phát cụ thể cho epoch hiện tại.

getInflationReward: Trả về phần thưởng lạm phát / staking cho danh sách các địa chỉ trong một epoch.

9. Stake & Vote
getStakeMinimumDelegation: Trả về mức ủy quyền stake tối thiểu (tính bằng lamport).

getVoteAccounts: Trả về thông tin tài khoản và khoản stake đi kèm cho tất cả các tài khoản bỏ phiếu trong ngân hàng hiện tại.

10. Miscellaneous (Khác)
getSupply: Trả về thông tin về nguồn cung hiện tại.

getLatestBlockhash: Trả về blockhash mới nhất.

isBlockhashValid: Kiểm tra xem blockhash còn hiệu lực hay không.

getLeaderSchedule: Trả về lịch trình leader cho một epoch.