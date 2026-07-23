import type { Metadata } from "next";
import { headers } from "next/headers";
import ThemeIconSync from "./components/ThemeIconSync";
import "./globals.css";
import "./apple.css";

const title = "TrendSight · 市场研究工作台";
const description = "以清晰、克制的工作区同时查看行情、风险、因子、回测、财报、估值与市场新闻。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/trendsight-social.png`;
  return {
    applicationName: "TrendSight",
    title,
    description,
    manifest: "/manifest.webmanifest",
    icons: {
      icon: [
        { url: "/favicon.png", sizes: "64x64", type: "image/png" },
        { url: "/trendsight-icon-192.png", sizes: "192x192", type: "image/png" },
      ],
      apple: [{ url: "/apple-touch-icon.png", sizes: "180x180", type: "image/png" }],
    },
    openGraph: {
      title,
      description,
      siteName: "TrendSight",
      images: [{ url: image, width: 1200, height: 630, alt: "TrendSight 个股与全球市场研究工作台" }],
    },
    twitter: {
      card: "summary_large_image",
      title,
      description,
      images: [image],
    },
  };
}

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="zh-CN" data-appearance="light">
      <body><ThemeIconSync />{children}</body>
    </html>
  );
}
