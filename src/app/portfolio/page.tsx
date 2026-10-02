import { Header } from "@/components/dashboard/header";
import { PortfolioPanel } from "@/components/dashboard/portfolio-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Danh mục | AlphaHunter AI",
  description:
    "Thống kê lợi nhuận mua bán Gems, lịch sử giao dịch và theo dõi ví theo SOL",
};

export default function PortfolioPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#07070a]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/10 via-transparent to-transparent" />
      <Header />
      <PortfolioPanel />
    </div>
  );
}
