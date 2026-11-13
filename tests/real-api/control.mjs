/**
 * Control de pruebas para el backend REAL (food-order-api), con la misma interfaz que el fake
 * (tests/fake-api/server.ts) para que los e2e de Playwright corran SIN cambios contra el real:
 *
 *   E2E_BACKEND=real npx playwright test        (ver playwright.config.ts)
 *   E2E_BACKEND=real node tests/e2e/upgrade.mjs
 *
 * Es un proxy HTTP delgado delante del backend real. Reenvía TODO tal cual, salvo los endpoints de
 * control (que el backend real no tiene, por diseño):
 *   POST /__reset                     -> backend nuevo (carpeta de datos nueva) con el catálogo TEST_SEED
 *                                        cargado por POST /v1/import/catalog
 *   POST /__down {"down":true|false}  -> responde 503 a todo salvo /__*
 *   POST /__expire                    -> los access tokens emitidos hasta ahora pasan a dar 401 (el refresh
 *                                        es el del backend real)
 *   GET  /__orders                    -> todos los pedidos (incluidos borrados) leídos con GET /v1/orders
 *   GET  /__catalog                   -> {products, categories} incluidos borrados
 *   POST /__code                      -> 501 (el login con Microsoft no se puede simular contra el real)
 *
 * Variables: CONTROL_PORT (4174), BACKEND_PORT (CONTROL_PORT+1000), FOOD_ORDER_API_DIR (../food-order-api),
 * E2E_DATA_ROOT (carpeta temporal), FRONTEND_ORIGINS (por defecto los de los e2e y upgrade).
 */
import { spawn } from "node:child_process";
import { createServer, request as httpRequest } from "node:http";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { TEST_SEED } from "../fake-api/fake-api.ts";

const ROOT = path.resolve(import.meta.dirname, "../..");
const CONTROL_PORT = Number(process.env.CONTROL_PORT ?? process.env.FAKE_API_PORT ?? 4174);
const BACKEND_PORT = Number(process.env.BACKEND_PORT ?? CONTROL_PORT + 1000);
const API_DIR = path.resolve(ROOT, process.env.FOOD_ORDER_API_DIR ?? "../food-order-api");
const DATA_ROOT = process.env.E2E_DATA_ROOT ?? mkdtempSync(path.join(tmpdir(), "real-api-"));
mkdirSync(DATA_ROOT, { recursive: true });
const ORIGINS =
  process.env.FRONTEND_ORIGINS ?? "http://localhost:4173,http://localhost:4180,http://localhost:5173";
const EMAIL = "dev@example.com";
const BACKEND = `http://127.0.0.1:${BACKEND_PORT}`;

let child = null;
let dataDir = null;
let seq = 0;
let down = false;
const issued = new Set(); // access tokens emitidos (para /__expire)
const expired = new Set();
let adminToken = null;

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function stopBackend() {
  if (!child) return;
  const c = child;
  child = null;
  await new Promise((resolve) => {
    c.once("exit", resolve);
    c.kill("SIGTERM");
    setTimeout(() => c.kill("SIGKILL"), 3000).unref();
  });
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
}

