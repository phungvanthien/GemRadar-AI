// Probe the RugCheck WebSocket endpoints using Node's core `https` module to
// perform the Upgrade handshake by hand. Unlike the global WebSocket (which
// hides the failure behind "non-101 status"), a raw request lets us read the
// EXACT HTTP status code + headers + body the server returns when it refuses.
// That status is what tells us: needs key (401), forbidden (403), wrong path
// (404), needs upgrade (426), or a redirect (3xx). No dependency, no flags.
// Run: node scripts/probe-socket.mjs

import { readFileSync } from "node:fs";
import https from "node:https";
import crypto from "node:crypto";

try {
  const raw = readFileSync(new URL("../.env.local", import.meta.url), "utf8");
  for (const line of raw.split("\n")) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2];
  }
} catch {}

const KEY = process.env.RUGCHECK_API_KEY ?? "";
const now = () => new Date().toISOString().slice(11, 23);

// Attempt a WS Upgrade against one URL. `extraHeaders` lets us try auth
// placements. Resolves after logging the server's real response.
function handshake(rawUrl, extraHeaders = {}) {
  return new Promise((resolve) => {
    const u = new URL(rawUrl);
    const key = crypto.randomBytes(16).toString("base64");
    const req = https.request({
      hostname: u.hostname,
      port: 443,
      path: u.pathname + u.search,
      method: "GET",
      headers: {
        Connection: "Upgrade",
        Upgrade: "websocket",
        "Sec-WebSocket-Version": "13",
        "Sec-WebSocket-Key": key,
        Origin: "https://rugcheck.xyz",
        ...extraHeaders,
      },
    });

    let settled = false;
    const finish = () => { if (!settled) { settled = true; resolve(); } };

    // 101 upgrade accepted — the happy path.
    req.on("upgrade", (res, socket) => {
      console.log(`  ${now()} ${rawUrl} -> 101 UPGRADE OK (headers: ${JSON.stringify(res.headers)})`);
      socket.on("data", (d) => console.log(`      <- ${d.toString().slice(0, 300)}`));
      // Try a couple of subscribe shapes over the raw socket (WS frames are
      // more work by hand; we just watch whether the server pushes anything).
      setTimeout(() => { try { socket.end(); } catch {}; finish(); }, 5000);
    });

    // Non-101: the server answered with a normal HTTP response. THIS is the
    // diagnostic we want.
    req.on("response", (res) => {
      let body = "";
      res.on("data", (c) => (body += c));
      res.on("end", () => {
        const hints = {};
        for (const h of ["www-authenticate", "location", "sec-websocket-protocol", "content-type"]) {
          if (res.headers[h]) hints[h] = res.headers[h];
        }
        console.log(
          `  ${now()} ${rawUrl} -> ${res.statusCode} ${res.statusMessage}` +
            (Object.keys(hints).length ? ` | ${JSON.stringify(hints)}` : "") +
            (body ? ` | body: ${body.slice(0, 200)}` : ""),
        );
        finish();
      });
    });

    req.on("error", (e) => {
      console.log(`  ${now()} ${rawUrl} -> error: ${e.message}`);
      finish();
    });
    req.setTimeout(10000, () => { console.log(`  ${now()} ${rawUrl} -> timeout`); try { req.destroy(); } catch {}; finish(); });
    req.end();
  });
}

console.log("RugCheck WS handshake probe (raw https)");
console.log("Node:", process.version, "| key:", KEY ? "set" : "MISSING");

console.log("\n[A] Plain handshake, no auth:");
await handshake("wss://api.rugcheck.xyz/ws");
await handshake("wss://api.rugcheck.xyz/ws/insider-networks");
await handshake("wss://api.rugcheck.xyz/v1/ws");

console.log("\n[B] With X-API-KEY header:");
if (KEY) {
  await handshake("wss://api.rugcheck.xyz/ws", { "X-API-KEY": KEY });
  await handshake("wss://api.rugcheck.xyz/ws/insider-networks", { "X-API-KEY": KEY });
} else console.log("  (no key)");

console.log("\n[C] With key as query param:");
if (KEY) {
  await handshake(`wss://api.rugcheck.xyz/ws?api-key=${encodeURIComponent(KEY)}`);
  await handshake(`wss://api.rugcheck.xyz/ws?token=${encodeURIComponent(KEY)}`);
}

console.log("\ndone.");
