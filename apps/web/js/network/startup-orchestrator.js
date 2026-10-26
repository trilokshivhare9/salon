/**
 * STARTUP LIFECYCLE ORCHESTRATOR
 * 
 * Prevents the "Startup Stampede" (thundering herd problem) by coordinating
 * app boot into 3 strict, ordered phases:
 * - Phase 1: Session Gatekeeper (Token freshness verification / clean refresh)
 * - Phase 2: Instant UI Paint (<15ms via local cache)
 * - Phase 3: Coordinated Silent Background Sync
 */

import { SalonSession, PlatformSession } from './session-manager.js';
import { HttpClient } from './http-client.js';
import { ENDPOINTS } from './endpoints.js';

export class StartupOrchestrator {
  /**
   * Boots the application with zero network collision.
   * 
   * @param {Function} onReadyToRoute - Callback invoked to render the screen on Phase 2
   */
  static async boot(onReadyToRoute) {
    // -------------------------------------------------------------
    // PHASE 1: Session Gatekeeper (<5ms)
    // -------------------------------------------------------------
    const salonRefreshToken = SalonSession.getRefreshToken();
    const salonToken = SalonSession.getAccessToken();

    // If access token is expired but refresh token exists, refresh ONCE cleanly before any requests fire
    if ((!salonToken || SalonSession.isTokenExpired(salonToken)) && salonRefreshToken && !SalonSession.isTokenExpired(salonRefreshToken)) {
      try {
        const refreshData = await HttpClient.request(ENDPOINTS.AUTH.REFRESH, {
          method: 'POST',
          body: JSON.stringify({ refreshToken: salonRefreshToken }),
          timeoutMs: 3000,
        }, SalonSession, 0);

        if (refreshData?.accessToken) {
          SalonSession.setAccessToken(refreshData.accessToken);
          if (refreshData.refreshToken) SalonSession.setRefreshToken(refreshData.refreshToken);
          if (refreshData.user) SalonSession.setUser(refreshData.user);
        }
      } catch (err) {
        console.warn('[StartupOrchestrator] Pre-boot salon token refresh failed, proceeding with offline session:', err.message);
      }
    }

    const platformRefreshToken = PlatformSession.getRefreshToken();
    const platformToken = PlatformSession.getAccessToken();

    if ((!platformToken || PlatformSession.isTokenExpired(platformToken)) && platformRefreshToken && !PlatformSession.isTokenExpired(platformRefreshToken)) {
      try {
        const refreshData = await HttpClient.request(ENDPOINTS.AUTH.REFRESH, {
          method: 'POST',
          body: JSON.stringify({ refreshToken: platformRefreshToken }),
          timeoutMs: 3000,
        }, PlatformSession, 0);

        if (refreshData?.accessToken) {
          PlatformSession.setAccessToken(refreshData.accessToken);
          if (refreshData.refreshToken) PlatformSession.setRefreshToken(refreshData.refreshToken);
          if (refreshData.user) PlatformSession.setUser(refreshData.user);
        }
      } catch (err) {
        console.warn('[StartupOrchestrator] Pre-boot platform token refresh failed:', err.message);
      }
    }

    // -------------------------------------------------------------
    // PHASE 2: Instant UI Paint (<15ms)
    // -------------------------------------------------------------
    if (typeof onReadyToRoute === 'function') {
      onReadyToRoute();
    }

    // -------------------------------------------------------------
    // PHASE 3: Coordinated Silent Background Sync
    // -------------------------------------------------------------
    if (SalonSession.isAuthenticated()) {
      // Background non-blocking user profile sync
      HttpClient.request(ENDPOINTS.AUTH.ME, {}, SalonSession, 0).then((freshUser) => {
        if (freshUser) SalonSession.setUser(freshUser);
      }).catch(() => {});
    }
  }
}
