// Conservative, local routing: no classifier call and no automatic context sharing.
// The composer discloses the selected destination before the user presses Send.
export function researchIntent(
  message: string,
): 'planning' | 'search' | 'clarify' {
  const normalized = message.replace(/[‘’]/g, "'");
  const plain = normalized
    .trim()
    .replace(/"[^"\n]*"|(?<!\w)'[^'\n]*'(?!\w)|“[^”\n]*”|`[^`]*`/g, '')
    .trim();
  if (
    /\b(?:don't|do not|never|without|no)\b.{0,40}\b(?:search(?:ing)?|brows(?:e|ing)|research(?:ing)?|look(?:ing)? up|web|internet|online)\b/i.test(
      plain,
    )
  )
    return 'planning';
  const request = normalized.trim()
    .replace(
      /^(?:(?:please|hey|hi)[, !]*)?(?:(?:can|could|would|will) you (?:please )?(?:help me )?)?/i,
      '',
    )
    .trim();
  const explicit =
    /^(?:search\b|look\s+up\b|research\b|browse\b|where can (?:i|we) find\b)/i.test(
      request,
    );
  const find = /^find\b/i.test(request);
  if (!explicit && !find) return 'planning';
  if (
    /\b(?:tasks?|next(?:\s+\w+)? steps?|gaps?|dependencies|prerequisites|(?:my|our|existing|saved|project)\s+(?:(?:saved|existing)\s+)?(?:draft|plan|schedule|notes?|budget|files?))\b/i.test(
      request,
    )
  )
    return 'planning';
  if (
    /^(?:find|search(?: for)?|look up|research|browse)(?:\s+(?:me|us|the web for))?\s*(?:(?:something|somewhere|more|it|this|that)(?:\s+(?:for|like|about|near)\s+(?:this|that|it|there))?)?[.!?]*$/i.test(
      request,
    ) ||
    /\b(?:for that|for this|like that|same as before|near (?:here|there|me)|in that city)\b/i.test(request)
  )
    return 'clarify';
  return 'search';
}
