# syntax=docker/dockerfile:1

# Imagen de producción de la PWA: ficheros estáticos + nginx sin privilegios (usuario 101, puerto 8080,
# sin shell de entrada ni escritura fuera de /tmp). Pensada para ejecutarse con sistema de ficheros de solo
# lectura:  docker run --read-only --tmpfs /tmp --cap-drop ALL --security-opt no-new-privileges ...
#
# Compilación (los ARG se incrustan en el JS público: nunca pongas secretos en ellos):
#   docker build -t food-order-web \
#     --build-arg VITE_API_URL=              # vacío = API en el mismo origen (nginx hace de proxy a /v1)
#     --build-arg API_UPSTREAM=http://api:3000   # destino del proxy /v1 (solo si VITE_API_URL está vacío)
#     --build-arg MEDIA_UPSTREAM=http://rustfs:9000/food-order/images   # destino de /media/<clave> (imágenes)
#     .
# MEDIA_UPSTREAM (SPEC §6.6): /media/<clave>.webp se enruta a <MEDIA_UPSTREAM>/<clave>.webp con caché de proxy en /tmp,
# solo GET/HEAD. Valores típicos: http://api:3000/media (la API sirve las imágenes con STORAGE_DRIVER=fs, desarrollo)
# o http://rustfs:9000/<bucket>/<prefijo sin barra final> (RustFS). Vacío = este nginx NO sirve /media (404) y lo
# enruta el reverse proxy de delante.
# Con una API en otro dominio:  --build-arg VITE_API_URL=https://api.midominio.es
#   (la CSP de la imagen permitirá solo ese origen).

ARG NODE_VERSION=22
ARG NGINX_VERSION=1.30

# ---- dependencias: capa cacheable; sin scripts de instalación (menos superficie de ataque de la cadena de suministro)
FROM node:${NODE_VERSION}-alpine AS deps
WORKDIR /app
COPY package.json package-lock.json ./
RUN --mount=type=cache,target=/root/.npm \
    npm ci --ignore-scripts --no-audit --no-fund

# ---- build: solo las entradas que Vite necesita (nada de COPY . .)
FROM deps AS build
ARG VITE_API_URL=
ARG VITE_BUILD_SHA=unknown
ARG VITE_DEV_LOGIN=
ARG VITE_ARABIC_DIGITS=
ARG API_UPSTREAM=http://api:3000
ARG MEDIA_UPSTREAM=
ENV VITE_API_URL=${VITE_API_URL} \
    VITE_BUILD_SHA=${VITE_BUILD_SHA} \
    VITE_DEV_LOGIN=${VITE_DEV_LOGIN} \
    VITE_ARABIC_DIGITS=${VITE_ARABIC_DIGITS}
COPY tsconfig.json vite.config.ts index.html ./
COPY public ./public
COPY src ./src
RUN npm run build

# Precomprime los estáticos (nginx los sirve con gzip_static: sin CPU en ejecución).
RUN find dist -type f \( -name '*.js' -o -name '*.css' -o -name '*.html' -o -name '*.svg' \
        -o -name '*.json' -o -name '*.webmanifest' \) -exec gzip -9 -k -f {} +

# Configuración de nginx con la CSP y los destinos de /v1 y /media fijados en la compilación
# (la validación estricta de los ARG vive en render-nginx.sh; la CSP no cambia: /media es el mismo origen).
COPY nginx.conf nginx.headers.conf render-nginx.sh /tmp/nginx/
RUN SRC_DIR=/tmp/nginx OUT_DIR=/out API_UPSTREAM="${API_UPSTREAM}" MEDIA_UPSTREAM="${MEDIA_UPSTREAM}" sh /tmp/nginx/render-nginx.sh

# ---- runtime
FROM nginxinc/nginx-unprivileged:${NGINX_VERSION}-alpine-slim AS runtime

ARG VITE_BUILD_SHA=unknown
LABEL org.opencontainers.image.title="food-order-web" \
      org.opencontainers.image.description="TPV de registro de pedidos (PWA) servida con nginx sin privilegios" \
      org.opencontainers.image.revision="${VITE_BUILD_SHA}"

# Ficheros propiedad de root y de solo lectura para el usuario de nginx.
COPY --from=build /out/default.conf /etc/nginx/conf.d/default.conf
COPY --from=build /out/nginx.headers.conf /etc/nginx/nginx.headers.conf
COPY --from=build /app/dist /usr/share/nginx/html

USER 101
EXPOSE 8080

HEALTHCHECK --interval=30s --timeout=3s --start-period=5s --retries=3 \
  CMD wget -q --spider http://127.0.0.1:8080/healthz || exit 1

# Sin el entrypoint de la imagen base: no genera ficheros de configuración al arrancar (necesitaría escribir en /etc).
ENTRYPOINT []
CMD ["nginx", "-g", "daemon off;"]
