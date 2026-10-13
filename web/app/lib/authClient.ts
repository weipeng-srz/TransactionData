export type AuthUser = {
  id: string;
  email: string;
  displayName: string;
  bio: string;
  createdAt: string;
  updatedAt: string;
};

/** Return paths must stay within this app, including after URL normalization. */
export function safeAuthReturnPath(value: string | null): string {
  if (!value || !value.startsWith("/") || value.startsWith("//") || /[\\\u0000-\u001f]/.test(value)) return "/";
  try {
    const url = new URL(value, "https://trendsight.invalid");
    const decodedPath = decodeURIComponent(url.pathname);
    if (url.origin !== "https://trendsight.invalid" || decodedPath.startsWith("//") || /[\\\u0000-\u001f]/.test(decodedPath) || /^\/(login|register)(\/|$)/.test(decodedPath)) return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export async function authRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "same-origin",
    cache: "no-store",
    headers: { "Content-Type": "application/json", ...init?.headers },
  });
  const data = await response.json().catch(() => null) as (T & { error?: string }) | null;
  if (!response.ok) {
    if (response.status === 401 && !/^\/api\/auth\/(login|register)$/.test(path)) {
      window.dispatchEvent(new Event("account-session-expired"));
    }
    throw new Error(data?.error || "暂时无法连接服务器，请稍后重试。");
  }
  if (!data) throw new Error("服务器返回了无效响应，请重试。");
  return data;
}

export function passwordValidationMessage(password: string): string | null {
  if (password.length < 8 || password.length > 128) return "密码需要 8–128 个字符。";
  if (!/[a-zA-Z]/.test(password) || !/\d/.test(password)) return "密码需要同时包含英文字母和数字。";
  return null;
}
