8. Inflation (Lạm phát)
getInflationGovernor: Trả về bộ điều tiết lạm phát hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getInflationGovernor",
  "params": [{ "commitment": "finalized" }]
}'
getInflationRate: Trả về các giá trị lạm phát cụ thể cho epoch hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getInflationRate"
}'
getInflationReward: Trả về phần thưởng lạm phát / staking cho danh sách các địa chỉ trong một epoch.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getInflationReward",
  "params": [
    ["6dmNQ5jwLeLk5REvio1JcMshcbvkYMwy26sJ8pbkvStu", "BGsqMegLpV6n6Ve146sSX2dTjUMj3M92HnU8BbNRMhF2"],
    { "commitment": "finalized", "epoch": 2 }
  ]
}'
9. Stake & Vote
getStakeMinimumDelegation: Trả về mức ủy quyền stake tối thiểu (tính bằng lamport).
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getStakeMinimumDelegation",
  "params": [{ "commitment": "finalized" }]
}'
getVoteAccounts: Trả về thông tin tài khoản và khoản stake đi kèm cho tất cả các tài khoản bỏ phiếu trong ngân hàng hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getVoteAccounts",
  "params": [{ "commitment": "finalized" }]
}'
10. Miscellaneous (Khác)
getSupply: Trả về thông tin về nguồn cung hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSupply",
  "params": [{ "commitment": "finalized" }]
}'
getLatestBlockhash: Trả về blockhash mới nhất.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getLatestBlockhash",
  "params": [{ "commitment": "finalized" }]
}'
isBlockhashValid: Kiểm tra xem blockhash còn hiệu lực hay không.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 45,
  "method": "isBlockhashValid",
  "params": [
    "J7rBdM6AecPDEZp8aPq5iPSNKVkU5Q76F3oAV4eW5wsW",
    { "commitment": "finalized" }
  ]
}'
getLeaderSchedule: Trả về lịch trình leader cho một epoch.

curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getLeaderSchedule",
  "params": [{ "commitment": "finalized" }]
}'