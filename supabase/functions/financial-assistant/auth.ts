import { FinancialAssistantError } from './errors.ts';

export type AuthenticatedUser = {
  id: string;
};

export type AuthDeps = {
  /** Resolve the bearer JWT to a user. Injected so Jest can mock without Deno. */
  getUserFromJwt: (jwt: string) => Promise<AuthenticatedUser | null>;
};

export function extractBearerToken(authorizationHeader: string | null): string {
  if (!authorizationHeader) {
    throw new FinancialAssistantError('auth', 'Missing Authorization bearer token', 401);
  }
  const match = /^Bearer\s+(.+)$/i.exec(authorizationHeader.trim());
  if (!match?.[1]) {
    throw new FinancialAssistantError('auth', 'Authorization must be Bearer <jwt>', 401);
  }
  const token = match[1].trim();
  // Reject API keys mistaken for user JWTs.
  if (token.startsWith('sb_publishable_') || token.startsWith('sb_secret_')) {
    throw new FinancialAssistantError('auth', 'A user session JWT is required', 401);
  }
  if (token.split('.').length !== 3) {
    throw new FinancialAssistantError('auth', 'A user session JWT is required', 401);
  }
  return token;
}

export async function requireUser(
  authorizationHeader: string | null,
  deps: AuthDeps
): Promise<AuthenticatedUser> {
  const jwt = extractBearerToken(authorizationHeader);
  const user = await deps.getUserFromJwt(jwt);
  if (!user?.id) {
    throw new FinancialAssistantError('auth', 'Invalid or expired session', 401);
  }
  return user;
}
