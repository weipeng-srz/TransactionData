import { getAuthenticatedUser } from "./authServer.ts";

export async function resolveUserKey(request: Request): Promise<string | null> {
  return (await getAuthenticatedUser(request))?.id ?? null;
}
