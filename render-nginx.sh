#!/bin/sh
# Genera la configuración de nginx de la imagen a partir de las plantillas nginx.conf y nginx.headers.conf.
# Lo usa el Dockerfile (etapa build) y el test unitario tests/unit/nginx-config.test.ts.
#
#   VITE_API_URL     origen de una API en otro dominio (vacío = mismo origen); se añade a connect-src/img-src
#   API_UPSTREAM     destino del proxy /v1/             p. ej. http://api:3000
#   MEDIA_UPSTREAM   destino del proxy /media/<clave>   p. ej. http://api:3000/media  (controlador fs)
#                    o http://rustfs:9000/food-order/images (bucket S3, sin barra final); vacío = /media/ da 404
#   SRC_DIR          carpeta de las plantillas (por defecto, la de este script)
#   OUT_DIR          carpeta de salida: default.conf y nginx.headers.conf
set -eu

src="${SRC_DIR:-$(dirname "$0")}"
out="${OUT_DIR:?Falta OUT_DIR}"
api_upstream="${API_UPSTREAM:-http://api:3000}"
media_upstream="${MEDIA_UPSTREAM:-}"
vite_api_url="${VITE_API_URL:-}"

fail() { echo "$1" >&2; exit 1; }

valid_origin='^https?://[A-Za-z0-9._:-]+$'
valid_media='^https?://[A-Za-z0-9._:-]+(/[A-Za-z0-9._/-]*)?$'

extra=''
if [ -n "$vite_api_url" ]; then
  origin="$(printf '%s' "$vite_api_url" | sed -E 's#^(https?://[^/]+).*#\1#')"
  printf '%s' "$origin" | grep -Eq "$valid_origin" || fail "VITE_API_URL no válida: $origin"
  extra=" $origin"
fi

printf '%s' "$api_upstream" | grep -Eq "$valid_origin" || fail "API_UPSTREAM no válida: $api_upstream"

# MEDIA_UPSTREAM admite ruta (bucket/prefijo). Se quitan las barras finales y se rechazan segmentos «..».
media_upstream="$(printf '%s' "$media_upstream" | sed -E 's#/+$##')"
if [ -n "$media_upstream" ]; then
  printf '%s' "$media_upstream" | grep -Eq "$valid_media" || fail "MEDIA_UPSTREAM no válida: $media_upstream"
  ! printf '%s' "$media_upstream" | grep -Eq '(^|/)\.\.?(/|$)' || fail "MEDIA_UPSTREAM no válida (segmento . o ..): $media_upstream"
fi

mkdir -p "$out"
sed -e "s|__CONNECT_SRC__|'self'${extra}|" \
    -e "s|__IMG_SRC__|'self' data: blob:${extra}|" \
    "$src/nginx.headers.conf" > "$out/nginx.headers.conf"

# Con MEDIA_UPSTREAM se conserva el bloque «media-on» y se descarta «media-off»; vacío, al revés.
if [ -n "$media_upstream" ]; then drop='media-off'; else drop='media-on'; fi
sed -e "/#>> $drop\$/,/#<< $drop\$/d" \
    -e "/#[<>][<>] media-/d" \
    -e "s|__API_UPSTREAM__|${api_upstream}|" \
    -e "s|__MEDIA_UPSTREAM__|${media_upstream}|" \
    "$src/nginx.conf" > "$out/default.conf"

left="$(grep -c '__[A-Z_]*__' "$out/default.conf" "$out/nginx.headers.conf" | grep -v ':0$' || true)"
[ -z "$left" ] || fail "Quedan marcadores sin sustituir: $left"
