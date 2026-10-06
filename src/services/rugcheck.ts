// src/services/rugcheck.ts

interface RugCheckResult {
  isSafe: boolean;
  reason?: string;
}

export async function verifyTokenSafety(mint: string): Promise<RugCheckResult> {
  try {
    // Gọi RugCheck API chính thức (hoặc SolSniffer)
    const res = await fetch(`https://api.rugcheck.xyz/v1/tokens/${mint}/report`, {
      headers: { "accept": "application/json" }
    });

    if (!res.ok) {
      // Nếu không gọi được API, có thể cho qua hoặc chặn tùy mức độ cẩn trọng
      return { isSafe: true, reason: "Bỏ qua kiểm tra do không kết nối được RugCheck API" };
    }

    const data = await res.json();

    // 1. Kiểm tra điểm rủi ro tổng thể từ RugCheck (thường nếu risk quá cao hoặc hiểm họa thì loại)
    if (data.score > 5000 || data.riskLevel === "Danger") {
      return { isSafe: false, reason: `Rủi ro cao từ RugCheck (Score: ${data.score})` };
    }

    // 2. Kiểm tra Mint Authority (Quyền phát hành thêm token -> Scam in thêm vô hạn)
    if (data.mintAuthority !== null) {
      return { isSafe: false, reason: "Token còn giữ Mint Authority (Có thể bị in thêm)" };
    }

    // 3. Kiểm tra Freeze Authority (Quyền đóng băng ví giao dịch)
    if (data.freezeAuthority !== null) {
      return { isSafe: false, reason: "Token có Freeze Authority (Ví có thể bị khóa)" };
    }

    // 4. Kiểm tra tỷ lệ LP Token đã được khóa hoặc đốt chưa (Phải > 80%)
    const markets = data.markets || [];
    if (markets.length > 0) {
      const lpLockedPct = markets[0]?.lp?.lpLockedPct ?? 0;
      if (lpLockedPct < 80) {
        return { isSafe: false, reason: `Thanh khoản LP bị khóa quá ít (${lpLockedPct}%)` };
      }
    }

    return { isSafe: true };
  } catch (err) {
    console.error("Lỗi khi kiểm tra RugCheck:", err);
    // Tránh chặn nhầm toàn bộ nếu lỗi mạng, có thể trả về true hoặc false tùy chiến lược
    return { isSafe: true };
  }
}