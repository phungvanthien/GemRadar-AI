
HTTP RPC
https://cdn.fluxrpc.com?key=<your-API-key>
WebSocket
wss://ws.eu.fluxrpc.com


Send JSON-RPC traffic over HTTPS or subscribe over WebSocket.
curl -X POST "https://eu.fluxrpc.com?key=<your-API-key>" \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getBalance",
    "params": ["YOUR_WALLET_ADDRESS"]
  }'
Dưới đây là tổng hợp các hàm gọi dữ liệu (RPC HTTP Methods) được hỗ trợ trên trang FluxRPC Docs, được chia theo từng nhóm danh mục:

1. Account (Tài khoản)
getAccountInfo: Trả về toàn bộ thông tin liên kết với tài khoản của Pubkey được cung cấp.

getBalance: Trả về số dư lamport của tài khoản theo Pubkey.

getLargestAccounts: Trả về 20 tài khoản lớn nhất tính theo số dư lamport.

getMultipleAccounts: Trả về thông tin tài khoản cho một danh sách các Pubkey.

getProgramAccounts: Trả về tất cả các tài khoản thuộc sở hữu của Pubkey chương trình được cung cấp.

getMinimumBalanceForRentExemption: Trả về số dư tối thiểu cần thiết để tài khoản được miễn phí thuê (rent exempt).

  getAccountInfo:
  This RPC call is very straightforward to use:
  const APIKey = "<Your-API-Key>";
const RPCRegion = "eu";
const AccountPubKey = "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa";

async function fetchAccount(pubKey: string) {
  console.log("getAccount for public key " + pubKey);
  const headers = { "content-type": "application/json" };
  const url = "https://" + RPCRegion + ".fluxrpc.com?key=" + APIKey;

  const data = {
    jsonrpc: "2.0",
    id: 1,
    method: "getAccountInfo",
    params: [
      pubKey,
      {
        encoding: "base64",
      },
    ],
  };
  const response = await fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(data),
  });
  return response;
}

(async () => {
  const response = await fetchAccount(AccountPubKey);
  if (response.status !== 200) {
    throw new Error("RPC returned HTTP error code " + response.status);
  }
  const responseJSON = await response.json();
  console.log(responseJSON);
})();

You will get a response that looks something like the following:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "context": {
      "apiVersion": "1.33.7",
      "slot": 434450667
    },
    "value": {
      "owner": "11111111111111111111111111111111",
      "lamports": 94275198182,
      "executable": false,
      "rentEpoch": 18446744073709551615,
      "space": 0,
      "data": [
        "",
        "base64"
      ]
    }
  }
}
In the case where you make a getAccountInfo RPC call for a public key that doesn't exist, it will respond with:
{
  "jsonrpc": "2.0",
  "id": 1,
  "result": {
    "context": {
      "apiVersion": "1.33.7",
      "slot": 434654544
    },
    "value": null
  }
}

Solana accounts can store arbitrary data. Usually this is used by the program that owns them to store information needed for its operation.

For example, in Associated Token Accounts (ATA) the Token program stores the mint and amount of tokens held in the data field. We can fetch the token balance using the getTokenAccountBalance RPC method as follows:

curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getTokenAccountBalance",
    "params": [
      "5Dui9R5UUFJuXm911BmijxZcsm5hmx5gBBdvTwzo9zfE"
    ]
  }'

  If we had instead selected jsonParsed encoding for our last getAccountInfo call like so:
  curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getAccountInfo",
    "params": [
      "5Dui9R5UUFJuXm911BmijxZcsm5hmx5gBBdvTwzo9zfE",
      {
        "encoding": "jsonParsed"
      }
    ]
  }'


Dưới đây là tổng hợp các hàm gọi dữ liệu (RPC HTTP Methods) được hỗ trợ trên trang FluxRPC Docs, được chia theo từng nhóm danh mục:



