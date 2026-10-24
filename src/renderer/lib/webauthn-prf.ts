// ============================================================
// Nexus SSH Client — WebAuthn PRF helper (renderer side)
//
// FIDO2 keys with the hmac-secret extension expose it to web pages
// through the WebAuthn `prf` extension. We use the deterministic
// 32-byte PRF output as a key-wrapping key for the vault DEK.
//
// Flow:
//   enroll() → navigator.credentials.create({ ..., extensions: { prf: {} } })
//            → immediately follow with a get() that supplies a salt
//              (some authenticators only return PRF results during get())
//            → returns { credentialId, prfSalt, prfOutput, rpId, userHandle }
//
//   assert(info) → navigator.credentials.get({
//                    allowCredentials: [{ id: credentialId }],
//                    extensions: { prf: { eval: { first: prfSalt } } }
//                  })
//                → returns { prfOutput }
//
// All binary values cross the IPC boundary as base64 strings.
// ============================================================

const RP_NAME = 'Nexus SSH';

/**
 * The relying-party ID is the registrable domain of the page origin.
 * In Electron dev (Vite) the origin is http://localhost:5173 so
 * `localhost` is correct. In production the renderer is served via
 * a custom `app://nexus/...` URL, where the host becomes `nexus`.
 */
function getRpId(): string {
  return window.location.hostname || 'nexus';
}

function bufToBase64(buf: ArrayBuffer | Uint8Array): string {
  const bytes = buf instanceof Uint8Array ? buf : new Uint8Array(buf);
  let str = '';
  for (let i = 0; i < bytes.byteLength; i++) {
    str += String.fromCharCode(bytes[i]);
  }
  return btoa(str);
}

function base64ToBuf(b64: string): Uint8Array {
  const bin = atob(b64);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out;
}

