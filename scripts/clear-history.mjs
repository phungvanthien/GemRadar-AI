// Script to clear all trade history and reset cumulative PnL
import { clearAllPositions } from "../src/lib/position-store.js";
import { clearMandate } from "../src/lib/mandate-store.js";

async function main() {
  console.log("Clearing Traded Gems history...");
  await clearAllPositions();
  console.log("✓ Traded Gems history cleared");

  console.log("\nResetting cumulative Wallet PnL (SOL)...");
  await clearMandate();
  console.log("✓ Cumulative Wallet PnL reset");

  console.log("\nAll history cleared successfully!");
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
