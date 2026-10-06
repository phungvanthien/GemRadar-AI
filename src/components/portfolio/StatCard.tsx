import React from "react";
import { Card, CardContent } from "@/components/ui/card";
import { cn } from "@/lib/utils";

export function StatCard({
  icon,
  label,
  value,
  sub,
  valueClass,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub?: string | null;
  valueClass?: string;
}) {
  return (
    <Card className="border-orange-500/10">
      <CardContent className="flex flex-col gap-1 p-4">
        <div className="flex items-center gap-2 text-xs text-zinc-500">
          {icon}
          {label}
        </div>
        <div className={cn("text-xl font-bold tabular-nums", valueClass)}>{value}</div>
        {sub && <div className="text-xs text-zinc-500 tabular-nums">{sub}</div>}
      </CardContent>
    </Card>
  );
}
