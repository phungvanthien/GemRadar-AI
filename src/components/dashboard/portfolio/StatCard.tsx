"use client";

import { ReactNode } from "react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { cn } from "@/lib/utils";

interface StatCardProps {
  icon: ReactNode;
  label: string;
  value: string;
  sub?: string | null;
  valueClass?: string;
}

export function StatCard({ icon, label, value, sub, valueClass }: StatCardProps) {
  return (
    <Card className="border-zinc-800 bg-zinc-900/50">
      <CardHeader className="flex flex-row items-center justify-between space-y-0 pb-2">
        <CardTitle className="text-sm font-medium text-zinc-400">{label}</CardTitle>
        <div className="text-zinc-500">{icon}</div>
      </CardHeader>
      <CardContent>
        <div className={cn("text-2xl font-bold", valueClass)}>{value}</div>
        {sub && <p className="text-xs text-zinc-500">{sub}</p>}
      </CardContent>
    </Card>
  );
}
