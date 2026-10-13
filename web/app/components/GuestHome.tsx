"use client";

import Link from "next/link";
import SiteBanner from "./SiteBanner";
import { useAppearance } from "./AppearanceProvider";
import styles from "./GuestHome.module.css";

export default function GuestHome({ onOpenStock }: { onOpenStock: (code: string) => void }) {
  const { appearance, toggleAppearance } = useAppearance();
  return <div>
    <SiteBanner activePage="portfolio" appearance={appearance} onToggleAppearance={toggleAppearance} onOpenStock={onOpenStock} statusText="访客 · 股票查询" />
    <main className={styles.main}>
      <section className={styles.hero}>
        <span className={styles.eyebrow}>TRENDSIGHT · 市场研究工作台</span>
        <h1>从一只股票开始，<br />看清每一步研究。</h1>
        <p>在顶部输入股票名称或代码，查询 A 股与美股的行情、财务和新闻。</p>
        <div className={styles.examples} aria-label="股票查询示例">
          <button onClick={() => onOpenStock("600519")}>贵州茅台 <span>600519 ↗</span></button>
          <button onClick={() => onOpenStock("US:AAPL")}>苹果 <span>AAPL ↗</span></button>
          <button onClick={() => onOpenStock("US:NVDA")}>英伟达 <span>NVDA ↗</span></button>
        </div>
      </section>
      <section className={styles.account}>
        <div><span className={styles.eyebrow}>你的个人研究空间</span><h2>把观察，积累成自己的记录。</h2><p>登录后使用自选持仓、选股、全球市场和交易复盘。个人数据保存在数据库中，随账号同步。</p></div>
        <div className={styles.actions}><Link href="/register">创建账号</Link><Link href="/login">已有账号，去登录 →</Link></div>
      </section>
    </main>
  </div>;
}
