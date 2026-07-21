import type { Metadata } from "next";
import { headers } from "next/headers";
import "./globals.css";
import "./apple.css";

const title = "TickLens · 市场研究工作台";
const description = "以清晰、克制的工作区同时查看行情、风险、因子、回测、财报、估值与市场新闻。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-apple.png`;
  return {
    title,
    description,
    icons: { icon: "/favicon.svg" },
    openGraph: {
      title,
      description,
      images: [{ url: image, width: 1200, height: 630, alt: "TickLens 市场研究工作台" }],
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
      <body>{children}</body>
    </html>
  );
}
