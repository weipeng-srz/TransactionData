import type { Metadata } from "next";
import { headers } from "next/headers";

const title = "全球股指脉动 · TickLens";
const description = "在世界地图上实时查看美洲、欧洲与亚太主要股指，每 10 秒自动刷新。";

export async function generateMetadata(): Promise<Metadata> {
  const requestHeaders = await headers();
  const host = requestHeaders.get("x-forwarded-host") ?? requestHeaders.get("host") ?? "localhost";
  const protocol = requestHeaders.get("x-forwarded-proto") ?? (host.startsWith("localhost") ? "http" : "https");
  const image = `${protocol}://${host}/og-global.png`;
  return {
    title,
    description,
    openGraph: { title, description, images: [{ url: image, width: 1730, height: 909, alt: "TickLens 全球股指脉动" }] },
    twitter: { card: "summary_large_image", title, description, images: [image] },
  };
}

export default function GlobalMarketsLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return children;
}
