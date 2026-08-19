export const stockNotFoundMessage = "没有找到匹配的 A 股或美股，请检查名称或代码";
export const stockLookupUnavailableMessage = "股票查询服务暂不可用，请稍后重试";

export function publicStockLookupError(reasons: unknown[]): Error {
  const messages = reasons.map((reason) => reason instanceof Error ? reason.message : String(reason ?? ""));
  const unavailable = messages.some((message) => /暂不可用|超时|网络|network|failed to fetch|http\s*5\d\d|服务请求失败/i.test(message));
  return new Error(unavailable ? stockLookupUnavailableMessage : stockNotFoundMessage);
}
