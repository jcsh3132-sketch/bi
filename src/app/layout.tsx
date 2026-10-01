import type { Metadata } from "next";
import "./globals.css";
export const metadata: Metadata = { title: "나의 트레이딩 · 비공개 대시보드", description: "개인용 자동매매 모니터링", robots: { index: false, follow: false, nocache: true } };
export default function Layout({ children }: { children: React.ReactNode }) {
  return <html lang="ko"><body>{children}</body></html>;
}
