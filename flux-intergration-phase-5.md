5. Epoch
getEpochInfo: Trả về thông tin về epoch hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getEpochInfo",
  "params": [{ "commitment": "finalized" }]
}'
getEpochSchedule: Trả về thông tin lịch trình epoch từ cấu hình genesis của cluster.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getEpochSchedule"
}'
6. Slot
getSlot: Trả về slot đã đạt đến mức cam kết được chỉ định hoặc mặc định.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSlot",
  "params": [{ "commitment": "finalized" }]
}'
getSlotLeader: Trả về slot leader hiện tại.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSlotLeader",
  "params": [{ "commitment": "finalized" }]
}'
getSlotLeaders: Trả về các slot leader cho một khoảng slot được cho.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSlotLeaders",
  "params": [100, 10]
}'
getMaxRetransmitSlot: Lấy slot tối đa được ghi nhận từ giai đoạn truyền lại (retransmit stage).
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getMaxRetransmitSlot"
}'
getMaxShredInsertSlot: Lấy slot tối đa được ghi nhận sau khi chèn shred.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getMaxShredInsertSlot"
}'
minimumLedgerSlot: Trả về slot thấp nhất mà node có thông tin trong sổ cái của nó.
curl "https://eu.fluxrpc.com?key=<your-API-key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "minimumLedgerSlot"
}'
