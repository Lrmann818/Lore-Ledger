declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD__: string | undefined;

interface Window {
  __APP_VERSION__?: string;
  APP_VERSION?: string;
  __APP_BUILD__?: string;
  APP_BUILD?: string;
  __APP_BOOT_STARTED_AT__?: number;
  Capacitor?: {
    isNativePlatform?: () => boolean;
  };
}

declare const Capacitor: {
  isNativePlatform?: () => boolean;
} | undefined;

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
