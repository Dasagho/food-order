/// <reference types="vite/client" />
/// <reference types="vite-plugin-pwa/client" />

interface ImportMetaEnv {
  /** URL base del backend food-order-api (vacía = mismo origen). */
  readonly VITE_API_URL?: string;
  /** "1" habilita el acceso de desarrollo (el backend necesita AUTH_DEV_BYPASS=1). */
  readonly VITE_DEV_LOGIN?: string;
  /** "0" muestra cifras occidentales (0123) en árabe; por defecto ٠١٢٣. */
  readonly VITE_ARABIC_DIGITS?: string;
}
