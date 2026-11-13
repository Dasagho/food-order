#!/usr/bin/env sh
# Crea ./secrets con los secretos que usa docker-compose.yml. No sobrescribe lo que ya exista.
#   JWT_SECRET         -> aleatorio de 48 bytes (firma de los tokens de acceso)
#   MS_CLIENT_SECRET   -> el "valor" del secreto de cliente de tu app de Azure (se pide por teclado, sin eco)
#   s3_access_key_id / s3_secret_access_key -> credenciales del bucket de imágenes (RustFS), solo si
#                         STORAGE_DRIVER=s3. Con el controlador por defecto (fs) quedan vacíos y no se usan.
#                         Pueden darse por teclado (sin eco) o, sin terminal, con las variables de entorno
#                         S3_ACCESS_KEY_ID y S3_SECRET_ACCESS_KEY.
set -eu
cd "$(dirname "$0")/.."

dir=secrets
umask 077
mkdir -p "$dir"
# El directorio es solo del usuario; los ficheros se leen desde el contenedor (otro uid), por eso 0644.
chmod 700 "$dir"

if [ -s "$dir/jwt_secret" ]; then
  echo "= $dir/jwt_secret ya existe (no se toca)"
else
  if command -v openssl >/dev/null 2>&1; then
    openssl rand -base64 48 | tr -d '\n' > "$dir/jwt_secret"
  else
    head -c 48 /dev/urandom | base64 | tr -d '\n' > "$dir/jwt_secret"
  fi
  chmod 644 "$dir/jwt_secret"
  echo "+ $dir/jwt_secret generado"
fi

# Crea $dir/<nombre> si no existe (o está vacío). Valor: variable de entorno $3 si está definida; si no, se pide por
# teclado SIN eco cuando hay terminal; si no, queda vacío con un aviso. Nunca sobrescribe un secreto ya relleno.
#   $1 = nombre del fichero, $2 = texto que se pide, $3 = variable de entorno opcional con el valor
ask_secret() {
  name="$1"; prompt="$2"; envvar="${3:-}"
  if [ -s "$dir/$name" ]; then
    echo "= $dir/$name ya existe (no se toca)"
    return
  fi
  value=""
  if [ -n "$envvar" ]; then eval "value=\${$envvar:-}"; fi
  if [ -z "$value" ] && [ -t 0 ]; then
    printf '%s' "$prompt"
    stty -echo 2>/dev/null || true
    read -r value || value=""
    stty echo 2>/dev/null || true
    printf '\n'
  fi
  printf '%s' "$value" > "$dir/$name"
  chmod 644 "$dir/$name"
  if [ -n "$value" ]; then echo "+ $dir/$name guardado"; else echo "! $dir/$name vacío: $4"; fi
}

ask_secret ms_client_secret 'Secreto de cliente de Azure (Enter para dejarlo vacío, solo desarrollo): ' "" \
  "rellénalo antes de producción"
ask_secret s3_access_key_id 'Access key del bucket de imágenes S3/RustFS (Enter = vacío, solo con STORAGE_DRIVER=fs): ' S3_ACCESS_KEY_ID \
  "rellénalo antes de usar STORAGE_DRIVER=s3"
ask_secret s3_secret_access_key 'Secret key del bucket de imágenes S3/RustFS (Enter = vacío, solo con STORAGE_DRIVER=fs): ' S3_SECRET_ACCESS_KEY \
  "rellénalo antes de usar STORAGE_DRIVER=s3"
