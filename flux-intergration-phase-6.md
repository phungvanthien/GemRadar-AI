7. Cluster & Node
getClusterNodes: Trả về thông tin về tất cả các node tham gia vào cluster.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getClusterNodes"
}'
getHealth: Trả về trạng thái sức khỏe hiện tại của node.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getHealth"
}'
getIdentity: Trả về pubkey định danh cho node hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getIdentity"
}'
getVersion: Trả về phiên bản Solana hiện đang chạy trên node.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getVersion"
}'
getHighestSnapshotSlot: Trả về thông tin slot cao nhất mà node có bản snapshot.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getHighestSnapshotSlot"
}'
getGenesisHash: Trả về mã hash genesis.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getGenesisHash"
}'
getRecentPerformanceSamples: Trả về danh sách các mẫu hiệu suất gần đây theo thứ tự slot đảo ngược.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getRecentPerformanceSamples",
  "params": [4]
}'
