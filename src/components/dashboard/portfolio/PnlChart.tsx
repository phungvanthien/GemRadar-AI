"use client";

import { useMemo } from "react";
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import { cn } from "@/lib/utils";

interface SeriesPoint {
  time: string;
  cumulativePnlSol: number;
}

interface PnlChartProps {
  series: SeriesPoint[];
}

function formatSol(v: number): string {
  return `${v.toFixed(2)} SOL`;
}

export function PnlChart({ series }: PnlChartProps) {
  const formattedSeries = useMemo(() => {
    if (!series.length) return [];
    const start = series[0].cumulativePnlSol;
    return series.map((p) => ({
      ...p,
      value: p.cumulativePnlSol - start,
    }));
  }, [series]);

  if (series.length === 0) {
    return (
      <div className="flex h-48 items-center justify-center text-sm text-zinc-600">
        Chưa có dữ liệu giao dịch
      </div>
    );
  }

  const positive = formattedSeries.every((p) => p.value >= 0);
  const negative = formattedSeries.every((p) => p.value <= 0);

  const getColor = () => {
    if (positive) return "#10b981"; // emerald-500
    if (negative) return "#ef4444"; // red-500
    return "#f59e0b"; // amber-500
  };

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={formattedSeries} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#3f3f46" opacity={0.5} />
          <XAxis
            dataKey="time"
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            minTickGap={30}
          />
          <YAxis
            tick={{ fill: "#71717a", fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v > 0 ? "+" : ""}${v.toFixed(1)}`}
          />
          <Tooltip
            contentStyle={{
              backgroundColor: "#18181b",
              border: "1px solid #27272a",
              borderRadius: "4px",
              color: "#e4e4e7",
            }}
            itemStyle={{ color: getColor() }}
            formatter={(value) => [formatSol(value as number), "Tổng P&L"]}
            labelFormatter={(label) => `Thời gian: ${label}`}
          />
          <Line
            type="monotone"
            dataKey="value"
            stroke={getColor()}
            strokeWidth={2}
            dot={false}
            animationDuration={300}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
