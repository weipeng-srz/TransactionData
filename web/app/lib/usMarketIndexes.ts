const usTimezone = "America/New_York";

export type USMarketPhase = "盘前" | "盘中" | "盘后" | "夜盘" | "周末休市";

export type USIndexDefinition = {
  id: string;
  code: string;
  name: string;
  cashSymbol: string;
  extendedSymbol: string;
  extendedCode: string;
  futureSymbol: string;
  futureCode: string;
  futureName: string;
  map?: { x: number; y: number; anchor: "top" | "right" | "bottom" | "left" };
};

export type USIndexSessionQuote = {
  id: string;
  code: string;
  name: string;
  city: "纽约";
  country: "美国";
  phase: USMarketPhase;
  phaseValue: number | null;
  phaseChangePct: number | null;
  phaseUpdatedAt: string;
  phaseInstrument: string;
  phaseIsProxy: boolean;
  closePrice: number | null;
  closeLabel: "上一交易日收盘" | "最近现货收盘";
  cashPrice: number | null;
  cashChangePct: number | null;
  cashUpdatedAt: string;
  map?: USIndexDefinition["map"];
};

export const US_INDEXES: USIndexDefinition[] = [
  { id: "dow", code: "DJI", name: "道琼斯工业指数", cashSymbol: "gb_$dji", extendedSymbol: "gb_dia", extendedCode: "DIA", futureSymbol: "hf_YM", futureCode: "YM", futureName: "道指期货", map: { x: 31.1, y: 24.8, anchor: "bottom" } },
  { id: "sp500", code: "SPX", name: "标普 500", cashSymbol: "gb_inx", extendedSymbol: "gb_spy", extendedCode: "SPY", futureSymbol: "hf_ES", futureCode: "ES", futureName: "标普 500 期货" },
  { id: "nasdaq", code: "IXIC", name: "纳斯达克综合指数", cashSymbol: "gb_ixic", extendedSymbol: "gb_oneq", extendedCode: "ONEQ", futureSymbol: "hf_NQ", futureCode: "NQ", futureName: "纳指期货" },
  { id: "nasdaq100", code: "NDX", name: "纳斯达克 100", cashSymbol: "gb_ndx", extendedSymbol: "gb_qqq", extendedCode: "QQQ", futureSymbol: "hf_NQ", futureCode: "NQ", futureName: "纳指期货" },
  { id: "sox", code: "SOX", name: "费城半导体指数", cashSymbol: "gb_sox", extendedSymbol: "gb_soxx", extendedCode: "SOXX", futureSymbol: "hf_NQ", futureCode: "NQ", futureName: "纳指期货（相关代理）" },
];

export const US_QUOTE_SYMBOLS = [...new Set(US_INDEXES.flatMap((item) => [item.cashSymbol, item.extendedSymbol, item.futureSymbol]))];

export function parseUSMarketResponse(body: string, now = new Date()): USIndexSessionQuote[] {
  const payloads = parsePayloads(body);
  const phase = resolveUSMarketPhase(now);

  return US_INDEXES.flatMap((definition) => {
    const cash = parseCashQuote(payloads.get(definition.cashSymbol));
    if (!cash) return [];
    const extended = parseExtendedQuote(payloads.get(definition.extendedSymbol), now);
    const future = parseFutureQuote(payloads.get(definition.futureSymbol));
    const closePrice = phase === "盘中" ? cash.previousClose : cash.price;
    const closeLabel = phase === "盘中" ? "上一交易日收盘" : "最近现货收盘";

    let phaseValue: number | null = cash.price;
    let phaseChangePct: number | null = cash.changePct;
    let phaseUpdatedAt = cash.updatedAt;
    let phaseInstrument = `${definition.code} 现货指数`;
    let phaseIsProxy = false;

    if (phase === "盘前" || phase === "盘后") {
      if (extended) {
        phaseValue = extended.price;
        phaseChangePct = extended.changePct;
        phaseUpdatedAt = extended.updatedAt;
        phaseInstrument = `${definition.extendedCode} ETF 延长时段代理`;
        phaseIsProxy = true;
      } else {
        phaseInstrument = `${definition.code} 最近现货收盘 · 等待${phase}报价`;
      }
    } else if (phase === "夜盘") {
      if (future) {
        phaseValue = future.price;
        phaseChangePct = future.changePct;
        phaseUpdatedAt = future.updatedAt;
        phaseInstrument = `${definition.futureCode} ${definition.futureName} · 夜盘代理`;
        phaseIsProxy = true;
      } else {
        phaseInstrument = `${definition.code} 最近现货收盘 · 等待夜盘报价`;
      }
    } else if (phase === "周末休市") {
      phaseInstrument = `${definition.code} 最近现货收盘`;
    }

    return [{
      id: definition.id,
      code: definition.code,
      name: definition.name,
      city: "纽约",
      country: "美国",
      phase,
      phaseValue,
      phaseChangePct,
      phaseUpdatedAt,
      phaseInstrument,
      phaseIsProxy,
      closePrice,
      closeLabel,
      cashPrice: cash.price,
      cashChangePct: cash.changePct,
      cashUpdatedAt: cash.updatedAt,
      map: definition.map,
    }];
  });
}

