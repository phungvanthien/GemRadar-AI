import { useMemo } from "react";
import { useLanguage } from "@/lib/i18n/context";

interface SeriesPoint {
  time: string;
  cumulativePnlSol: number;
}

export function PnlChart({ series }: { series: SeriesPoint[] }) {
  const { t } = useLanguage();
  const W = 720;
  const H = 220;
  const PAD = { top: 16, right: 16, bottom: 24, left: 48 };

  const geom = useMemo(() => {
    if (series.length === 0) return null;
    const pts = series.map((p, i) => ({ x: i, y: p.cumulativePnlSol }));
    const ys = [...pts.map((p) => p.y), 0];
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const spanY = maxY - minY || 1;
    const n = pts.length;

    const plotW = W - PAD.left - PAD.right;
    const plotH = H - PAD.top - PAD.bottom;

    const sx = (i: number) =>
      PAD.left + (n === 1 ? plotW / 2 : (i / (n - 1)) * plotW);
    const sy = (y: number) =>
      PAD.top + plotH - ((y - minY) / spanY) * plotH;

    const line = pts
      .map((p, i) => `${i === 0 ? "M" : "L"}${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`)
      .join(" ");
    const area =
      `M${sx(0).toFixed(1)},${sy(0).toFixed(1)} ` +
      pts.map((p, i) => `L${sx(i).toFixed(1)},${sy(p.y).toFixed(1)}`).join(" ") +
      ` L${sx(n - 1).toFixed(1)},${sy(0).toFixed(1)} Z`;

    const zeroY = sy(0);
    const last = pts[n - 1];
    return {
      line,
      area,
      zeroY,
      minY,
      maxY,
      lastX: sx(n - 1),
      lastY: sy(last.y),
      lastVal: last.y,
    };
  }, [series]);

  if (!geom) {
    return (
      <div className="flex h-[220px] items-center justify-center text-sm text-zinc-600">
        {t("portfolio.noSellOrders") || "Chưa có lệnh bán nào để vẽ biểu đồ"}
      </div>
    );
  }

  const positive = geom.lastVal >= 0;
  const stroke = positive ? "#34d399" : "#f87171";
  const fillId = positive ? "pnlFillPos" : "pnlFillNeg";

  return (
    <svg
      viewBox={`0 0 ${W} ${H}`}
      className="h-[220px] w-full"
      role="img"
      aria-label="Biểu đồ lợi nhuận ví theo SOL"
    >
      <defs>
        <linearGradient id="pnlFillPos" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#34d399" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
        </linearGradient>
        <linearGradient id="pnlFillNeg" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#f87171" stopOpacity="0.25" />
          <stop offset="100%" stopColor="#f87171" stopOpacity="0" />
        </linearGradient>
      </defs>

      <line
        x1={PAD.left}
        x2={W - PAD.right}
        y1={geom.zeroY}
        y2={geom.zeroY}
        stroke="#52525b"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <text x={PAD.left - 8} y={geom.zeroY + 3} textAnchor="end" className="fill-zinc-600 text-[10px]">
        0
      </text>
      <text x={PAD.left - 8} y={PAD.top + 6} textAnchor="end" className="fill-zinc-600 text-[10px]">
        {geom.maxY.toFixed(2)}
      </text>
      <text
        x={PAD.left - 8}
        y={H - PAD.bottom}
        textAnchor="end"
        className="fill-zinc-600 text-[10px]"
      >
        {geom.minY.toFixed(2)}
      </text>

      <path d={geom.area} fill={`url(#${fillId})`} />
      <path d={geom.line} fill="none" stroke={stroke} strokeWidth="2" strokeLinejoin="round" />
      <circle cx={geom.lastX} cy={geom.lastY} r="3.5" fill={stroke} />
    </svg>
  );
}
