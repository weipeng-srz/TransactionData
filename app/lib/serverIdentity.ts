export async function resolveUserKey(request: Request): Promise<string | null> {
  const email = request.headers.get("oai-authenticated-user-email")?.trim().toLowerCase();
  if (email && email.length <= 320) return sha256(email);
  const hostname = new URL(request.url).hostname;
  if (hostname === "localhost" || hostname === "127.0.0.1") return "local-preview";
  return null;
}

async function sha256(value: string): Promise<string> {
  const bytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(bytes)].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}
