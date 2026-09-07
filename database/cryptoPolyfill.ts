// Web/Node keep the existing Web Crypto implementation.
// Android/iOS load cryptoPolyfill.native.ts and fill missing APIs with expo-crypto.
import { assertWebCryptoSurface, verifyWebCryptoDigest } from './cryptoReady';

assertWebCryptoSurface();

export { verifyWebCryptoDigest };