export function resolveUSMarketPhase(now: Date): USMarketPhase {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: usTimezone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(now);
  const weekday = parts.find((item) => item.type === "weekday")?.value ?? "";
  const hour = parts.find((item) => item.type === "hour")?.value ?? "00";
  const minute = parts.find((item) => item.type === "minute")?.value ?? "00";
  const clock = `${hour}:${minute}`;

  if (weekday === "Sat" || (weekday === "Sun" && clock < "18:00") || (weekday === "Fri" && clock >= "20:00")) return "周末休市";
  if (weekday === "Sun" || clock < "04:00" || clock >= "20:00") return "夜盘";
  if (clock < "09:30") return "盘前";
  if (clock < "16:00") return "盘中";
  return "盘后";
}

function parsePayloads(body: string): Map<string, string> {
  const payloads = new Map<string, string>();
  const pattern = /var hq_str_([^=]+)="([\s\S]*?)";/g;
  for (const match of body.matchAll(pattern)) payloads.set(match[1], match[2]);
  return payloads;
}

function parseCashQuote(payload: string | undefined) {
  if (!payload) return null;
  const fields = payload.split(",").map((item) => item.trim());
  const price = finiteNumber(fields[1]);
  const changePct = finiteNumber(fields[2]);
  const previousClose = finiteNumber(fields[26]);
  if (price == null || price <= 0 || changePct == null) return null;
  return { price, changePct, previousClose: previousClose && previousClose > 0 ? previousClose : price, updatedAt: fields[25] || fields[3] || "" };
}

function parseExtendedQuote(payload: string | undefined, now: Date) {
  if (!payload) return null;
  const fields = payload.split(",").map((item) => item.trim());
  const price = finiteNumber(fields[21]);
  const changePct = finiteNumber(fields[22]);
  const updatedAt = fields[24] || "";
  if (price == null || price <= 0 || changePct == null || !isCurrentUSDate(updatedAt, now)) return null;
  return { price, changePct, updatedAt };
}

function parseFutureQuote(payload: string | undefined) {
  if (!payload) return null;
  const fields = payload.split(",").map((item) => item.trim());
  const price = finiteNumber(fields[0]);
  const reference = finiteNumber(fields[7]);
  if (price == null || price <= 0) return null;
  const changePct = reference && reference > 0 ? ((price - reference) / reference) * 100 : null;
  return { price, changePct, updatedAt: [fields[12], fields[6]].filter(Boolean).join(" ") };
}

function isCurrentUSDate(value: string, now: Date): boolean {
  const match = value.match(/^([A-Z][a-z]{2})\s+(\d{1,2})\b/);
  if (!match) return false;
  const local = new Intl.DateTimeFormat("en-US", { timeZone: usTimezone, month: "short", day: "numeric" }).formatToParts(now);
  const month = local.find((item) => item.type === "month")?.value;
  const day = local.find((item) => item.type === "day")?.value;
  return match[1] === month && Number(match[2]) === Number(day);
}

function finiteNumber(value: unknown): number | null {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
