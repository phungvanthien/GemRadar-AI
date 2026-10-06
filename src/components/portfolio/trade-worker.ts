import { verifyTokenSafety } from "@/services/rugcheck";
import { loadSettings } from "@/lib/settings-store";

// --- CẤU HÌNH NGƯỠNG HỆ THỐNG ---
const MIN_GEM_SCORE_THRESHOLD = 60;   
const MIN_AI_BUY_THRESHOLD = 75;      
const WATCH_SCORE_FLOOR = 40;         

interface GemRawItem {
  mint: string;
  symbol: string;
  name: string;
  liquiditySol: number;
  volume24h: number;
  baseScore?: number;
  gemScore?: number;
  isRugged?: boolean;
}

// Định nghĩa kiểu dữ liệu cho một vị thế (Position)
interface Position {
  id: string;
  mint: string;
  symbol: string;
  entryPriceSol: number;
  soldPct?: number;
  [key: `tier_${string}_sold`]: boolean | undefined;
}

export async function runTradeWorkerCycle() {
  console.log("🔄 [Worker] Bắt đầu chu kỳ quét tổng hợp...");

  try {
    // 0A. GIÁM SÁT VÀ CẮT LỖ TỰ ĐỘNG (STOP-LOSS)
    await monitorAndExecuteStopLoss();

    // 0B. GIÁM SÁT VÀ CHỐT LỜI TỰ ĐỘNG (TAKE-PROFIT TỪ SETTINGS)
    await monitorAndExecuteTakeProfit();

    // ==========================================
    // BƯỚC 1: QUÉT LIVE FEED & BỘ LỌC AN TOÀN (ANTI-RUG)
    // ==========================================
    const rawGems: GemRawItem[] = await fetchLiveFeedTokens();
    console.log(`📡 [Worker] Nhận được ${rawGems.length} tokens từ Live Feed.`);

    const validGems: GemRawItem[] = [];
    for (const gem of rawGems) {
      if (gem.liquiditySol < 5 || gem.volume24h < 1000) continue;

      const safetyCheck = await verifyTokenSafety(gem.mint);
      if (!safetyCheck.isSafe) {
        console.log(`🛡️ [Anti-Rug] Đã chặn token rác ${gem.symbol}: ${safetyCheck.reason}`);
        continue;
      }
      validGems.push(gem);
    }

    // ==========================================
    // BƯỚC 2: CHẤM ĐIỂM GEMSCORE ĐỊNH LƯỢNG
    // ==========================================
    const scoredGems = validGems.map((gem) => {
      const gemScore = calculateDeterministicGemScore(gem);
      return { ...gem, gemScore };
    });

    const qualifiedForAI = scoredGems.filter((g) => g.gemScore >= MIN_GEM_SCORE_THRESHOLD);
    const top6Gems = qualifiedForAI
      .sort((a, b) => b.gemScore! - a.gemScore!)
      .slice(0, 6);

    // ==========================================
    // BƯỚC 3: AI AGENT CHECKING & MỞ LỆNH MUA
    // ==========================================
    for (const gem of top6Gems) {
      const aiResult = await callAIAgentChecking(gem); 

      if (aiResult.score >= MIN_AI_BUY_THRESHOLD) {
        console.log(`🚀 [AI Approved] Token ${gem.symbol} đạt điểm AI ${aiResult.score}/100. TIẾN HÀNH MỞ LỆNH MUA!`);
        await executeBuyOrder(gem, aiResult);
      } else {
        await upsertDedicatedWatchlist({
          mint: gem.mint,
          symbol: gem.symbol,
          lastAiScore: aiResult.score,
          currentToolScore: gem.gemScore,
          peakToolScore: gem.gemScore,
          addedAt: new Date().toISOString(),
          lastCheckedAt: new Date().toISOString(),
        });
      }
    }

    // ==========================================
    // BƯỚC 4: QUÉT WATCHLIST RIÊNG BẰNG TOOL (MỖI 1H)
    // ==========================================
    await processDedicatedWatchlistByTool();

    console.log("✅ [Worker] Hoàn thành toàn bộ chu kỳ quét.");
  } catch (err) {
    console.error("❌ [Worker Error] Lỗi trong chu kỳ chạy:", err);
  }
}

