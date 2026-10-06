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



