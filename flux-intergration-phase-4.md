

4. Token
getTokenAccountBalance: Trả về số dư token của một tài khoản SPL Token.

curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountBalance",
  "params": ["5Dui9R5UUFJuXm911BmijxZcsm5hmx5gBBdvTwzo9zfE", { "commitment": "finalized" }]
}'

getTokenAccountsByOwner: Trả về tất cả tài khoản SPL Token theo chủ sở hữu token.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountsByOwner",
  "params": [
    "4Qkev8aNZcqFNSRhQzwyLMFSsi94jHqE8WNVTJzTP99F",
    { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { "commitment": "finalized", "encoding": "jsonParsed" }
  ]
}'
{
  "jsonrpc": "2.0",
  "result": {
    "context": { "slot": 1114 },
    "value": [
      {
        "pubkey": "28YTZEwqtMHWrhWcvv34se7pjS7wctgqzCPB3gReCFKp",
        "account": {
          "data": { "parsed": { "info": { "isNative": false, "mint": "3wyAj7Rt1TWVPZVteFCPi2bMFn8recJ9eNhWZaBsKFYR" } } },
          "executable": false,
          "lamports": 1726080,
          "owner": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA"
        }
      }
    ]
  },
  "id": 1
}
getTokenAccountsByDelegate: Trả về tất cả tài khoản SPL Token theo đại biểu được ủy quyền.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountsByDelegate",
  "params": [
    "4Nd1mBQtrMJVYVfKf2PJy9NZUZdTAsp7D4xWLs4gDB4T",
    { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
    { "commitment": "finalized", "encoding": "jsonParsed" }
  ]
}'
getTokenLargestAccounts: Trả về 20 tài khoản lớn nhất của một loại SPL Token cụ thể.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenLargestAccounts",
  "params": ["3wyAj7Rt1TWVPZVteFCPi2bMFn8recJ9eNhWZaBsKFYR", { "commitment": "finalized" }]
}'
getTokenSupply: Trả về tổng nguồn cung của một loại SPL Token.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenSupply",
  "params": ["3wyAj7Rt1TWVPZVteFCPi2bMFn8recJ9eNhWZaBsKFYR", { "commitment": "finalized" }]
}'

getTokenAccountsCount: Trả về số lượng tài khoản token đã được tạo cho mint này.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getTokenAccountsCount",
  "params": [
       "FLUXBmPhT3Fd1EDVFdg46YREqHBeNypn1h4EbnTzWERX",
       {
         "excludeZero": true
       }
       ]
}'