// --- CƠ CHẾ CHỐT LỜI TỰ ĐỘNG ĐỌC TỪ SETTINGS ---
async function monitorAndExecuteTakeProfit() {
  try {
    const settings = loadSettings();
    const sellStrategy = settings?.sellStrategy;

    if (!sellStrategy || !sellStrategy.enabled) return;

    const openPositions: Position[] = await getOpenPositionsFromStorage();
    if (openPositions.length === 0) return;

    console.log(`🎯 [Take-Profit] Đang kiểm tra chốt lời theo chế độ (${sellStrategy.mode}) cho ${openPositions.length} vị thế...`);

    for (const pos of openPositions) {
      if (!pos.entryPriceSol || pos.entryPriceSol <= 0) continue;

      const currentPriceSol = await fetchCurrentTokenPriceSol(pos.mint);
      if (currentPriceSol === null) continue;

      const multiplier = currentPriceSol / pos.entryPriceSol;
      const pnlPct = (multiplier - 1) * 100;

      // 1. Chế độ bậc thang (Ladder)
      if (sellStrategy.mode === "ladder" && sellStrategy.tiers) {
        for (const tier of sellStrategy.tiers) {
          const tierKey = `tier_${tier.id}_sold` as const;
          if (multiplier >= tier.multiplier && !pos[tierKey]) {
            console.log(`🎉 [Ladder TP] Vị thế ${pos.symbol} đạt x${tier.multiplier} (+${pnlPct.toFixed(1)}%). Bán ${tier.sellPercent}%!`);
            
            await executeSellOrder({
              mint: pos.mint,
              pct: tier.sellPercent,
              reason: `Ladder TP x${tier.multiplier}`
            });
            await markTierAsSoldInStorage(pos.id, tier.id);
          }
        }
      }
      // 2. Chế độ một mục tiêu (Single Target)
      else if (sellStrategy.mode === "single" && sellStrategy.singleTargetMultiplier) {
        if (multiplier >= sellStrategy.singleTargetMultiplier && (!pos.soldPct || pos.soldPct < 100)) {
          console.log(`🎉 [Single TP] Vị thế ${pos.symbol} đạt mục tiêu x${sellStrategy.singleTargetMultiplier}. Chốt toàn bộ!`);
          
          await executeSellOrder({
            mint: pos.mint,
            pct: 100 - (pos.soldPct || 0),
            reason: `Single Target x${sellStrategy.singleTargetMultiplier}`
          });
          await updatePositionSoldProgress(pos.id, 100);
        }
      }
    }
  } catch (err) {
    console.error("❌ [Take-Profit Error] Lỗi khi kiểm tra chốt lời:", err);
  }
}

// --- CƠ CHẾ CẮT LỖ TỰ ĐỘNG (ĐỌC TỪ SETTINGS) ---
async function monitorAndExecuteStopLoss() {
  try {
    const settings = loadSettings();
    const stopLossPct = settings?.sellStrategy?.stopLossPercent ?? 35; 
    if (stopLossPct <= 0) return;

    const openPositions: Position[] = await getOpenPositionsFromStorage();
    if (openPositions.length === 0) return;

    for (const pos of openPositions) {
      if (!pos.entryPriceSol || pos.entryPriceSol <= 0) continue;

      const currentPriceSol = await fetchCurrentTokenPriceSol(pos.mint);
      if (currentPriceSol === null) continue;

      const pnlPct = (currentPriceSol / pos.entryPriceSol - 1) * 100;

      if (pnlPct <= -stopLossPct) {
        console.log(`🚨 [Stop-Loss] Vị thế ${pos.symbol} lỗ ${pnlPct.toFixed(1)}%. Xả khẩn cấp theo cấu hình -${stopLossPct}%!`);
        
        await executeEmergencySellOrder({
          mint: pos.mint,
          pct: 100,
          reason: `Settings Stop-Loss (-${stopLossPct}%)`
        });

        await closePositionInStorage(pos.id, "stop-loss");
      }
    }
  } catch (err) {
    console.error("❌ [Stop-Loss Error] Lỗi khi kiểm tra cắt lỗ:", err);
  }
}

