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
As we do not yet have historical data available on Solana, if a transaction is not found, we will return an error object that contains our oldest stored slot.
{
  "jsonrpc": "2.0",
  "id": 1,
  "error": {
    "code": -32017,
    "message": "Transaction not available in cache",
    "data": {
      "oldestSlot": 938489449
    }
  }
}
example
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTransaction",
  "params": [
    "2nBhEBYYvfaAe16UMNqRHre4YNSskvuYgx3M6E4JP1oDYvZEJHvoPzyUidNgNX5r9sTyN1J9UxtbCXy2rqYcuyuv",
    { "commitment": "finalized", "encoding": "jsonParsed", "maxSupportedTransactionVersion": 1 }
  ]
}'
{
  "jsonrpc": "2.0",
  "result": {
    "slot": 430,
    "transaction": { "message": { "accountKeys": [], "instructions": [] }, "signatures": [] },
    "meta": { "err": null, "fee": 5000, "preBalances": [], "postBalances": [] },
    "blockTime": 1574721591
  },
  "id": 1
}





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

