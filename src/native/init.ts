import { App as CapApp } from '@capacitor/app';
import { isNativeApp } from './player';
import { closeOverlay, installSpatialNav } from '../lib/spatialNav';

/**
 * Android / Fire TV app start-up: remote-control navigation everywhere, and the Back button closes
 * the open dialog or menu, else goes back a page, and leaves the app from Home.
 */
export function initNativeApp(): void {
  if (!isNativeApp()) return;
  installSpatialNav();
  void CapApp.addListener('backButton', () => {
    if (closeOverlay()) return;
    if (window.location.pathname === '/' || window.location.pathname === '') void CapApp.exitApp();
    else window.history.back();
  });
}