function bufToBase64Url(buf: ArrayBuffer | Uint8Array): string {
  return bufToBase64(buf)
    .replace(/\+/g, '-')
    .replace(/\//g, '_')
    .replace(/=+$/, '');
}

function randomBytes(n: number): Uint8Array {
  const out = new Uint8Array(n);
  crypto.getRandomValues(out);
  return out;
}

/**
 * Wider PublicKeyCredentialCreationOptions to include the PRF extension —
 * lib.dom.d.ts doesn't model it yet across all TS versions.
 */
type PrfExtensionInputs = {
  prf?: {
    eval?: { first: BufferSource; second?: BufferSource };
  };
};
type PrfExtensionResults = {
  prf?: {
    enabled?: boolean;
    results?: { first?: ArrayBuffer; second?: ArrayBuffer };
  };
};

export interface EnrollResult {
  credentialId: string;
  prfSalt: string;
  prfOutput: string;
  rpId: string;
  userHandle: string;
}

export interface CredentialInfo {
  credentialId: string;
  prfSalt: string;
  rpId: string;
}

export interface AssertResult {
  prfOutput: string;
}

/**
 * Register a new resident credential on a hardware key, evaluate the PRF
 * extension, and return everything the main process needs to wrap the DEK.
 *
 * Throws if the key, browser, or platform doesn't support PRF.
 */
export async function enroll(displayName: string): Promise<EnrollResult> {
  if (!('credentials' in navigator)) {
    throw new Error('WebAuthn is not available in this environment.');
  }

  const rpId = getRpId();
  const userHandle = randomBytes(16);
  const prfSalt = randomBytes(32);
  const createChallenge = randomBytes(32);

  const createOptions = {
    rp: { id: rpId, name: RP_NAME },
    user: {
      id: userHandle,
      name: displayName,
      displayName,
    },
    pubKeyCredParams: [
      { type: 'public-key', alg: -7 }, // ES256
      { type: 'public-key', alg: -257 }, // RS256
    ],
    challenge: createChallenge,
    timeout: 60_000,
    authenticatorSelection: {
      userVerification: 'preferred',
      residentKey: 'preferred',
    },
    attestation: 'none',
    extensions: {
      prf: {
        eval: { first: prfSalt },
      },
    } as PrfExtensionInputs,
  } as unknown as PublicKeyCredentialCreationOptions;

  const cred = (await navigator.credentials.create({
    publicKey: createOptions,
  })) as PublicKeyCredential | null;

  if (!cred) {
    throw new Error('Hardware-key registration was cancelled.');
  }

  const credentialIdBuf = new Uint8Array(cred.rawId);

  // Some authenticators evaluate PRF during create(); others only during
  // get(). Try to read it from create() first, then fall back to an
  // immediate assertion. Either path produces the same deterministic
  // 32-byte output for the (credential, salt) pair.
  let prfOutput: ArrayBuffer | undefined;
  const createExt = cred.getClientExtensionResults() as PrfExtensionResults;
  if (createExt.prf?.results?.first) {
    prfOutput = createExt.prf.results.first;
  } else if (createExt.prf?.enabled === false) {
    throw new Error(
      'This hardware key does not support the PRF / hmac-secret extension. Try a YubiKey 5 (firmware 5.2+), Trezor Safe, or another modern FIDO2 key.',
    );
  }

  if (!prfOutput) {
    const assertion = await assertWithCredential({
      credentialId: bufToBase64(credentialIdBuf),
      prfSalt: bufToBase64(prfSalt),
      rpId,
    });
    prfOutput = base64ToBuf(assertion.prfOutput).buffer as ArrayBuffer;
  }

  const prfBytes = new Uint8Array(prfOutput);
  if (prfBytes.byteLength !== 32) {
    throw new Error(
      `PRF output was ${prfBytes.byteLength} bytes (expected 32). The hardware key may not implement hmac-secret correctly.`,
    );
  }

  return {
    credentialId: bufToBase64(credentialIdBuf),
    prfSalt: bufToBase64(prfSalt),
    prfOutput: bufToBase64(prfBytes),
    rpId,
    userHandle: bufToBase64Url(userHandle),
  };
}

/**
 * Drive a WebAuthn assertion against a known credential and evaluate
 * the PRF extension with the stored salt.
 */
export async function assertWithCredential(info: CredentialInfo): Promise<AssertResult> {
  if (!('credentials' in navigator)) {
    throw new Error('WebAuthn is not available in this environment.');
  }

  const allowCredentials = [
    {
      type: 'public-key' as const,
      id: base64ToBuf(info.credentialId),
      transports: ['usb', 'nfc', 'ble', 'hybrid', 'internal'] as AuthenticatorTransport[],
    },
  ];

  const challenge = randomBytes(32);
  const prfSalt = base64ToBuf(info.prfSalt);

  const getOptions = {
    rpId: info.rpId,
    challenge,
    allowCredentials,
    timeout: 60_000,
    userVerification: 'preferred',
    extensions: {
      prf: { eval: { first: prfSalt } },
    } as PrfExtensionInputs,
  } as unknown as PublicKeyCredentialRequestOptions;

  const assertion = (await navigator.credentials.get({
    publicKey: getOptions,
  })) as PublicKeyCredential | null;

  if (!assertion) {
    throw new Error('Hardware-key authentication was cancelled.');
  }

  const ext = assertion.getClientExtensionResults() as PrfExtensionResults;
  const out = ext.prf?.results?.first;
  if (!out) {
    throw new Error(
      'Hardware key did not return a PRF result. The credential may have been registered without PRF support.',
    );
  }

  const bytes = new Uint8Array(out);
  if (bytes.byteLength !== 32) {
    throw new Error(`PRF output was ${bytes.byteLength} bytes (expected 32).`);
  }

  return { prfOutput: bufToBase64(bytes) };
}

export function isWebAuthnAvailable(): boolean {
  return (
    typeof window !== 'undefined' &&
    'credentials' in navigator &&
    typeof (navigator.credentials as unknown as { create?: unknown }).create === 'function'
  );
}
