import { readFileSync, readdirSync, statSync } from "node:fs";
import { extname, join, resolve } from "node:path";
import type { RequestHandler, Response } from "express";

const CONTENT_TYPES: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

export interface ClientAssets {
  /** Express middleware that serves the built client bundle and its HTML routes. */
  serve: RequestHandler;
}

/**
 * Serves the Vite production build from the existing API/WebSocket server, so
 * hotspot players can open `http://<host-ip>:<port>/` without a second process
 * or any external site. Only files inside the bundle directory are reachable,
 * and `/api` plus `/ws` are never answered with the HTML page.
 */
export function createClientAssets(directory: string): ClientAssets {
  const root = resolve(directory);
  const htmlRoutes = collectHtmlRoutes(root);

  const serve: RequestHandler = (req, res, next) => {
    if (req.method !== "GET" && req.method !== "HEAD") {
      res.setHeader("Allow", "GET, HEAD");
      res.sendStatus(405);
      return;
    }
    if (
      req.path === "/ws" ||
      req.path === "/api" ||
      req.path.startsWith("/api/")
    ) {
      next();
      return;
    }
    const relative = safeRelativePath(req.path);
    if (relative === null) {
      next();
      return;
    }
    if (relative !== "") {
      const file = safeFile(root, relative);
      if (file === null) {
        next();
        return;
      }
      if (file !== undefined) {
        sendFile(res, file, relative);
        return;
      }
      const page = htmlRoutes.get(`/${relative}`);
      if (page !== undefined) {
        sendFile(res, readFileSync(join(root, page)), page);
        return;
      }
      if (looksLikeAsset(req.path)) {
        res.status(404).type("text/plain; charset=utf-8").send("Not found");
        return;
      }
    }
    res.setHeader("Cache-Control", "no-cache");
    res
      .status(200)
      .type(CONTENT_TYPES[".html"]!)
      .send(readFileSync(join(root, "index.html")));
  };

  return { serve };
}

function sendFile(res: Response, body: Buffer, pathname: string): void {
  res.setHeader(
    "Cache-Control",
    pathname.startsWith("assets/") || pathname.includes("/assets/")
      ? "public, max-age=31536000, immutable"
      : "no-cache",
  );
  res.type(
    CONTENT_TYPES[extname(pathname).toLowerCase()] ??
      "application/octet-stream",
  );
  res.setHeader("Content-Length", String(body.byteLength));
  res.status(200).end(body);
}

function looksLikeAsset(pathname: string): boolean {
  return pathname.startsWith("/assets/") || extname(pathname) !== "";
}

/** Decoded, traversal-free path relative to the bundle root, or null if unsafe. */
function safeRelativePath(pathname: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    return null;
  }
  if (decoded.includes("\0") || decoded.includes("\\")) return null;
  const segments = decoded.split("/").filter(Boolean);
  if (segments.some((segment) => segment === "." || segment === ".."))
    return null;
  return segments.join("/");
}

/** File bytes, `undefined` when absent, or null when the path escapes the root. */
function safeFile(root: string, relative: string): Buffer | undefined | null {
  const target = resolve(root, relative);
  if (
    target !== root &&
    !target.startsWith(`${root}\\`) &&
    !target.startsWith(`${root}/`)
  )
    return null;
  try {
    if (!statSync(target).isFile()) return undefined;
    return readFileSync(target);
  } catch {
    return undefined;
  }
}

function collectHtmlRoutes(root: string): Map<string, string> {
  const routes = new Map<string, string>([["/", "index.html"]]);
  try {
    for (const entry of readdirSync(root)) {
      if (entry === "index.html" || extname(entry) !== ".html") continue;
      const route = `/${entry.slice(0, -".html".length)}`;
      routes.set(route, entry);
    }
  } catch {
    /* the bundle directory is validated when ClientAssets is created */
  }
  return routes;
}
