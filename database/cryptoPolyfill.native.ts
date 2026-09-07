import * as Crypto from 'expo-crypto';
import {
  assertWebCryptoSurface,
  defineOn,
  isFunction,
  readGlobalCrypto,
  verifyWebCryptoDigest,
  type GlobalCrypto,
} from './cryptoReady';

function toExpoDigestAlgorithm(algorithm: AlgorithmIdentifier): Crypto.CryptoDigestAlgorithm {
  const name = typeof algorithm === 'string' ? algorithm : algorithm.name;
  switch (name) {
    case Crypto.CryptoDigestAlgorithm.SHA1:
    case Crypto.CryptoDigestAlgorithm.SHA256:
    case Crypto.CryptoDigestAlgorithm.SHA384:
    case Crypto.CryptoDigestAlgorithm.SHA512:
      return name;
    default:
      throw new Error(`[crypto][init] Unsupported digest algorithm: ${String(name)}`);
  }
}

async function digestWithExpo(algorithm: AlgorithmIdentifier, data: BufferSource): Promise<ArrayBuffer> {
  return Crypto.digest(toExpoDigestAlgorithm(algorithm), data);
}

function installCryptoPolyfill(): void {
  let cryptoObj = readGlobalCrypto();
  if (!cryptoObj) {
    cryptoObj = {} as GlobalCrypto;
    defineOn(globalThis, 'crypto', cryptoObj);
  }

  if (!isFunction(cryptoObj.getRandomValues)) {
    defineOn(cryptoObj, 'getRandomValues', Crypto.getRandomValues.bind(Crypto));
  }

  if (!isFunction(cryptoObj.randomUUID)) {
    defineOn(cryptoObj, 'randomUUID', Crypto.randomUUID.bind(Crypto));
  }

  const subtle = cryptoObj.subtle as { digest?: unknown } | undefined;
  if (!subtle || typeof subtle !== 'object') {
    defineOn(cryptoObj, 'subtle', { digest: digestWithExpo });
  } else if (!isFunction(subtle.digest)) {
    defineOn(subtle, 'digest', digestWithExpo);
  }
}

installCryptoPolyfill();
assertWebCryptoSurface();

export { verifyWebCryptoDigest };
