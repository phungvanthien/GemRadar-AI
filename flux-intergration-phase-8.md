getProgramAccounts 
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getProgramAccounts",
  "params": [
    "FLUXubRmkEi2q6K3Y9kBPg9248ggaZVsoSFhtJHSrm1X",
    { "commitment": "finalized", "encoding": "jsonParsed",
    "changedSinceSlot": 406846134,
    "filters": [{ "dataSize": 324 }] }
  ]
}'
getTransactionsForAddress
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
getTransaction
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

getSignaturesForAddress
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSignaturesForAddress",
  "params": [
    "Vote111111111111111111111111111111111111111",
    { "commitment": "finalized", "limit": 1 }
  ]
}'