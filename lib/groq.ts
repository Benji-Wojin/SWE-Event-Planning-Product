// Server-only Groq integration. No alternative provider or paid fallback.
export const GROQ_RESPONSES_URL = 'https://api.groq.com/openai/v1/responses';
export const GROQ_CHAT_URL = 'https://api.groq.com/openai/v1/chat/completions';
export const GROQ_MODEL = 'openai/gpt-oss-20b';
export const MAIL_AI_CONSENT_VERSION = 'groq-email-v1';
export const PLAN_AI_CONSENT_VERSION = 'groq-plan-v1';

// Conservative payload-size admission guard, not an exact tokenizer or guarantee
// of remaining organizational TPM. Groq still enforces its current account limits.
// Include instructions/schema and reserve room for reasoning + visible output.
export function fitsGroqRequest(body: Record<string, unknown> & (
  { max_output_tokens: number } | { max_completion_tokens: number }
)) {
  const outputTokens = 'max_completion_tokens' in body
    ? Number(body.max_completion_tokens) : Number(body.max_output_tokens);
  return (
    Number.isFinite(outputTokens) && outputTokens > 0 &&
    new TextEncoder().encode(JSON.stringify(body)).length <=
    (7000 - outputTokens) * 3
  );
}

export function groqFailure(response: Response) {
  return response.status === 429
    ? 'rate_limit'
    : [401, 403].includes(response.status)
      ? 'credentials'
      : 'provider';
}

export function groqRetryAfter(response: Response) {
  const value = response.headers.get('retry-after') || '';
  const seconds = /^\d+(\.\d+)?$/.test(value)
    ? Number(value)
    : (Date.parse(value) - Date.now()) / 1000;
  // A missing or malformed hint backs off for an hour; never retry in a loop.
  return Number.isFinite(seconds)
    ? Math.min(86400, Math.max(60, Math.ceil(seconds)))
    : 3600;
}
