import type { CapacitorConfig } from '@capacitor/cli';

/**
 * Fire TV / Android build. The app talks to the provider directly (no ChillyPTV server):
 * - CapacitorHttp routes fetch/XHR through Android's HTTP stack, so provider APIs need no CORS.
 * - The page is served over http:// so http:// provider images and streams aren't "mixed content".
 * Playback uses the native ExoPlayer plugin (android/app/src/main/java/.../player).
 */
const config: CapacitorConfig = {
  appId: 'tv.chillyptv.app',
  appName: 'ChillyPTV',
  webDir: 'dist',
  server: { androidScheme: 'http' },
  android: { allowMixedContent: true, webContentsDebuggingEnabled: true },
  plugins: {
    CapacitorHttp: { enabled: true },
  },
};

export default config;
