/**
 * CORS policy: never use `*`.
 * Reflect only origins listed in FINANCIAL_AI_CORS_ORIGINS (comma-separated).
 * Native clients typically omit Origin and still work without ACAO.
 * This is not authentication — JWT auth remains mandatory.
 */
export function buildCorsHeaders(
  requestOrigin: string | null,
  allowedOriginsCsv: string | undefined
): Record<string, string> {
  const base: Record<string, string> = {
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    Vary: 'Origin',
  };

  const allowed = (allowedOriginsCsv ?? '')
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0 && item !== '*');

  if (requestOrigin && allowed.includes(requestOrigin)) {
    return {
      ...base,
      'Access-Control-Allow-Origin': requestOrigin,
    };
  }

  return base;
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
