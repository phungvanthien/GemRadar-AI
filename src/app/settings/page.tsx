import { SettingsPanel } from "@/components/dashboard/settings-panel";
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Cài đặt | AlphaHunter AI",
  description: "Cấu hình volume mua Gems, tài khoản Telegram & X cho GemScore social",
};

export default function SettingsPage() {
  return (
    <div className="flex min-h-screen flex-col bg-[#07070a]">
      <div className="pointer-events-none fixed inset-0 bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-amber-900/10 via-transparent to-transparent" />
      <SettingsPanel />
    </div>
  );
}
