Token Insider Graph
const tokenMint = 'TokenMintAddress';
const response = await fetch(`https://api.rugcheck.xyz/v1/tokens/${tokenMint}/insiders/graph`);
const data = await response.json();

// Process network data
data.networks?.forEach(network => {
  console.log(`Network: ${network.net_id}`);
  console.log(`Type: ${network.network_type}`);
  console.log(`Nodes: ${network.nodes.length}`);
  console.log(`Links: ${network.links.length}`);
});
{
  "net_id": "16b876c9-072c-4e57-85d3-9d7520d49771",
  "network_type": "trade",
  "nodes": [
    {
      "id": "EQLrA18M9a81x32WFQ6ZMgEJ9kWJSeChcPqYoqpWxSLk",
      "participant": false,
      "holdings": 0
    }
  ],
  "links": [
    {
      "source": "FJj86LhiVS6Grx9xo5KKuphUtJssvJusrPULTmsWTBJo",
      "target": "4M4iT5Ty3hMzEvDDhYHM517bt9n5TA8YToYNKCjEpURS"
    }
  ],
  "relatedMint": null
}
Bulk Token Reports
const response = await fetch('https://api.rugcheck.xyz/v1/bulk/tokens/report', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'X-API-KEY': '<your-API-key>'
  },
  body: JSON.stringify({
    tokens: [
      'eb5U8spZFfJUUTS4RoterQTVTKwctzMRcd4PctZpump',
      '8JxfHVpnqHeSz99w9XfBwT2uaKHFNU72RNYxrbrxdj69'
    ]
  })
});
const data = await response.json();
console.log(data);
[
  {
    "mint": "eb5U8spZFfJUUTS4RoterQTVTKwctzMRcd4PctZpump",
    "risks": [...],
    "score": 250,
    "tokenMeta": {...},
    "markets": [...]
  },
  {
    "mint": "8JxfHVpnqHeSz99w9XfBwT2uaKHFNU72RNYxrbrxdj69",
    "risks": [...],
    "score": 150,
    "tokenMeta": {...},
    "markets": [...]
  }
]