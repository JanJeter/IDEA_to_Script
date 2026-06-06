import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "AI 小说转剧本工具",
  description: "将多章节小说转换为结构化、可校验、可二次编辑的 YAML 剧本初稿",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