// --- QUẢN LÝ WATCHLIST RIÊNG BẰNG TOOL ĐỊNH LƯỢNG (MỖI 1H) ---
async function processDedicatedWatchlistByTool() {
  const watchlistItems = await getDedicatedWatchlistItems();
  for (const item of watchlistItems) {
    const hoursSinceLastCheck = (Date.now() - new Date(item.lastCheckedAt).getTime()) / (1000 * 60 * 60);
    if (hoursSinceLastCheck < 1) continue;

    const freshData = await fetchFreshGemData(item.mint);
    if (!freshData || freshData.isRugged) {
      await removeFromDedicatedWatchlist(item.mint);
      continue;
    }

    const safetyCheck = await verifyTokenSafety(item.mint);
    if (!safetyCheck.isSafe) {
      await removeFromDedicatedWatchlist(item.mint);
      continue;
    }

    const newToolScore = calculateDeterministicGemScore(freshData);

    if (newToolScore < item.currentToolScore || newToolScore < WATCH_SCORE_FLOOR) {
      await removeFromDedicatedWatchlist(item.mint);
    } else if (newToolScore > item.currentToolScore) {
      const reEvaluatedAi = await callAIAgentChecking(freshData);

      if (reEvaluatedAi.score >= MIN_AI_BUY_THRESHOLD) {
        console.log(`🚀 [Watchlist -> Buy] Token ${item.symbol} đạt điểm mua sau khi AI chấm lại!`);
        await executeBuyOrder(freshData, reEvaluatedAi);
        await removeFromDedicatedWatchlist(item.mint);
      } else {
        await updateDedicatedWatchlistStats(item.mint, {
          lastAiScore: reEvaluatedAi.score,
          currentToolScore: newToolScore,
          peakToolScore: Math.max(item.peakToolScore, newToolScore),
          lastCheckedAt: new Date().toISOString(),
        });
      }
    } else {
      await updateDedicatedWatchlistStats(item.mint, {
        lastCheckedAt: new Date().toISOString(),
      });
    }
  }
}

// --- HÀM TÍNH GEMSCORE ĐỊNH LƯỢNG ---
function calculateDeterministicGemScore(gem: any): number {
  let score = 50;
  if (gem.liquiditySol > 20) score += 20;
  else if (gem.liquiditySol > 10) score += 10;
  if (gem.volume24h > 10000) score += 30;
  else if (gem.volume24h > 5000) score += 15;
  return Math.min(score, 100);
}

// --- MOCK SERVICES (LIÊN KẾT DB/API THỰC TẾ) ---
async function fetchLiveFeedTokens(): Promise<GemRawItem[]> { return []; }
async function callAIAgentChecking(gem: any) { return { score: 70, riskScore: 2, reason: "Passed" }; }
async function executeBuyOrder(gem: any, aiResult: any) {}
async function executeSellOrder(params: any) {}
async function updatePositionSoldProgress(positionId: string, soldPct: number) {}
async function markTierAsSoldInStorage(positionId: string, tierId: string) {}

async function getDedicatedWatchlistItems(): Promise<any[]> { return []; }
async function upsertDedicatedWatchlist(item: any) {}
async function removeFromDedicatedWatchlist(mint: string) {}
async function updateDedicatedWatchlistStats(mint: string, stats: any) {}

async function fetchFreshGemData(mint: string) { return { mint, symbol: "GEM", liquiditySol: 15, volume24h: 8000, isRugged: false }; }
async function getOpenPositionsFromStorage(): Promise<Position[]> { return []; }
async function fetchCurrentTokenPriceSol(mint: string): Promise<number | null> { return 0.001; }
async function executeEmergencySellOrder(params: any) {}
async function closePositionInStorage(id: string, reason: string) {}