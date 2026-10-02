https://api.rugcheck.xyz/ping?key=<your-API-key>
Some accounts can own a lot of tokens, for example the following owns more than 1000! We'll use this one in our examples today, just to use something with a little more meat than a wallet that owns only a handful of tokens.
curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getTokenAccountsByOwner",
    "params": [
      "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa",
      { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      { "encoding": "base64" }
    ]
  }'
  import bs58 from "bs58";

const RPCAPIKey = "<Your-API-Key>";
const RugCheckAPIKey = "<Your-RugCheck-API-Key>";
const RPCRegion = "eu";
const AccountPubKey = "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa"; // Add your wallet here, if you want!

async function fetchTokenAccounts(pubKey: string, program: string) {
  const headers = { "content-type": "application/json" };
  const url = "https://" + RPCRegion + ".fluxrpc.com?key=" + RPCAPIKey;

  const data = {
    jsonrpc: "2.0",
    id: 1,
    method: "getTokenAccountsByOwner",
    params: [
      pubKey,
      { programId: program },
      {
        encoding: "base64",
        dataSlice: { offset: 0, length: 72 },
      },
    ],
  };
  return fetch(url, {
    method: "POST",
    headers: headers,
    body: JSON.stringify(data),
  });
}

async function fetchRugCheckReport(tokenMint: string) {
  const headers = { "content-type": "application/json", "X-API-KEY": RugCheckAPIKey };
  const url = "https://api.rugcheck.xyz/v1/tokens/" + tokenMint + "/report/summary";
  return fetch(url, { method: "GET", headers: headers });
}

// Fetch all SPL token accounts for the wallet & append to allMints list
// This is requesting a lot of data, and could take a moment to complete.
const response = await fetchTokenAccounts(AccountPubKey, "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA");
if (response.status !== 200) {
  throw new Error("RPC returned HTTP error code " + response.status);
}
const responseJSON = await response.json();
const tokenAccounts = responseJSON["result"]["value"];
const allMints: string[] = [];
const allAmounts: string[] = [];
for (const i of tokenAccounts) {
  const dataBytes = Buffer.from(i["account"]["data"][0], "base64");
  // The 72 byte slice we requested is: mint (32) + owner (32) + amount (8, little endian)
  allMints.push(bs58.encode(dataBytes.subarray(0, 32)));
  allAmounts.push(dataBytes.readBigUInt64LE(dataBytes.length - 8).toString());
}

// This outputs a lot of mints, lets limit it to printing out 5, although we have all of them!
allMints.slice(0, 5).forEach((i, count) => {
  console.log("Mint: " + i + " Balance: " + allAmounts[count]);
});

const report = await fetchRugCheckReport(allMints[0]); // Fetch the rugcheck report summary for one token we found
if (report.status !== 200) {
  throw new Error("RugCheck returned HTTP error code " + report.status);
}

const reportJSON = await report.json();
console.log(); // Empty line so it's easier to read
// Lets print this just so you can see what the report looks like
console.log("Token Report for mint: " + allMints[0]);
console.log(reportJSON);
console.log(); // Empty line so it's easier to read
// Let's extract the token score too
console.log("The token score for token mint: " + allMints[0] + " is: " + reportJSON["score_normalised"]);
{
  "Server": "nginx/1.22.1",
  "Date": "Thu, 30 Jul 2026 11:56:06 GMT",
  "Content-Type": "application/json; charset=utf-8",
  "Transfer-Encoding": "chunked",
  "Connection": "keep-alive",
  "Vary": "Accept-Encoding",
  "X-Rate-Limit-Limit": "3",
  "X-Rate-Limit-Remaining": "2",
  "Content-Encoding": "gzip"
}
