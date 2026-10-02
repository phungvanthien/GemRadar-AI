2. Block (Khối)
getBlock: Trả về thông tin định danh và giao dịch về một khối đã được xác nhận trong sổ cái.

getBlockHeight: Trả về chiều cao khối hiện tại của node.

getBlocks: Trả về danh sách các khối đã được xác nhận giữa hai slot.

getBlocksWithLimit: Trả về danh sách các khối đã được xác nhận bắt đầu từ slot được chỉ định.

getBlockTime: Trả về thời gian sản xuất ước tính của một khối.

getFirstAvailableBlock: Trả về slot của khối đã được xác nhận thấp nhất chưa bị xóa khỏi sổ cái.

Replace the block number in getBlock with the result of running getSlot. If you use the number in the example below it will not succeed.

curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getSlot",
  "params": []
}'

{
  "jsonrpc": "2.0",
  "result": 439186001,
  "id": 1
}
Pass that number to getBlock as the first parameter:
curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST -H "Content-Type: application/json" -d '
{
  "jsonrpc": "2.0",
  "id": 1,
  "method": "getBlock",
  "params": [
    439186001,
    {
      "encoding": "json",
      "transactionDetails": "none",
      "maxSupportedTransactionVersion": 1
    }
  ]
}'

{
  "jsonrpc": "2.0",
  "result": {
    "blockHeight": 417237399,
    "blockTime": 1786693960,
    "blockhash": "E3LnpvQ8VonK9Nw2rZN6P5PgE9yVco184mCRVS7WwChP",
    "parentSlot": 439186000,
    "previousBlockhash": "2XxeU8uLoEradwkUv2YU6sH8BryB3dTPgtcDWKLrigCZ",
    "rewards": []
  },
  "id": 1
}
For Whom the Bell Polls
That timer would look something like this:
setInterval(async () => {
  const slot = await callRpc("getSlot", []);
  const block = await callRpc("getBlock", [
    slot,
    { encoding: "json", transactionDetails: "full", maxSupportedTransactionVersion: 1 },
  ]);
  render(block);
}, 400);
The API key goes in an input box rather than into the source code. Just so you don't accidentally hand it out.

app.js
JavaScript
const YELLOWSTONE_URL = "wss://yellowstone.eu.fluxrpc.com";
const FLUXRPC_SHIELD_KEY = "<Your-Shield-Key>";
const FLUXRPC_SHIELD_RPC_URL = "https://cdn.shield.fluxrpc.com";
const MAX_ROWS = 25;

const apiKeyInput = document.getElementById("apiKey");
const startButton = document.getElementById("startButton");
const stopButton = document.getElementById("stopButton");
const statusLine = document.getElementById("statusLine");
const blockRows = document.getElementById("blockRows");
const detailOutput = document.getElementById("detailOutput");

let socket = null;
let wantConnection = false;
let reconnectDelay = 1000;
let previousBlockTime = 0;

function buildBlockMetaRequest() {
  return {
    accounts: {},
    slots: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: { new_blocks: {} },
    entry: {},
    commitment: "PROCESSED",
    accountsDataSlice: [],
  };
}

function connect() {
  const apiKey = apiKeyInput.value.trim();
  if (!apiKey) {
    statusLine.textContent = "Enter your API key first.";
    return;
  }

  socket = new WebSocket(`${YELLOWSTONE_URL}/?key=${apiKey}&encoding=json`);

  socket.addEventListener("open", () => {
    reconnectDelay = 1000;
    socket.send(JSON.stringify(buildBlockMetaRequest()));
    statusLine.textContent = "Subscribed. Waiting for the first block.";
  });

  socket.addEventListener("message", (event) => {
    const update = JSON.parse(event.data);
    if (!update.blockMeta) return;
    addBlockRow(update.blockMeta);
  });

  socket.addEventListener("close", (event) => {
    socket = null;
    if (!wantConnection) {
      statusLine.textContent = "Stopped.";
      return;
    }
    statusLine.textContent = `Disconnected (code ${event.code}). Reconnecting.`;
    setTimeout(connect, reconnectDelay);
    reconnectDelay = Math.min(reconnectDelay * 2, 30000);
  });
}

