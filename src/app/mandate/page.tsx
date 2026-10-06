import { Header } from "@/components/dashboard/header";
import { MandatePanel } from "@/components/dashboard/mandate-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Mandate | GemRadar AI",
  description:
    "Capital allocation for auto-trading gems with limits and portfolio risk management",
};

export default function MandatePage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#07070a]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/10 via-transparent to-transparent" />
      <Header />
      <MandatePanel />
    </div>
  );
}
