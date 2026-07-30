import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "大内总管",
  description: "本地运行的个人 Agent",
  manifest: "/manifest.webmanifest",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>): React.ReactElement {
  return (
    <html lang="zh-CN">
      <body>{children}</body>
    </html>
  );
}
