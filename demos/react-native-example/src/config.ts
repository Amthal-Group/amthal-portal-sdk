/**
 * Where the Amthal Client Portal is hosted.
 *
 * Replace this with your environment's portal origin (HTTPS only; a plain
 * `http://localhost:4200` is allowed for local development — on the Android
 * emulator use `http://10.0.2.2:4200` to reach your machine).
 *
 * The SDK fetches `${PORTAL_BASE_URL}/embed/manifest.json` before loading
 * anything, so this must be a deployment that serves the embed routes.
 */
export const PORTAL_BASE_URL = 'https://portal.example.com';
