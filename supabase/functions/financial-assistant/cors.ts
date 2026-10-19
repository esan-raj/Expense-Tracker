/**
 * CORS policy: never use `*`, never reflect arbitrary Origin.
 * Allowlist: FINANCIAL_AI_CORS_ORIGINS (comma-separated absolute origins).
 * Originless requests (typical Expo/React Native) are allowed through the gate.
 * This is not authentication — JWT auth remains mandatory after the gate.
 */

export type OriginEvaluation =
  | { allowed: true; headers: Record<string, string> }
  | { allowed: false; headers: Record<string, string> };

function baseHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };
}

/** Parse allowlist; drop empties and literal `*`. */
export function parseCorsAllowlist(allowedOriginsCsv: string | undefined): string[] {
  return (allowedOriginsCsv ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== '*');
}

/**
 * Evaluate Origin against the allowlist.
 * - No Origin → allowed (native clients); headers omit ACAO.
 * - Origin in allowlist → allowed; ACAO is that exact origin.
 * - Origin present but not allowlisted (including empty allowlist) → rejected.
 */
export function evaluateRequestOrigin(
  requestOrigin: string | null,
  allowedOriginsCsv: string | undefined
): OriginEvaluation {
  const headers = baseHeaders();
  const allowed = parseCorsAllowlist(allowedOriginsCsv);

  if (requestOrigin == null || requestOrigin === '') {
    return { allowed: true, headers };
  }

  if (allowed.includes(requestOrigin)) {
    return {
      allowed: true,
      headers: {
        ...headers,
        'Access-Control-Allow-Origin': requestOrigin,
      },
    };
  }

  return { allowed: false, headers };
}

/** @deprecated Prefer evaluateRequestOrigin for gate decisions. */
export function buildCorsHeaders(
  requestOrigin: string | null,
  allowedOriginsCsv: string | undefined
): Record<string, string> {
  return evaluateRequestOrigin(requestOrigin, allowedOriginsCsv).headers;
}

export function jsonResponse(
  body: unknown,
  status: number,
  corsHeaders: Record<string, string>,
  extraHeaders: Record<string, string> = {}
): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders,
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}
