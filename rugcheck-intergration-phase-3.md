token report
curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getTokenLargestAccounts",
    "params": ["FLUXBmPhT3Fd1EDVFdg46YREqHBeNypn1h4EbnTzWERX"]
  }'
  const RPCAPIKey = "<Your-API-Key>";
const RugCheckAPIKey = "<Your-RugCheck-API-Key>";
const RPCRegion = "eu";
const MintPubKey = "FLUXBmPhT3Fd1EDVFdg46YREqHBeNypn1h4EbnTzWERX"; // Change this to another token, if you wish!

async function fetchTokenLargestAccounts(mint: string) {
  const headers = { "content-type": "application/json" };
  const url = "https://" + RPCRegion + ".fluxrpc.com?key=" + RPCAPIKey;

  const data = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenLargestAccounts",
    params: [mint],
  };
  return fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(data),
  });
}

async function fetchRugCheckReport(tokenMint: string) {
  const headers = { "content-type": "application/json", "X-API-KEY": RugCheckAPIKey };
  const url = "https://api.rugcheck.xyz/v1/tokens/" + tokenMint + "/report";
  return fetch(url, { method: "GET", headers: headers });
}

// Fetch the top holders via RPC
const response = await fetchTokenLargestAccounts(MintPubKey);
if (response.status !== 200) {
  throw new Error("RPC returned HTTP error code " + response.status);
}
const responseJSON = await response.json();
console.log("Top holders according to RPC call:");
for (const i of responseJSON["result"]["value"]) {
  const account = i["address"];
  const balance = i["amount"];
  console.log(account + ": " + balance);
}

// Fetch the RugCheck report
const report = await fetchRugCheckReport(MintPubKey);
if (report.status !== 200) {
  throw new Error("RugCheck returned HTTP error code " + report.status);
}
console.log();
console.log("Top holders according to RugCheck:");
const reportJSON = await report.json();
for (const i of reportJSON["topHolders"]) {
  // Extract & print top holders
  const account = i["address"];
  const owner = i["owner"]; // We can get the owner of the token account too!
  const balance = i["amount"];
  console.log(account + " (owned by " + owner + "): " + balance);
}