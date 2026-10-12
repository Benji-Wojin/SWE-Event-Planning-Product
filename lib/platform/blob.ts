import 'server-only';
import { del, get, put } from '@vercel/blob';

export type PrivateBucket = {
  put(
    key: string,
    bytes: ArrayBuffer | Uint8Array,
    options?: { httpMetadata?: { contentType?: string } },
  ): Promise<void>;
  get(key: string): Promise<{ arrayBuffer(): Promise<ArrayBuffer> } | null>;
  delete(key: string): Promise<void>;
};

function pathname(key: string) {
  // The database stores generated object names, never arbitrary URLs. Rejecting
  // URLs here also prevents a malformed record from redirecting a private read.
  if (!/^project-files\/[0-9a-f-]{36}$/i.test(key))
    throw new Error('Invalid private file key.');
  return key;
}

export function createPrivateBucket(credentials: string | { storeId: string }): PrivateBucket {
  const auth = typeof credentials === 'string'
    ? { token: credentials }
    : { storeId: credentials.storeId.trim() };
  if (!('token' in auth ? auth.token : auth.storeId))
    throw new Error('Private file storage is not configured.');
  // Store-ID mode lets the SDK resolve a fresh Vercel OIDC token per request.
  // Never cache a short-lived token or fall back to public storage.
  return {
    async put(key, bytes, options) {
      // Copy views into a Buffer so sliced encrypted payloads preserve their
      // byte range and work with both ArrayBuffer and SharedArrayBuffer views.
      const data = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
      await put(pathname(key), Buffer.from(data), {
        ...auth,
        access: 'private',
        addRandomSuffix: false,
        allowOverwrite: false,
        contentType:
          options?.httpMetadata?.contentType || 'application/octet-stream',
      });
    },
    async get(key) {
      const result = await get(pathname(key), { ...auth, access: 'private' });
      if (!result) return null;
      // No conditional read was requested: a 304 is not a usable object.
      if (result.statusCode !== 200)
        throw new Error('Private file storage returned an incomplete object.');
      return { arrayBuffer: () => new Response(result.stream).arrayBuffer() };
    },
    async delete(key) {
      await del(pathname(key), auth);
    },
  };
}
