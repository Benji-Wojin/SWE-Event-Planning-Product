// Fingerprint the exact JSON sent for approval, not subsequently edited items.
export async function planApprovalHash(generation: string, items: unknown) {
  const bytes = new TextEncoder().encode(JSON.stringify({ generation, items }));
  return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256', bytes)),
    byte => byte.toString(16).padStart(2, '0')).join('');
}
