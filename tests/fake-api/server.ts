/// <reference types="node" />
/**
 * Mini servidor HTTP del FAKE de la API, para los e2e de Playwright:
 *   node tests/fake-api/server.ts            (puerto FAKE_API_PORT, por defecto 4174)
 * Control desde los tests (sin autenticación):
 *   POST /__reset                     -> estado inicial (menú de prueba)
 *   POST /__down {"down":true|false}  -> responde 503 a todo salvo /__* y /media/* (las imágenes las sirve el bucket)
 *   POST /__expire                    -> caduca los access tokens
 *   POST /__code {"challenge"}        -> {code} (simula el callback de Microsoft)
 *   GET  /__orders                    -> pedidos del servidor
 * Además: POST /v1/uploads (multipart) -> 201 {url:"/media/<uuid>.webp", key} y GET /media/<clave> (público).
 */
import { createServer } from "node:http";
import { FakeApi, TEST_SEED } from "./fake-api.ts";

const PORT = Number(process.env.FAKE_API_PORT ?? 4174);
let api = new FakeApi(TEST_SEED);
let down = false;

const CORS = {
  "access-control-allow-origin": "*",
  "access-control-allow-headers": "Authorization, Content-Type, If-Match",
  "access-control-allow-methods": "GET, POST, PATCH, DELETE, OPTIONS",
};

const readBody = (req: any): Promise<Buffer> =>
  new Promise((res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => res(Buffer.concat(chunks)));
  });

createServer(async (req, res) => {
  const send = (status: number, body?: unknown, extra: Record<string, string> = {}) => {
    res.writeHead(status, { ...CORS, "content-type": "application/json", ...extra });
    res.end(body === undefined ? undefined : JSON.stringify(body));
  };
  try {
    if (req.method === "OPTIONS") return send(204);
    const url = req.url ?? "/";
    const raw = await readBody(req);
    const ctype = String(req.headers["content-type"] ?? "");
    let json = raw.length && ctype.includes("json") ? JSON.parse(raw.toString("utf8")) : undefined;
    if (ctype.startsWith("multipart/form-data"))
      json = { file: (await new Response(new Uint8Array(raw), { headers: { "content-type": ctype } }).formData()).get("file") };

    if (url.startsWith("/__")) {
      if (url === "/__reset") {
        api = new FakeApi(TEST_SEED);
        down = false;
        return send(200, { ok: true });
      }
      if (url === "/__down") {
        down = !!json?.down;
        return send(200, { down });
      }
      if (url === "/__expire") {
        api.expireAccessTokens();
        return send(200, { ok: true });
      }
      if (url === "/__code") return send(200, { code: api.issueLoginCode(json.challenge) });
      if (url === "/__orders") return send(200, api.orders);
      if (url === "/__catalog") return send(200, { products: api.products, categories: api.categories });
      if (url === "/__log") return send(200, api.log);
      return send(404, { code: "not_found", message: "?" });
    }
    // Las imágenes (/media) las sirve el bucket, no la API: siguen disponibles aunque la API esté "caída"
    if (down && !url.startsWith("/media/")) return send(503, { code: "internal_error", message: "caído (test)" });

    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(req.headers)) headers[k.toLowerCase()] = String(v);
    const r = await api.handle({ method: req.method ?? "GET", url, headers, body: json });
    if (r.raw) {
      res.writeHead(r.status, { ...CORS, "content-type": r.raw.type, "cache-control": "public, max-age=31536000, immutable" });
      return res.end(req.method === "HEAD" ? undefined : r.raw.bytes);
    }
    return send(r.status, r.body);
  } catch (e) {
    console.error(e);
    send(500, { code: "internal_error", message: String(e) });
  }
}).listen(PORT, () => console.log(`fake-api escuchando en http://localhost:${PORT}`));
