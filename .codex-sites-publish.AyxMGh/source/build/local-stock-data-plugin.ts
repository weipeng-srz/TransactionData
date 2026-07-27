import { execFile } from "node:child_process";
import { access, mkdtemp, readFile, rm } from "node:fs/promises";
import { constants } from "node:fs";
import { tmpdir } from "node:os";
import { basename, resolve } from "node:path";
import { promisify } from "node:util";
import type { IncomingMessage, ServerResponse } from "node:http";
import type { Plugin } from "vite";
import { lookupStock, normalizeStockLookupRequest } from "../app/lib/stockLookup.ts";

export { normalizeStockLookupRequest, parseStockLookupResponse, pickStockLookupResult } from "../app/lib/stockLookup.ts";

const execFileAsync = promisify(execFile);
const marketEndpoint = "/api/local-stock-data";
const newsEndpoint = "/api/local-stock-news";
const lookupEndpoint = "/api/local-stock-lookup";
const maxBodyBytes = 4096;
const stockCodePattern = /^(?:(?:sh|sz)\d{6}|\d{6}(?:\.(?:sh|sz))?)$/i;

export function localStockData(): Plugin {
  let root = process.cwd();

  return {
    name: "local-stock-data",
    apply: "serve",
    configResolved(config) {
      root = config.root;
    },
    configureServer(server) {
      server.middlewares.use(async (request, response, next) => {
        const pathname = request.url?.split("?", 1)[0];
        if (pathname !== marketEndpoint && pathname !== newsEndpoint && pathname !== lookupEndpoint) {
          next();
          return;
        }
        if (request.method !== "POST") {
          sendJson(response, 405, { error: "仅支持 POST 请求" });
          return;
        }

        if (pathname === lookupEndpoint) {
          try {
            const { query } = normalizeStockLookupRequest(await readJsonBody(request));
            sendJson(response, 200, await lookupStock(query));
          } catch (reason) {
            sendJson(response, 400, {
              error: reason instanceof Error ? reason.message : "没有找到匹配的沪深股票",
            });
          }
          return;
        }

        let temporaryDirectory = "";
        const isNews = pathname === newsEndpoint;
        const binaryName = isNews
          ? process.platform === "win32" ? "stock-news.exe" : "stock-news"
          : process.platform === "win32" ? "stock-ticks.exe" : "stock-ticks";
        try {
          const input = await readJsonBody(request);
          const payload = isNews ? normalizeNewsRequest(input) : normalizeStockRequest(input);
          const binaryPath = resolve(root, "..", binaryName);
          await access(binaryPath, constants.X_OK);
          temporaryDirectory = await mkdtemp(resolve(tmpdir(), "ticklens-"));
          const outputPath = resolve(temporaryDirectory, isNews ? "news.csv" : "market.csv");

          if (isNews) {
            const news = payload as ReturnType<typeof normalizeNewsRequest>;
            await execFileAsync(binaryPath, [
              "-code", news.code,
              "-limit", String(news.limit),
              "-output", outputPath,
              "-timeout", "12s",
            ], {
              cwd: resolve(root, ".."),
              timeout: 2 * 60 * 1000,
              maxBuffer: 4 * 1024 * 1024,
            });
          } else {
            const market = payload as ReturnType<typeof normalizeStockRequest>;
            await execFileAsync(binaryPath, [
              "-code", market.code,
              "-days", String(market.days),
              "-output", outputPath,
              "-timeout", "10s",
            ], {
              cwd: resolve(root, ".."),
              timeout: 5 * 60 * 1000,
              maxBuffer: 2 * 1024 * 1024,
            });
          }

          const csv = await readFile(outputPath);
          response.statusCode = 200;
          response.setHeader("Content-Type", "text/csv; charset=utf-8");
          response.setHeader("Content-Disposition", `inline; filename="${basename(outputPath)}"`);
          response.setHeader("Cache-Control", "no-store");
          response.end(csv);
        } catch (reason) {
          const error = reason as NodeJS.ErrnoException & { stderr?: string };
          const stderr = typeof error.stderr === "string" ? error.stderr.trim().split("\n").at(-1) : "";
          const buildCommand = isNews
            ? "CGO_ENABLED=0 go build -trimpath -o stock-news ./cmd/stock-news"
            : "CGO_ENABLED=0 go build -trimpath -o stock-ticks .";
          const message = error.code === "EACCES" || error.code === "ENOENT"
            ? `没有找到可执行的 ${binaryName}，请先在项目根目录运行 ${buildCommand}`
            : stderr?.replace(/^错误：/, "") || error.message || (isNews ? "获取新闻数据失败" : "获取行情数据失败");
          sendJson(response, 400, { error: message });
        } finally {
          if (temporaryDirectory) await rm(temporaryDirectory, { recursive: true, force: true });
        }
      });
    },
  };
}

export function normalizeStockRequest(value: unknown): { code: string; days: number } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; days?: unknown };
  const code = normalizeCode(input.code);
  const days = input.days == null ? 90 : Number(input.days);
  if (!Number.isInteger(days) || days < 1 || days > 250) throw new Error("交易日数量必须在1到250之间");
  return { code, days };
}

export function normalizeNewsRequest(value: unknown): { code: string; limit: number } {
  if (!value || typeof value !== "object") throw new Error("请求内容无效");
  const input = value as { code?: unknown; limit?: unknown };
  const code = normalizeCode(input.code);
  const limit = input.limit == null ? 30 : Number(input.limit);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) throw new Error("每个新闻入口的数量必须在1到100之间");
  return { code, limit };
}

function normalizeCode(value: unknown): string {
  const code = String(value ?? "").trim();
  if (!stockCodePattern.test(code)) {
    throw new Error("请输入6位沪深股票代码，例如 002747、sh600000 或 000001.SZ");
  }
  return code;
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  let size = 0;
  const chunks: Buffer[] = [];
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > maxBodyBytes) throw new Error("请求内容过大");
    chunks.push(buffer);
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new Error("请求内容不是有效的 JSON");
  }
}

function sendJson(response: ServerResponse, status: number, payload: unknown) {
  response.statusCode = status;
  response.setHeader("Content-Type", "application/json; charset=utf-8");
  response.setHeader("Cache-Control", "no-store");
  response.end(JSON.stringify(payload));
}
