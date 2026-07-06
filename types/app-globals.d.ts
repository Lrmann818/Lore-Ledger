declare const __APP_VERSION__: string | undefined;
declare const __APP_BUILD__: string | undefined;

interface Window {
  __APP_VERSION__?: string;
  APP_VERSION?: string;
  __APP_BUILD__?: string;
  APP_BUILD?: string;
  __APP_BOOT_STARTED_AT__?: number;
  Capacitor?: {
    getPlatform?: () => string;
    isNativePlatform?: () => boolean;
    isPluginAvailable?: (name: string) => boolean;
    Plugins?: {
      NativeBackupExport?: {
        exportBackup?: (options: { filename: string, json: string }) => Promise<{ status?: string }>;
      };
    };
  };
}

declare const Capacitor: {
  getPlatform?: () => string;
  isNativePlatform?: () => boolean;
  isPluginAvailable?: (name: string) => boolean;
  Plugins?: {
    NativeBackupExport?: {
      exportBackup?: (options: { filename: string, json: string }) => Promise<{ status?: string }>;
    };
  };
} | undefined;

interface ImportMetaEnv {
  readonly BASE_URL: string;
  readonly PROD: boolean;
}

interface ImportMeta {
  readonly env: ImportMetaEnv;
}