function addBlockRow(meta) {
  const slot = Number(meta.slot);
  const transactions = Number(meta.executedTransactionCount ?? 0);
  const blockTime = Number(meta.blockTime?.timestamp ?? 0);
  const gap = previousBlockTime ? `${blockTime - previousBlockTime}s` : "";
  previousBlockTime = blockTime;

  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${slot}</td>
    <td>${meta.blockhash.slice(0, 8)}...</td>
    <td>${transactions}</td>
    <td>${gap}</td>
    <td><button data-slot="${slot}">Detail</button></td>
  `;
  blockRows.prepend(row);

  while (blockRows.children.length > MAX_ROWS) {
    blockRows.lastElementChild.remove();
  }

  statusLine.textContent = `Streaming. Latest slot ${slot}.`;
}

async function callRpc(method, params) {
  const response = await fetch(
    FLUXRPC_SHIELD_RPC_URL + "?key=" + encodeURIComponent(FLUXRPC_SHIELD_KEY),
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method, params }),
    },
  );

  const payload = await response.json();
  if (payload.error) throw new Error(payload.error.message);
  return payload.result;
}

async function showBlockDetail(slot) {
  detailOutput.textContent = `Fetching block ${slot}...`;
  try {
    const block = await callRpc("getBlock", [
      slot,
      { encoding: "json", transactionDetails: "signatures", maxSupportedTransactionVersion: 1 },
    ]);
    detailOutput.textContent = `${block.signatures.length} transactions in block ${slot}\n${block.signatures[0]}`;
  } catch (error) {
    detailOutput.textContent = `${error.message}\n\nBlocks older than about a minute are no longer fetchable.`;
  }
}

blockRows.addEventListener("click", (event) => {
  const slot = event.target.dataset?.slot;
  if (slot) void showBlockDetail(Number(slot));
});

startButton.addEventListener("click", () => {
  wantConnection = true;
  startButton.disabled = true;
  stopButton.disabled = false;
  blockRows.replaceChildren();
  previousBlockTime = 0;
  connect();
});

stopButton.addEventListener("click", () => {
  wantConnection = false;
  startButton.disabled = false;
  stopButton.disabled = true;
  socket?.close();
});
Open the Socket
wss://yellowstone.eu.fluxrpc.com/?key=<Your-API-Key>&encoding=json
socket = new WebSocket(`${YELLOWSTONE_URL}/?key=${apiKey}&encoding=json`);

Say What You Want to Receive
function buildBlockMetaRequest() {
  return {
    accounts: {},
    slots: {},
    transactions: {},
    transactionsStatus: {},
    blocks: {},
    blocksMeta: { new_blocks: {} },
    entry: {},
    commitment: "PROCESSED",
    accountsDataSlice: [],
  };
}
 Read What Comes Back
 {
  "pong": {},
  "createdAt": "2026-08-12T10:06:15.407060434Z"
}
{
  "filters": [
    "new_blocks"
  ],
  "blockMeta": {
    "slot": "438782462",
    "blockhash": "6K9ktBMvDsK47xozu1WaVuRsBvCrrPBiBc91BdcwafrU",
    "blockTime": {
      "timestamp": "1786525403"
    },
    "blockHeight": {
      "blockHeight": "416834683"
    },
    "parentSlot": "438782461",
    "parentBlockhash": "41mgqCR5skrYPsofXjMY4izjCzrytPNK4WNWLcHK9uAA",
    "executedTransactionCount": "1036"
  }
}
  socket.addEventListener("message", (event) => {
    const update = JSON.parse(event.data);
    if (!update.blockMeta) return;
    addBlockRow(update.blockMeta);
  });
  function addBlockRow(meta) {
  const slot = Number(meta.slot);
  const transactions = Number(meta.executedTransactionCount ?? 0);
  const blockTime = Number(meta.blockTime?.timestamp ?? 0);
  const gap = previousBlockTime ? `${blockTime - previousBlockTime}s` : "";
  previousBlockTime = blockTime;

  const row = document.createElement("tr");
  row.innerHTML = `
    <td>${slot}</td>
    <td>${meta.blockhash.slice(0, 8)}...</td>
    <td>${transactions}</td>
    <td>${gap}</td>
    <td><button data-slot="${slot}">Detail</button></td>
  `;
  blockRows.prepend(row);

  while (blockRows.children.length > MAX_ROWS) {
    blockRows.lastElementChild.remove();
  }

  statusLine.textContent = `Streaming. Latest slot ${slot}.`;
}

