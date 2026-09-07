export type GlobalCrypto = typeof globalThis extends { crypto: infer T } ? T : {
  getRandomValues: (array: ArrayBufferView) => ArrayBufferView;
  randomUUID: () => string;
  subtle: { digest: (algorithm: AlgorithmIdentifier, data: BufferSource) => Promise<ArrayBuffer> };
};

export function isFunction(value: unknown): value is (...args: never[]) => unknown {
  return typeof value === 'function';
}

export function readGlobalCrypto(): GlobalCrypto | undefined {
  try {
    const value = (globalThis as { crypto?: GlobalCrypto }).crypto;
    return value && typeof value === 'object' ? value : undefined;
  } catch {
    return undefined;
  }
}

export function defineOn<T extends object, K extends PropertyKey>(target: T, key: K, value: unknown): void {
  Object.defineProperty(target, key, {
    configurable: true,
    enumerable: true,
    writable: true,
    value,
  });
}

export function assertWebCryptoSurface(): void {
  const cryptoObj = readGlobalCrypto();
  const missing: string[] = [];
  if (!cryptoObj) {
    missing.push('crypto');
  } else {
    if (!isFunction(cryptoObj.getRandomValues)) missing.push('crypto.getRandomValues');
    if (!isFunction(cryptoObj.randomUUID)) missing.push('crypto.randomUUID');
    if (!cryptoObj.subtle) missing.push('crypto.subtle');
    else if (!isFunction(cryptoObj.subtle.digest)) missing.push('crypto.subtle.digest');
  }

  if (missing.length > 0) {
    const message = `[crypto][init] Web Crypto polyfill is incomplete (${missing.join(', ')})`;
    console.error(message);
    throw new Error(message);
  }

  if (typeof __DEV__ !== 'undefined' && __DEV__) {
    console.info('[crypto][init] Web Crypto ready');
  }
}

export async function verifyWebCryptoDigest(): Promise<void> {
  if (typeof __DEV__ === 'undefined' || !__DEV__) return;

  const cryptoObj = readGlobalCrypto();
  if (
    !cryptoObj ||
    !isFunction(cryptoObj.getRandomValues) ||
    !isFunction(cryptoObj.randomUUID) ||
    !cryptoObj.subtle ||
    !isFunction(cryptoObj.subtle.digest)
  ) {
    const message = '[crypto][init] Web Crypto polyfill is incomplete';
    console.error(message);
    throw new Error(message);
  }

  const digest = await cryptoObj.subtle.digest('SHA-256', new TextEncoder().encode('spendwise'));
  if (!(digest instanceof ArrayBuffer) || digest.byteLength !== 32) {
    const message = '[crypto][init] Web Crypto polyfill is incomplete';
    console.error(message);
    throw new Error(message);
  }
}
