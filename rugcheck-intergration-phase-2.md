curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getTokenAccountsByOwner",
    "params": [
      "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa",
      { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      {
        "encoding": "base64",
        "dataSlice": { "offset": 0, "length": 72 }
      }
    ]
  }'
RugCheck Bulk Token Summary

curl "https://eu.fluxrpc.com?key=<Your-API-Key>" -s -X POST \
  -H "Content-Type: application/json" \
  -d '{
    "jsonrpc": "2.0",
    "id": 1,
    "method": "getTokenAccountsByOwner",
    "params": [
      "MfDuWeqSHEqTFVYZ7LoexgAK9dxk7cy4DFJWjWMGVWa",
      { "programId": "TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA" },
      {
        "encoding": "base64",
        "dataSlice": { "offset": 0, "length": 32 }
      }
    ]
  }'
  curl -X POST "https://api.rugcheck.xyz/v1/bulk/tokens/summary" \
  -H "Content-Type: application/json" \
  -H "X-API-KEY: <Your-RugCheck-API-Key>" \
  -d '{
    "tokens": [
      "eb5U8spZFfJUUTS4RoterQTVTKwctzMRcd4PctZpump",
      "8JxfHVpnqHeSz99w9XfBwT2uaKHFNU72RNYxrbrxdj69"
    ]
  }'
  