async function startBackend() {
  await stopBackend();
  dataDir = path.join(DATA_ROOT, `data-${process.pid}-${++seq}`);
  mkdirSync(dataDir, { recursive: true });
  child = spawn("node", ["dist/server.js"], {
    cwd: API_DIR,
    stdio: ["ignore", "ignore", "inherit"],
    env: {
      ...process.env,
      NODE_ENV: "development",
      PORT: String(BACKEND_PORT),
      DATA_DIR: dataDir,
      AUTH_DEV_BYPASS: "1",
      ALLOWED_EMAILS: EMAIL,
      FRONTEND_ORIGINS: ORIGINS,
      // las imágenes subidas se piden a través de este proxy (mismo puerto que el "fake")
      PUBLIC_BASE_URL: `http://localhost:${CONTROL_PORT}`,
      AUTH_RATE_LIMIT_MAX: "100000",
      LOG_LEVEL: "error",
    },
  });
  child.on("exit", (code) => {
    if (child) console.error(`[real-api] el backend terminó inesperadamente (código ${code})`);
  });
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BACKEND}/health`)).ok) return;
    } catch {}
    await sleep(100);
  }
  throw new Error("el backend real no arrancó (¿falta `npm run build` en food-order-api?)");
}

async function backendJson(method, url, body, token) {
  const res = await fetch(BACKEND + url, {
    method,
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  if (!res.ok) throw new Error(`${method} ${url} -> ${res.status} ${await res.text()}`);
  return res.status === 204 ? undefined : res.json();
}

async function admin(method, url, body) {
  if (!adminToken) adminToken = (await backendJson("POST", "/v1/auth/dev-login", {})).accessToken;
  try {
    return await backendJson(method, url, body, adminToken);
  } catch (e) {
    if (!String(e.message).includes("-> 401")) throw e;
    adminToken = (await backendJson("POST", "/v1/auth/dev-login", {})).accessToken;
    return backendJson(method, url, body, adminToken);
  }
}

async function reset() {
  down = false;
  expired.clear();
  issued.clear();
  adminToken = null;
  await startBackend();
  const r = await admin("POST", "/v1/import/catalog", {
    categories: TEST_SEED.categories,
    products: TEST_SEED.products,
  });
  if (r.errors?.length) throw new Error("catálogo de prueba rechazado: " + JSON.stringify(r.errors));
}

async function allOrders() {
  const all = [];
  let cursor;
  do {
    const qs = new URLSearchParams({ from: "2000-01-01", to: "2999-12-31", includeDeleted: "true", limit: "1000" });
    if (cursor) qs.set("cursor", cursor);
    const page = await admin("GET", `/v1/orders?${qs}`);
    all.push(...page.items);
    cursor = page.nextCursor ?? undefined;
  } while (cursor);
  // el fake los devuelve por orden de creación; el real, del más reciente al más antiguo
  return all.reverse();
}

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Authorization, Content-Type, If-Match",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const readBody = (req) =>
  new Promise((res) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks)));
  });

function proxy(req, res, body) {
  const headers = { ...req.headers, host: `127.0.0.1:${BACKEND_PORT}` };
  const out = httpRequest(
    { host: "127.0.0.1", port: BACKEND_PORT, path: req.url, method: req.method, headers },
    (back) => {
      const isLogin = /^\/v1\/auth\/(dev-login|refresh|exchange)\b/.test(req.url ?? "");
      if (!isLogin) {
        res.writeHead(back.statusCode ?? 502, back.headers);
        back.pipe(res);
        return;
      }
      const chunks = [];
      back.on("data", (c) => chunks.push(c));
      back.on("end", () => {
        const buf = Buffer.concat(chunks);
        try {
          const t = JSON.parse(buf.toString("utf8")).accessToken;
          if (t) issued.add(t);
        } catch {}
        res.writeHead(back.statusCode ?? 502, back.headers);
        res.end(buf);
      });
    },
  );
  out.on("error", () => {
    res.writeHead(502, { ...CORS, "content-type": "application/json" });
    res.end(JSON.stringify({ code: "internal_error", message: "backend real no disponible" }));
  });
  out.end(body);
}

createServer(async (req, res) => {
  const send = (status, body) => {
    res.writeHead(status, { ...CORS, "content-type": "application/json" });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  try {
    const url = req.url ?? "/";
    if (url.startsWith("/__")) {
      const raw = await readBody(req);
      const json = raw.length ? JSON.parse(raw.toString("utf8")) : undefined;
      if (url === "/__reset") {
        await reset();
        return send(200, { ok: true });
      }
      if (url === "/__down") {
        down = !!json?.down;
        return send(200, { down });
      }
      if (url === "/__expire") {
        for (const t of issued) expired.add(t);
        return send(200, { ok: true });
      }
      if (url === "/__orders") return send(200, await allOrders());
      if (url === "/__catalog") {
        const [products, categories] = await Promise.all([
          admin("GET", "/v1/products?includeDeleted=true"),
          admin("GET", "/v1/categories?includeDeleted=true"),
        ]);
        return send(200, { products, categories });
      }
      if (url === "/__code")
        return send(501, { code: "not_implemented", message: "no se puede simular Microsoft contra el backend real" });
      return send(404, { code: "not_found", message: "?" });
    }
    if (req.method === "OPTIONS") {
      // el preflight lo responde el backend real (CORS de FRONTEND_ORIGINS), no este proxy
      return proxy(req, res, Buffer.alloc(0));
    }
    if (down) return send(503, { code: "internal_error", message: "caído (test)" });
    const bearer = /^Bearer (.+)$/.exec(String(req.headers.authorization ?? ""))?.[1];
    if (bearer && expired.has(bearer)) {
      // CORS del backend real para que el navegador pueda leer el 401
      res.writeHead(401, {
        "access-control-allow-origin": req.headers.origin ?? "*",
        "content-type": "application/json",
      });
      return res.end(JSON.stringify({ code: "unauthorized", message: "Token caducado (test)" }));
    }
    const body = await readBody(req);
    proxy(req, res, body);
  } catch (e) {
    console.error(e);
    send(500, { code: "internal_error", message: String(e) });
  }
}).listen(CONTROL_PORT, async () => {
  await reset();
  console.log(`real-api (proxy de control) en http://localhost:${CONTROL_PORT} -> ${BACKEND}`);
});

const shutdown = async () => {
  await stopBackend();
  rmSync(DATA_ROOT, { recursive: true, force: true });
  process.exit(0);
};
process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);
