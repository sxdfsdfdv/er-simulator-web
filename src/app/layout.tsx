import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ER Simulator - 응급실 대기행렬 및 자원 배치 시뮬레이터",
  description: "Emergency Room Resource Allocation & Queueing Simulation System",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="ko" className="h-full antialiased">
      <body className="min-h-full flex flex-col font-sans bg-[#F8FAFC] text-[#0B1F3A]">
        {children}
      </body>
    </html>
  );
}
