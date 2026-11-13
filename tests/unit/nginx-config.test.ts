import { describe, it, expect, afterAll } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

/**
 * Configuración de nginx de la imagen web (SPEC §6.6): se renderiza con el MISMO script que usa el Dockerfile
 * (render-nginx.sh) y se comprueban las garantías de /media. El comportamiento en vivo (caché, 404, 502…) se
 * verifica con Docker real aparte; aquí se fija que la plantilla no pierda ninguna de esas piezas.
 */
const ROOT = resolve(__dirname, "../..");
const dirs: string[] = [];
afterAll(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

function render(env: Record<string, string>): { conf: string; headers: string } {
  const out = mkdtempSync(join(tmpdir(), "nginx-render-"));
  dirs.push(out);
  execFileSync("sh", [join(ROOT, "render-nginx.sh")], {
    env: { PATH: process.env.PATH ?? "", SRC_DIR: ROOT, OUT_DIR: out, ...env },
    stdio: "pipe",
  });
  return {
    conf: readFileSync(join(out, "default.conf"), "utf8"),
    headers: readFileSync(join(out, "nginx.headers.conf"), "utf8"),
  };
}
const fails = (env: Record<string, string>) => {
  try {
    render(env);
    return null;
  } catch (e) {
    return String((e as { stderr?: Buffer }).stderr ?? e);
  }
};

/** Bloque `{ … }` que empieza en la primera aparición de `head` (conteo de llaves; los comentarios no llevan llaves). */
function block(conf: string, head: string): string {
  const start = conf.indexOf(head);
  expect(start, `no se encontró «${head}»`).toBeGreaterThanOrEqual(0);
  const open = conf.indexOf("{", start);
  let depth = 0;
  for (let i = open; i < conf.length; i++) {
    if (conf[i] === "{") depth++;
    if (conf[i] === "}" && --depth === 0) return conf.slice(start, i + 1);
  }
  throw new Error("llaves sin cerrar");
}

const UP = "http://rustfs:9000/food-order/images";

describe("nginx: /media con MEDIA_UPSTREAM", () => {
  const { conf, headers } = render({ MEDIA_UPSTREAM: UP });
  const media = block(conf, "location ^~ /media/ {");
  const inner = block(media, "location ~ ^/media/");

  it("no deja marcadores sin sustituir ni restos de plantilla", () => {
    expect(conf).not.toMatch(/__[A-Z_]+__/);
    expect(conf).not.toMatch(/#[<>]{2} media-/);
    expect(conf).toContain(`set $media_upstream ${UP};`);
    expect(conf).toContain("set $api_upstream http://api:3000;");
    expect(conf.match(/location \^~ \/media\//g)).toHaveLength(1); // solo el bloque «media-on»
  });

  it("solo claves válidas; el resto es 404 sin llegar al bucket", () => {
    const m = /location ~ \^\/media\/\(\?<media_key>(.+)\)\$ \{/.exec(media);
    expect(m, "regex de la clave").not.toBeNull();
    expect(m![1]).toBe("[A-Za-z0-9][A-Za-z0-9._/-]*\\.webp");
    const key = new RegExp(`^/media/(${m![1]})$`);
    const id = "0b7c5c1e-3f0a-4f6e-9a54-6f1d2f6a8c11";
    for (const ok of [`/media/${id}.webp`, "/media/legacy/paella-valenciana.webp", "/media/A1.webp"])
      expect(key.test(ok), ok).toBe(true);
    for (const bad of [
      "/media/",
      "/media/x",
      "/media/x.png",
      "/media/x.jpg",
      "/media/x.WEBP",
      "/media/x.webp/",
      "/media/../etc/passwd.webp",
      "/media/.hidden.webp",
      "/media/-x.webp",
      "/media/a b.webp",
      "/media/a%2fb.webp",
      "/media/a;b.webp",
      "/media/a?x=1.webp",
      "/media/é.webp",
    ]) {
      expect(key.test(bad), bad).toBe(false);
    }
    // «a/../b.webp» sí cabe en [._/-]: lo impide la normalización de la URI de nginx (se comprueba con Docker real)
    // las claves no válidas caen en el `return 404` del bloque exterior
    expect(media.replace(inner, "")).toMatch(/return 404;/);
  });

  it("solo GET/HEAD, sin Authorization ni cookies hacia el bucket, sin cuerpo", () => {
    expect(inner).toMatch(/limit_except GET HEAD \{ deny all; \}/);
    expect(inner).toMatch(/proxy_set_header Authorization "";/);
    expect(inner).toMatch(/proxy_set_header Cookie "";/);
    for (const h of ["X-Forwarded-For", "X-Real-IP", "Forwarded"]) expect(inner).toContain(`proxy_set_header ${h} "";`);
    expect(inner).toMatch(/proxy_pass_request_body off;/);
    expect(inner).not.toMatch(/proxy_set_header Host/); // Host = el del bucket ($proxy_host por defecto)
  });

  it("proxy_pass con variable + resolver de Docker, SNI por si el upstream es https y sin consulta", () => {
    expect(inner).toMatch(/resolver 127\.0\.0\.11 /);
    expect(inner).toMatch(/proxy_pass \$media_upstream\/\$media_key;/); // sin «?»: la consulta no llega al bucket
    expect(inner).toMatch(/proxy_ssl_server_name on;/);
    expect(inner).toMatch(/proxy_http_version 1\.1;/);
  });

  it("caché de proxy en /tmp: 200 7d, 404 1m, stale en error/timeout/updating, clave sin consulta", () => {
    expect(conf).toMatch(
      /proxy_cache_path \/tmp\/media-cache levels=1:2 keys_zone=media:\d+m max_size=20m inactive=7d use_temp_path=off;/,
    );
    expect(inner).toMatch(/proxy_cache media;/);
    expect(inner).toMatch(/proxy_cache_key \$media_key;/);
    expect(inner).toMatch(/proxy_cache_valid 200 7d;/);
    expect(inner).toMatch(/proxy_cache_valid 404 1m;/);
    expect(inner).toMatch(/proxy_cache_use_stale error timeout updating\b/);
    expect(inner).toMatch(/proxy_cache_lock on;/);
    // un Set-Cookie del bucket no debe impedir cachear (y no sale al cliente)
    expect(inner).toMatch(/proxy_ignore_headers Set-Cookie;/);
    expect(inner).toMatch(/proxy_hide_header Set-Cookie;/);
  });

  it("oculta x-amz-*/Server, nosniff y Cache-Control por defecto solo si el objeto no trae el suyo", () => {
    for (const h of ["Server", "x-amz-request-id", "x-amz-id-2", "x-amz-version-id"])
      expect(inner).toContain(`proxy_hide_header ${h};`);
    expect(inner).toContain("include /etc/nginx/nginx.headers.conf;");
    expect(headers).toContain('add_header X-Content-Type-Options "nosniff" always;');
    expect(conf).toMatch(
      /map \$upstream_http_cache_control \$media_cache_control \{\s+default "";\s+"" +"public, max-age=86400";\s+\}/,
    );
    expect(inner).toMatch(/add_header Cache-Control \$media_cache_control;/); // sin `always`: lo pone solo en 200/304
    expect(inner).not.toMatch(/proxy_hide_header Cache-Control|proxy_ignore_headers[^;]*Cache-Control/); // se respeta el del objeto
  });

  it("el 404 del bucket sale como 404 (nunca index.html)", () => {
    expect(inner).toMatch(/proxy_intercept_errors on;/);
    expect(inner).toMatch(/error_page 404 = @media_not_found;/);
    const nf = block(conf, "location @media_not_found {");
    expect(nf).toMatch(/internal;/);
    expect(nf).toMatch(/return 404 /);
    expect(nf).not.toMatch(/index\.html|try_files/);
    expect(nf).toMatch(/types \{ \}/); // el cuerpo es text/plain aunque la URL acabe en .webp
    expect(conf).toMatch(/location = \/media \{\s+return 404;/); // «/media» sin barra tampoco cae en la SPA
  });

  it("subida de hasta 15 MB: client_max_body_size 16m", () => {
    expect(conf).toMatch(/client_max_body_size 16m;/);
  });

  it("/media/ va por prefijo ^~, antes de las reglas regex de imágenes (sirven ficheros estáticos)", () => {
    expect(conf.indexOf("location ^~ /media/")).toBeLessThan(conf.indexOf("location ~* \\.(?:png|jpe?g"));
    expect(conf.indexOf("location ^~ /media/")).toBeLessThan(conf.indexOf("location ~ /\\."));
  });

  it("la CSP no cambia: img-src sigue en 'self' data: blob: (mismo origen)", () => {
    expect(headers).toContain("img-src 'self' data: blob:;");
    expect(headers).toContain("connect-src 'self';");
    expect(headers).not.toMatch(/rustfs|amazonaws|https?:\/\//i);
  });

  it("cada location que añade cabeceras incluye también las de seguridad (add_header no se hereda)", () => {
    for (const head of ["location @media_not_found {", "location ~ ^/media/"]) {
      const b = block(media + "\n" + conf, head);
      expect(b, head).toContain("include /etc/nginx/nginx.headers.conf;");
    }
  });
});

describe("nginx: sin MEDIA_UPSTREAM (lo enruta el reverse proxy de delante)", () => {
  const { conf } = render({ MEDIA_UPSTREAM: "" });

  it("/media/ responde 404, sin proxy ni index.html", () => {
    const media = block(conf, "location ^~ /media/ {");
    expect(media).toMatch(/return 404 /);
    expect(media).not.toMatch(/proxy_pass|try_files|index\.html/);
    expect(conf).not.toContain("$media_upstream");
    expect(conf.match(/location \^~ \/media\//g)).toHaveLength(1);
    expect(conf).not.toMatch(/__[A-Z_]+__|#[<>]{2} media-/);
    expect(conf).toMatch(/client_max_body_size 16m;/); // la subida a /v1/uploads sigue pasando por este nginx
  });

  it("MEDIA_UPSTREAM sin definir equivale a vacío", () => {
    expect(render({}).conf).not.toContain("$media_upstream");
  });
});

describe("nginx: validación estricta de los destinos", () => {
  it.each([
    ["http://api:3000/media", "http://api:3000/media"],
    ["http://rustfs:9000/food-order/images", "http://rustfs:9000/food-order/images"],
    ["https://s3.ejemplo.es/mi-bucket/img", "https://s3.ejemplo.es/mi-bucket/img"],
    ["http://rustfs:9000", "http://rustfs:9000"],
    ["http://rustfs:9000/food-order/images/", "http://rustfs:9000/food-order/images"], // barra final: se quita
  ])("acepta MEDIA_UPSTREAM=%s", (value, expected) => {
    expect(render({ MEDIA_UPSTREAM: value }).conf).toContain(`set $media_upstream ${expected};`);
  });

  it.each([
    "ftp://x/y",
    "rustfs:9000/x",
    "http://",
    "http://x y/z",
    "http://x/a;b",
    "http://x/a b",
    "http://x/$host",
    "http://x/a|b",
    "http://x/a&b",
    "http://x/a?b=1",
    "http://x/a#b",
    "http://x/'a'",
    'http://x/"a"',
    "http://x/../etc",
    "http://x/a/./b",
    "http://x/a/..",
    "http://user:pw@x/y",
    "http://x/%2e%2e/y",
    "http://x/a\\nb",
  ])("rechaza MEDIA_UPSTREAM=%s", (value) => {
    expect(fails({ MEDIA_UPSTREAM: value })).toMatch(/MEDIA_UPSTREAM no válida/);
  });

  it("API_UPSTREAM y VITE_API_URL siguen validándose como antes", () => {
    expect(fails({ API_UPSTREAM: "http://api:3000/v1" })).toMatch(/API_UPSTREAM no válida/);
    expect(fails({ API_UPSTREAM: "http://a;b" })).toMatch(/API_UPSTREAM no válida/);
    expect(fails({ VITE_API_URL: "javascript:alert(1)" })).toMatch(/VITE_API_URL no válida/);
  });

  it("con VITE_API_URL (API en otro dominio) solo ese origen se añade a connect-src/img-src; /media no añade nada", () => {
    const { headers } = render({ VITE_API_URL: "https://api.ejemplo.es/v1", MEDIA_UPSTREAM: UP });
    expect(headers).toContain("img-src 'self' data: blob: https://api.ejemplo.es;");
    expect(headers).toContain("connect-src 'self' https://api.ejemplo.es;");
    expect(headers).not.toContain("rustfs");
  });
});

describe("despliegue: Dockerfile, compose y .env.example", () => {
  const read = (f: string) => readFileSync(join(ROOT, f), "utf8");

  it("el Dockerfile declara el ARG MEDIA_UPSTREAM y renderiza con el script validado", () => {
    const d = read("Dockerfile");
    expect(d).toMatch(/^ARG MEDIA_UPSTREAM=$/m);
    expect(d).toContain("COPY nginx.conf nginx.headers.conf render-nginx.sh /tmp/nginx/");
    expect(d).toMatch(/MEDIA_UPSTREAM="\$\{MEDIA_UPSTREAM\}" sh \/tmp\/nginx\/render-nginx\.sh/);
    expect(d).toContain("USER 101");
  });

  it("el compose pasa MEDIA_UPSTREAM (por defecto la API con fs), tmpfs de 64m y mantiene el endurecimiento", () => {
    const c = read("docker-compose.yml");
    expect(c).toContain("MEDIA_UPSTREAM: ${MEDIA_UPSTREAM-http://api:3000/media}");
    expect(c).toMatch(/- \/tmp:rw,noexec,nosuid,nodev,size=64m,mode=1777\n\s+depends_on:/); // la de `web`
    expect(c).toContain("read_only: true");
    expect(c).toContain("cap_drop: [ALL]");
    expect(c).toContain("no-new-privileges:true");
    for (const v of ["STORAGE_DRIVER", "S3_ENDPOINT", "S3_BUCKET", "S3_KEY_PREFIX", "S3_REGION", "S3_FORCE_PATH_STYLE", "IMAGES_PUBLIC_PATH"])
      expect(c).toContain(`${v}:`);
    expect(c).toContain("S3_ACCESS_KEY_ID_FILE: /run/secrets/s3_access_key_id");
    expect(c).toContain("S3_SECRET_ACCESS_KEY_FILE: /run/secrets/s3_secret_access_key");
    expect(c).toContain("./secrets/s3_access_key_id");
    expect(c).toContain("./secrets/s3_secret_access_key");
  });

  it(".dockerignore deja pasar render-nginx.sh", () => {
    // el contexto excluye ./docker y los *.md, pero no los ficheros de la raíz que necesita el build
    const ignore = read(".dockerignore").split("\n").map((l) => l.trim());
    expect(ignore).not.toContain("render-nginx.sh");
    expect(ignore).not.toContain("*.sh");
  });

  it(".env.example documenta DEV_MEDIA_TARGET y las variables de imágenes", () => {
    const e = read(".env.example");
    for (const v of ["DEV_MEDIA_TARGET", "MEDIA_UPSTREAM", "STORAGE_DRIVER", "S3_ENDPOINT", "S3_BUCKET", "IMAGES_PUBLIC_PATH"])
      expect(e).toContain(v);
  });
});
