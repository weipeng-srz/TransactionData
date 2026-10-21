import type { CSSProperties } from "react";
import { projectRobinsonPoint } from "../../lib/robinsonProjection";
import { compactIndexName, signedPercent, tone } from "./format";

type MappedMarket = { id: string; city: string; name: string; longitude: number; latitude: number; changePct?: number };

const mapLabelOffsets: Record<string, { x: number; y: number }> = {
  tsx: { x: -116, y: -52 },
  dow: { x: 17, y: 13 },
  bovespa: { x: 18, y: -18 },
  ftse: { x: -126, y: -48 },
  dax: { x: 18, y: -52 },
  cac: { x: 20, y: 17 },
  sensex: { x: -150, y: 30 },
  shanghai: { x: 18, y: 19 },
  hsi: { x: 18, y: 41 },
  kospi: { x: -66, y: -58 },
  nikkei: { x: 17, y: -13 },
  sti: { x: -126, y: 15 },
  asx: { x: -124, y: 13 },
};
const mapTickerLabels: Record<string, string> = {
  tsx: "TSX", dow: "DOW", bovespa: "BVSP", ftse: "FTSE", dax: "DAX", cac: "CAC", sensex: "SENSEX",
  shanghai: "上证", hsi: "恒指", kospi: "KOSPI", nikkei: "日经", sti: "STI", asx: "ASX",
};

export default function MarketMap({ mappedMarkets }: { mappedMarkets: MappedMarket[] }) {
  return (
        <section id="global-map" className="global-map-card" aria-label="全球主要股指地图" tabIndex={-1}>
          <header>
            <div><p>MARKET REGIONS</p><h2>全球主要市场板块</h2></div>
            <div className="global-map-header-meta">
              <span className="global-map-count">{mappedMarkets.length} 个主要市场</span>
              <div className="global-legend"><span className="is-up">上涨</span><span className="is-down">下跌</span><span>平盘</span></div>
            </div>
          </header>
          <div className="global-map-stage">
            <div className="global-map-viewport">
              {/* The land silhouette and every market use the exact same Robinson viewBox. */}
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img className="global-map-land" src="/world-map-robinson.svg" alt="" aria-hidden="true" />
              {mappedMarkets.map((market) => <MarketMapMarker key={market.id} {...market} />)}
            </div>
            <div className="global-map-mobile-list" aria-label="全球主要市场行情列表">
              {mappedMarkets.map((market) => {
                const changeLabel = market.changePct == null ? "等待行情" : signedPercent(market.changePct);
                return (
                  <article key={market.id} className={tone(market.changePct)} aria-label={`${market.city}，${market.name}，${changeLabel}`}>
                    <span><small>{market.city}</small><strong>{compactIndexName(market.name)}</strong></span>
                    <b>{market.changePct == null ? "—" : changeLabel}</b>
                  </article>
                );
              })}
            </div>
          </div>
          <footer><span>按交易所所在位置展示 · 跨市场行情时点可能不同</span><span>红涨绿跌 · 行情每 10 秒刷新</span></footer>
        </section>
  );
}

function MarketMapMarker({ id, city, name, longitude, latitude, changePct }: { id: string; city: string; name: string; longitude: number; latitude: number; changePct?: number }) {
  const projected = projectRobinsonPoint(longitude, latitude);
  const offset = mapLabelOffsets[id] ?? { x: 14, y: -18 };
  const style = {
    left: `${projected.left.toFixed(3)}%`,
    top: `${projected.top.toFixed(3)}%`,
    "--marker-label-x": `${offset.x}px`,
    "--marker-label-y": `${offset.y}px`,
  } as CSSProperties;
  const changeLabel = changePct == null ? "等待行情" : signedPercent(changePct);

  return (
    <article className={`global-map-marker ${tone(changePct)}`} style={style} title={`${city} · ${name} · ${changeLabel}`} data-map-id={id} aria-label={`${city}，${name}，${changeLabel}`}>
      <div className="global-marker-label">
        <small>{city}</small>
        <span className="global-marker-desktop-value"><strong>{compactIndexName(name)}</strong><b>{changePct == null ? "—" : changeLabel}</b></span>
        <span className="global-marker-mobile-value"><strong>{mapTickerLabels[id] ?? compactIndexName(name)}</strong><b>{changePct == null ? "—" : changeLabel}</b></span>
      </div>
    </article>
  );
}

