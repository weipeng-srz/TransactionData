import Link from "next/link";

export default function MarketScopeSwitch({
  scope,
  stockCode = "",
}: {
  scope: "stock" | "global";
  stockCode?: string;
}) {
  const stockHref = /^\d{6}$/.test(stockCode) ? `/?stock=${stockCode}` : "/";
  const globalHref = /^\d{6}$/.test(stockCode) ? `/global-markets?stock=${stockCode}` : "/global-markets";
  return (
    <nav className="market-scope-switch" aria-label="市场视角">
      <Link href={stockHref} className={scope === "stock" ? "is-active" : ""} aria-current={scope === "stock" ? "page" : undefined}>个股</Link>
      <Link href={globalHref} className={scope === "global" ? "is-active" : ""} aria-current={scope === "global" ? "page" : undefined}>全球</Link>
    </nav>
  );
}
