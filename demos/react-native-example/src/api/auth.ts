/**
 * MOCK auth API.
 *
 * Replace both functions with calls to your real auth endpoint — for Amthal
 * apps that is the Customer-Vendor app's login, e.g.:
 *
 *   const res = await fetch(`${API_BASE_URL}/api/account/login`, {
 *     method: 'POST',
 *     headers: { 'Content-Type': 'application/json' },
 *     body: JSON.stringify({ username, password }),
 *   });
 *   if (!res.ok) throw new Error('Invalid credentials');
 *   const body = await res.json();
 *   return { token: body.token, branchId: String(body.branchId) };
 *
 * The token you return here is handed verbatim to the portal through the
 * bridge (`init` / `auth` messages) — it must be the same bearer token the
 * portal's own auth service expects.
 */

export interface AuthTokens {
  token: string;
  branchId?: string;
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

let mockCounter = 0;

/** Mock login: accepts any non-empty credentials. */
export async function login(username: string, password: string): Promise<AuthTokens> {
  await delay(600); // simulate network
  if (!username.trim() || !password.trim()) {
    throw new Error('Please enter a username and password.');
  }
  mockCounter += 1;
  return {
    token: `mock-token.${encodeURIComponent(username)}.${Date.now()}.${mockCounter}`,
    branchId: '1',
  };
}

/**
 * Mock token refresh — called by FormScreen's onAuthExpired handler.
 * Replace with your real refresh endpoint (or a silent re-login).
 */
export async function refreshToken(currentToken: string): Promise<AuthTokens> {
  await delay(400); // simulate network
  mockCounter += 1;
  return {
    token: `${currentToken.split('.')[0]}.refreshed.${Date.now()}.${mockCounter}`,
    branchId: '1',
  };
}
