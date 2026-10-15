import sodium from "libsodium-wrappers-sumo";
import { generateMnemonic, validateMnemonic } from "@scure/bip39";
import { wordlist as englishWordlist } from "@scure/bip39/wordlists/english.js";

const FORMAT_VERSION = 1;
const KEY_BYTES = 32;
const PRIVATE_BUNDLE_ALGORITHM = "xchacha20poly1305-ietf";
const LETTER_ALGORITHM = "xchacha20poly1305-ietf";
const WRAP_ALGORITHM = "xchacha20poly1305-ietf";
const DEVICE_DB_NAME = "barua-device-v1";
const DEVICE_STORE_NAME = "vaults";
const FALLBACK_DEVICE_STORAGE_PREFIX = "barua-device-fallback-v1:";
const DRAFT_DB_NAME = "barua-drafts-v1";
const DRAFT_STORE_NAME = "drafts";
const DRAFT_STORAGE_PREFIX = "barua-draft-v1:";

let sodiumReady;

function ready() {
  sodiumReady ??= sodium.ready;
  return sodiumReady;
}

function encode(bytes) {
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

function decode(value) {
  return sodium.from_base64(value, sodium.base64_variants.URLSAFE_NO_PADDING);
}

function browserCrypto() {
  if (!globalThis.crypto?.subtle || !globalThis.indexedDB) {
    const error = new Error(
      "Secure device storage is unavailable in this browser or browsing mode.",
    );
    error.code = "DEVICE_STORAGE_UNAVAILABLE";
    throw error;
  }
  return globalThis.crypto;
}

function browserLocalStorage() {
  try {
    if (!globalThis.localStorage) {
      throw new Error("Local storage is unavailable.");
    }
    const probeKey = `${FALLBACK_DEVICE_STORAGE_PREFIX}probe`;
    globalThis.localStorage.setItem(probeKey, "1");
    globalThis.localStorage.removeItem(probeKey);
    return globalThis.localStorage;
  } catch (error) {
    const storageError = new Error(
      "Secure browser storage is unavailable in this browsing mode.",
      { cause: error },
    );
    storageError.code = "DEVICE_STORAGE_UNAVAILABLE";
    throw storageError;
  }
}

function fallbackDeviceStorageKey(keyId) {
  return `${FALLBACK_DEVICE_STORAGE_PREFIX}${keyId}`;
}

function readFallbackDeviceRecord(keyId) {
  const storage = browserLocalStorage();
  const value = storage.getItem(fallbackDeviceStorageKey(keyId));
  return value ? JSON.parse(value) : null;
}

function writeFallbackDeviceRecord(record) {
  browserLocalStorage().setItem(
    fallbackDeviceStorageKey(record.key_id),
    JSON.stringify(record),
  );
}

function deleteFallbackDeviceRecord(keyId) {
  browserLocalStorage().removeItem(fallbackDeviceStorageKey(keyId));
}

function openDeviceDatabase() {
  browserCrypto();
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DEVICE_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DEVICE_STORE_NAME, { keyPath: "key_id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readDeviceRecord(keyId) {
  const database = await openDeviceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_STORE_NAME, "readonly");
    const request = transaction.objectStore(DEVICE_STORE_NAME).get(keyId);
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function writeDeviceRecord(record) {
  const database = await openDeviceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_STORE_NAME, "readwrite");
    transaction.objectStore(DEVICE_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function deleteDeviceRecord(keyId) {
  const database = await openDeviceDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DEVICE_STORE_NAME, "readwrite");
    transaction.objectStore(DEVICE_STORE_NAME).delete(keyId);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function draftRecordKey(keyId, draftId) {
  return `${keyId}|${draftId}`;
}

function fallbackDraftStorageKey(keyId, draftId) {
  return `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(keyId)}:${encodeURIComponent(draftId)}`;
}

function openDraftDatabase() {
  if (!globalThis.indexedDB) {
    throw new Error("IndexedDB is unavailable.");
  }
  return new Promise((resolve, reject) => {
    const request = globalThis.indexedDB.open(DRAFT_DB_NAME, 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore(DRAFT_STORE_NAME, {
        keyPath: "draft_key",
      });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readIndexedDraftRecord(keyId, draftId) {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, "readonly");
    const request = transaction.objectStore(DRAFT_STORE_NAME).get(
      draftRecordKey(keyId, draftId),
    );
    request.onsuccess = () => resolve(request.result || null);
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function readIndexedDraftRecords(keyId) {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, "readonly");
    const request = transaction.objectStore(DRAFT_STORE_NAME).getAll();
    request.onsuccess = () => {
      resolve(
        request.result.filter((record) => record.key_id === keyId),
      );
    };
    request.onerror = () => reject(request.error);
    transaction.oncomplete = () => database.close();
    transaction.onerror = () => reject(transaction.error);
  });
}

async function writeIndexedDraftRecord(record) {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
    transaction.objectStore(DRAFT_STORE_NAME).put(record);
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

async function deleteIndexedDraftRecord(keyId, draftId) {
  const database = await openDraftDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(DRAFT_STORE_NAME, "readwrite");
    transaction.objectStore(DRAFT_STORE_NAME).delete(
      draftRecordKey(keyId, draftId),
    );
    transaction.oncomplete = () => {
      database.close();
      resolve();
    };
    transaction.onerror = () => reject(transaction.error);
    transaction.onabort = () => reject(transaction.error);
  });
}

function readFallbackDraftRecord(keyId, draftId) {
  const storage = browserLocalStorage();
  const value = storage.getItem(fallbackDraftStorageKey(keyId, draftId));
  return value ? JSON.parse(value) : null;
}

function readFallbackDraftRecords(keyId) {
  const storage = browserLocalStorage();
  const prefix = `${DRAFT_STORAGE_PREFIX}${encodeURIComponent(keyId)}:`;
  const records = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key && key.startsWith(prefix)) {
      const value = storage.getItem(key);
      if (value) {
        records.push(JSON.parse(value));
      }
    }
  }
  return records;
}

function writeFallbackDraftRecord(record) {
  browserLocalStorage().setItem(
    fallbackDraftStorageKey(record.key_id, record.draft_id),
    JSON.stringify(record),
  );
}

function deleteFallbackDraftRecord(keyId, draftId) {
  browserLocalStorage().removeItem(fallbackDraftStorageKey(keyId, draftId));
}

async function readDraftRecord(keyId, draftId) {
  if (globalThis.indexedDB) {
    try {
      const record = await readIndexedDraftRecord(keyId, draftId);
      if (record) {
        return record;
      }
    } catch (error) {
      // Try the encrypted local-storage fallback below.
    }
  }
  return readFallbackDraftRecord(keyId, draftId);
}

async function readDraftRecords(keyId) {
  const records = new Map();
  if (globalThis.indexedDB) {
    try {
      for (const record of await readIndexedDraftRecords(keyId)) {
        records.set(record.draft_key, record);
      }
    } catch (error) {
      // Try the encrypted local-storage fallback below.
    }
  }
  try {
    for (const record of readFallbackDraftRecords(keyId)) {
      records.set(record.draft_key, record);
    }
  } catch (error) {
    // IndexedDB may still be available even when local storage is blocked.
  }
  return Array.from(records.values());
}

async function writeDraftRecord(record) {
  if (globalThis.indexedDB) {
    try {
      await writeIndexedDraftRecord(record);
      return;
    } catch (error) {
      // Try the encrypted local-storage fallback below.
    }
  }
  writeFallbackDraftRecord(record);
}

async function deleteDraftRecord(keyId, draftId) {
  if (globalThis.indexedDB) {
    try {
      await deleteIndexedDraftRecord(keyId, draftId);
    } catch (error) {
      // The fallback may still contain the record.
    }
  }
  deleteFallbackDraftRecord(keyId, draftId);
}

function textBytes(value) {
  return sodium.from_string(value);
}

export function generateRecoveryPhrase() {
  return generateMnemonic(englishWordlist, 256);
}

export function normalizeRecoveryPhrase(value) {
  if (typeof value !== "string") {
    throw new TypeError("Recovery phrase must be a string.");
  }

  const phrase = value.trim().toLowerCase().split(/\s+/).join(" ");
  if (!validateMnemonic(phrase, englishWordlist)) {
    throw new Error("Recovery phrase is invalid.");
  }
  return phrase;
}

function bytesText(value) {
  return sodium.to_string(value);
}

function canonicalize(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalize).join(",")}]`;
  }

  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalize(value[key])}`)
      .join(",")}}`;
  }

  return JSON.stringify(value);
}

function concatBytes(...parts) {
  const totalLength = parts.reduce((total, part) => total + part.length, 0);
  const result = new Uint8Array(totalLength);
  let offset = 0;

  for (const part of parts) {
    result.set(part, offset);
    offset += part.length;
  }

  return result;
}

function packageFingerprint(encryptionPublicKey, signingPublicKey) {
  const digest = sodium.crypto_generichash(
    32,
    concatBytes(encryptionPublicKey, signingPublicKey),
  );
  return sodium.to_hex(digest).match(/.{1,8}/g).join(" ");
}

function createAad(...parts) {
  return textBytes(["barua", ...parts].join("|"));
}

function encryptWithKey(plaintext, key, aad) {
  const nonce = sodium.randombytes_buf(
    sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES,
  );
  const ciphertext = sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(
    plaintext,
    aad,
    null,
    nonce,
    key,
  );

  return {
    algorithm: PRIVATE_BUNDLE_ALGORITHM,
    ciphertext: encode(ciphertext),
    nonce: encode(nonce),
  };
}

function decryptWithKey(encrypted, key, aad) {
  if (encrypted.algorithm !== PRIVATE_BUNDLE_ALGORITHM) {
    throw new Error("Unsupported Barua encryption algorithm.");
  }

  return sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(
    null,
    decode(encrypted.ciphertext),
    aad,
    decode(encrypted.nonce),
    key,
  );
}

function deriveWrappingKey(secret, salt) {
  return sodium.crypto_pwhash(
    KEY_BYTES,
    secret,
    salt,
    sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    sodium.crypto_pwhash_ALG_ARGON2ID13,
  );
}

function wrapVaultKey(vaultKey, secret, purpose, keyId) {
  const salt = sodium.randombytes_buf(sodium.crypto_pwhash_SALTBYTES);
  const wrappingKey = deriveWrappingKey(secret, salt);
  const encrypted = encryptWithKey(
    vaultKey,
    wrappingKey,
    createAad("vault-key", keyId, purpose),
  );

  sodium.memzero(wrappingKey);

  return {
    ...encrypted,
    purpose,
    salt: encode(salt),
    kdf: "argon2id13",
    kdf_parameters: {
      opslimit: sodium.crypto_pwhash_OPSLIMIT_INTERACTIVE,
      memlimit: sodium.crypto_pwhash_MEMLIMIT_INTERACTIVE,
    },
  };
}

function unwrapVaultKey(wrapped, secret, keyId, expectedPurpose) {
  if (wrapped.purpose !== expectedPurpose || wrapped.kdf !== "argon2id13") {
    throw new Error("Unsupported Barua key-wrapper format.");
  }

  const salt = decode(wrapped.salt);
  const wrappingKey = deriveWrappingKey(secret, salt);

  try {
    return decryptWithKey(
      wrapped,
      wrappingKey,
      createAad("vault-key", keyId, expectedPurpose),
    );
  } finally {
    sodium.memzero(wrappingKey);
  }
}

function makePrivateBundle(identity, vaultKey) {
  const bundle = {
    format_version: FORMAT_VERSION,
    key_id: identity.key_id,
    encryption_public_key: encode(identity.encryption_public_key),
    encryption_private_key: encode(identity.encryption_private_key),
    signing_public_key: encode(identity.signing_public_key),
    signing_private_key: encode(identity.signing_private_key),
  };

  return encryptWithKey(
    textBytes(canonicalize(bundle)),
    vaultKey,
    createAad("private-bundle", identity.key_id, identity.fingerprint),
  );
}

function parsePrivateBundle(encryptedBundle, vaultKey, packageData) {
  const encryptionPublicKey = decode(packageData.encryption_public_key);
  const signingPublicKey = decode(packageData.signing_public_key);

  if (
    packageData.fingerprint !==
    packageFingerprint(encryptionPublicKey, signingPublicKey)
  ) {
    throw new Error("Key package fingerprint does not match its public keys.");
  }

  const plaintext = decryptWithKey(
    encryptedBundle,
    vaultKey,
    createAad(
      "private-bundle",
      packageData.key_id,
      packageData.fingerprint,
    ),
  );
  const bundle = JSON.parse(bytesText(plaintext));

  if (
    bundle.format_version !== FORMAT_VERSION ||
    bundle.key_id !== packageData.key_id ||
    bundle.encryption_public_key !== packageData.encryption_public_key ||
    bundle.signing_public_key !== packageData.signing_public_key
  ) {
    throw new Error("Private-key bundle identity does not match its package.");
  }

  return {
    encryption_public_key: encryptionPublicKey,
    encryption_private_key: decode(bundle.encryption_private_key),
    signing_public_key: signingPublicKey,
    signing_private_key: decode(bundle.signing_private_key),
  };
}

function publicPackage(identity, vaultKey, accountPassword, vaultPassphrase) {
  const packageData = {
    format_version: FORMAT_VERSION,
    key_id: identity.key_id,
    encryption_public_key: encode(identity.encryption_public_key),
    signing_public_key: encode(identity.signing_public_key),
    fingerprint: identity.fingerprint,
    encrypted_private_bundle: makePrivateBundle(identity, vaultKey),
    recovery_wrap: wrapVaultKey(
      vaultKey,
      identity.recovery_phrase,
      "recovery",
      identity.key_id,
    ),
  };

  if (accountPassword) {
    packageData.account_wrap = wrapVaultKey(
      vaultKey,
      accountPassword,
      "account",
      identity.key_id,
    );
  }

  // Keep accepting the old wrapper so existing identities can migrate one
  // device at a time.
  if (vaultPassphrase) {
    packageData.passphrase_wrap = wrapVaultKey(
      vaultKey,
      vaultPassphrase,
      "passphrase",
      identity.key_id,
    );
  }
  return packageData;
}

function assertNonEmptySecret(value, label) {
  if (typeof value !== "string" || value.trim().length < 1) {
    throw new TypeError(`${label} must be a non-empty string.`);
  }
}

export async function createIdentity({
  accountPassword,
  vaultPassphrase,
  recoveryPhrase,
}) {
  await ready();
  if (accountPassword !== undefined) {
    assertNonEmptySecret(accountPassword, "Account password");
  }
  if (vaultPassphrase !== undefined) {
    assertNonEmptySecret(vaultPassphrase, "Vault passphrase");
  }
  const normalizedRecoveryPhrase = normalizeRecoveryPhrase(recoveryPhrase);

  const encryptionKeys = sodium.crypto_box_keypair();
  const signingKeys = sodium.crypto_sign_keypair();
  const keyId = encode(sodium.randombytes_buf(16));
  const fingerprint = packageFingerprint(
    encryptionKeys.publicKey,
    signingKeys.publicKey,
  );
  const vaultKey = sodium.randombytes_buf(KEY_BYTES);
  const identity = {
    key_id: keyId,
    fingerprint,
    encryption_public_key: encryptionKeys.publicKey,
    encryption_private_key: encryptionKeys.privateKey,
    signing_public_key: signingKeys.publicKey,
    signing_private_key: signingKeys.privateKey,
    recovery_phrase: normalizedRecoveryPhrase,
  };

  const packageData = publicPackage(
    identity,
    vaultKey,
    accountPassword,
    vaultPassphrase,
  );
  sodium.memzero(vaultKey);
  return packageData;
}

export async function unlockIdentity(packageData, secret, purpose = "passphrase") {
  await ready();
  assertNonEmptySecret(secret, "Unlock secret");
  const unlockSecret = purpose === "recovery"
    ? normalizeRecoveryPhrase(secret)
    : secret;

  let expectedPurpose = purpose;
  let wrapper;
  if (purpose === "recovery") {
    wrapper = packageData.recovery_wrap;
  } else if (purpose === "account") {
    wrapper = packageData.account_wrap;
  } else {
    wrapper = packageData.passphrase_wrap;
  }
  if (!wrapper) {
    throw new Error(
      purpose === "recovery"
        ? "This Barua identity has no recovery wrapper."
        : "This identity is not set up for account-password unlocking.",
    );
  }
  let vaultKey;

  try {
    vaultKey = unwrapVaultKey(
      wrapper,
      unlockSecret,
      packageData.key_id,
      expectedPurpose,
    );
  } catch (error) {
    throw new Error("Unable to unlock the Barua identity.", { cause: error });
  }

  try {
    return {
      ...parsePrivateBundle(
        packageData.encrypted_private_bundle,
        vaultKey,
        packageData,
      ),
      key_id: packageData.key_id,
      fingerprint: packageData.fingerprint,
      vault_key: vaultKey,
    };
  } catch (error) {
    sodium.memzero(vaultKey);
    throw new Error("Unable to unlock the Barua identity.", { cause: error });
  }
}

async function identityFromVaultKey(packageData, vaultKey) {
  try {
    return {
      ...parsePrivateBundle(
        packageData.encrypted_private_bundle,
        vaultKey,
        packageData,
      ),
      key_id: packageData.key_id,
      fingerprint: packageData.fingerprint,
      vault_key: vaultKey,
    };
  } catch (error) {
    sodium.memzero(vaultKey);
    throw new Error("Unable to unlock the Barua identity.", { cause: error });
  }
}

export async function rememberDevice(packageData, identity) {
  await ready();
  if (!(identity?.vault_key instanceof Uint8Array)) {
    throw new TypeError("An unlocked identity is required to remember a device.");
  }

  try {
    const webCrypto = browserCrypto();
    const deviceKey = await webCrypto.subtle.generateKey(
      { name: "AES-GCM", length: 256 },
      false,
      ["encrypt", "decrypt"],
    );
    const iv = webCrypto.getRandomValues(new Uint8Array(12));
    const wrappedVaultKey = await webCrypto.subtle.encrypt(
      {
        name: "AES-GCM",
        iv,
        additionalData: textBytes(`barua-device|${packageData.key_id}`),
      },
      deviceKey,
      identity.vault_key,
    );

    await writeDeviceRecord({
      key_id: packageData.key_id,
      device_key: deviceKey,
      iv: encode(iv),
      wrapped_vault_key: encode(new Uint8Array(wrappedVaultKey)),
    });
    return;
  } catch (error) {
    // Some valid deployments do not expose persistent Web Crypto storage,
    // such as an insecure local-network origin or restrictive private mode.
    // Keep the server-blind guarantee and remember the browser with a local
    // encrypted fallback instead of making recovery repeat forever.
    const deviceKey = sodium.randombytes_buf(KEY_BYTES);
    try {
      writeFallbackDeviceRecord({
        key_id: packageData.key_id,
        device_key: encode(deviceKey),
        wrapped_vault_key: encryptWithKey(
          identity.vault_key,
          deviceKey,
          createAad("fallback-device", packageData.key_id),
        ),
      });
    } finally {
      sodium.memzero(deviceKey);
    }
  }
}

export async function hasRememberedDevice(packageData) {
  try {
    if (globalThis.indexedDB) {
      if (await readDeviceRecord(packageData.key_id)) {
        return true;
      }
    }
  } catch (error) {
    // Try the portable local-storage fallback below.
  }
  return Boolean(readFallbackDeviceRecord(packageData.key_id));
}

export async function unlockRememberedDevice(packageData) {
  await ready();
  if (globalThis.indexedDB && globalThis.crypto?.subtle) {
    try {
      const record = await readDeviceRecord(packageData.key_id);
      if (record) {
        const vaultKey = new Uint8Array(
          await browserCrypto().subtle.decrypt(
            {
              name: "AES-GCM",
              iv: decode(record.iv),
              additionalData: textBytes(`barua-device|${packageData.key_id}`),
            },
            record.device_key,
            decode(record.wrapped_vault_key),
          ),
        );
        return await identityFromVaultKey(packageData, vaultKey);
      }
    } catch (error) {
      // A stale or unsupported IndexedDB record can fall through to the
      // portable local-storage record below.
    }
  }

  const fallbackRecord = readFallbackDeviceRecord(packageData.key_id);
  if (fallbackRecord) {
    const deviceKey = decode(fallbackRecord.device_key);
    try {
      const vaultKey = decryptWithKey(
        fallbackRecord.wrapped_vault_key,
        deviceKey,
        createAad("fallback-device", packageData.key_id),
      );
      return await identityFromVaultKey(packageData, vaultKey);
    } catch (error) {
      throw new Error("This remembered device could not unlock the identity.", {
        cause: error,
      });
    } finally {
      sodium.memzero(deviceKey);
    }
  }

  const error = new Error("This browser has not been remembered yet.");
  error.code = "DEVICE_NOT_REMEMBERED";
  throw error;
}

export async function addAccountPasswordWrapper(
  packageData,
  identity,
  accountPassword,
) {
  await ready();
  assertNonEmptySecret(accountPassword, "Account password");
  if (
    !identity ||
    identity.key_id !== packageData.key_id ||
    !(identity.vault_key instanceof Uint8Array)
  ) {
    throw new TypeError("A matching unlocked identity is required.");
  }

  return {
    ...packageData,
    account_wrap: wrapVaultKey(
      identity.vault_key,
      accountPassword,
      "account",
      packageData.key_id,
    ),
  };
}

export async function forgetRememberedDevice(packageData) {
  if (globalThis.indexedDB) {
    try {
      await deleteDeviceRecord(packageData.key_id);
    } catch (error) {
      // The fallback may still contain the record.
    }
  }
  try {
    deleteFallbackDeviceRecord(packageData.key_id);
  } catch (error) {
    if (error.code !== "DEVICE_STORAGE_UNAVAILABLE") {
      throw error;
    }
  }
}

function assertDraftIdentity(identity) {
  if (!identity || !(identity.vault_key instanceof Uint8Array)) {
    throw new TypeError("An unlocked identity is required for local drafts.");
  }
}

function assertDraftId(draftId) {
  if (typeof draftId !== "string" || !draftId.trim()) {
    throw new TypeError("A draft ID is required.");
  }
}

function decryptDraftRecord(record, identity) {
  if (
    record.format_version !== FORMAT_VERSION ||
    record.key_id !== identity.key_id ||
    typeof record.draft_id !== "string" ||
    !record.draft_id.trim() ||
    record.draft_key !== draftRecordKey(identity.key_id, record.draft_id)
  ) {
    throw new Error("The saved Barua draft is invalid.");
  }

  const plaintext = decryptWithKey(
    record,
    identity.vault_key,
    createAad("draft", identity.key_id, record.draft_id),
  );
  try {
    return {
      draft_id: record.draft_id,
      plaintext: bytesText(plaintext),
      updated_at: record.updated_at,
    };
  } finally {
    sodium.memzero(plaintext);
  }
}

export async function saveDraft({ identity, draftId, plaintext }) {
  await ready();
  assertDraftIdentity(identity);
  assertDraftId(draftId);
  if (typeof plaintext !== "string") {
    throw new TypeError("Draft plaintext must be a string.");
  }

  const plaintextBytes = textBytes(plaintext);
  try {
    const encrypted = encryptWithKey(
      plaintextBytes,
      identity.vault_key,
      createAad("draft", identity.key_id, draftId),
    );
    const updatedAt = Date.now();
    await writeDraftRecord({
      format_version: FORMAT_VERSION,
      key_id: identity.key_id,
      draft_id: draftId,
      draft_key: draftRecordKey(identity.key_id, draftId),
      ...encrypted,
      updated_at: updatedAt,
    });
    return updatedAt;
  } finally {
    sodium.memzero(plaintextBytes);
  }
}

export async function loadDraft({ identity, draftId }) {
  await ready();
  assertDraftIdentity(identity);
  assertDraftId(draftId);

  const record = await readDraftRecord(identity.key_id, draftId);
  if (!record) {
    return null;
  }
  if (
    record.format_version !== FORMAT_VERSION ||
    record.key_id !== identity.key_id ||
    record.draft_id !== draftId ||
    record.draft_key !== draftRecordKey(identity.key_id, draftId)
  ) {
    throw new Error("The saved Barua draft is invalid.");
  }

  return decryptDraftRecord(record, identity);
}

export async function listDrafts({ identity }) {
  await ready();
  assertDraftIdentity(identity);
  const records = await readDraftRecords(identity.key_id);
  return records
    .map((record) => {
      try {
        return decryptDraftRecord(record, identity);
      } catch (error) {
        return null;
      }
    })
    .filter(Boolean)
    .sort((first, second) => second.updated_at - first.updated_at);
}

export async function deleteDraft({ keyId, draftId }) {
  if (typeof keyId !== "string" || !keyId.trim()) {
    throw new TypeError("A key ID is required to delete a draft.");
  }
  assertDraftId(draftId);
  await deleteDraftRecord(keyId, draftId);
}

export async function recoverIdentity(
  packageData,
  recoveryPhrase,
  newAccountPassword,
) {
  assertNonEmptySecret(newAccountPassword, "New account password");
  const identity = await unlockIdentity(packageData, recoveryPhrase, "recovery");

  try {
    const updated = {
      ...packageData,
      account_wrap: wrapVaultKey(
        identity.vault_key,
        newAccountPassword,
        "account",
        packageData.key_id,
      ),
    };
    delete updated.passphrase_wrap;
    return updated;
  } finally {
    sodium.memzero(identity.vault_key);
  }
}

export async function changeVaultPassphrase(
  packageData,
  currentVaultPassphrase,
  newVaultPassphrase,
) {
  assertNonEmptySecret(newVaultPassphrase, "New vault passphrase");
  const identity = await unlockIdentity(
    packageData,
    currentVaultPassphrase,
    "passphrase",
  );

  try {
    return {
      ...packageData,
      passphrase_wrap: wrapVaultKey(
        identity.vault_key,
        newVaultPassphrase,
        "passphrase",
        packageData.key_id,
      ),
    };
  } finally {
    sodium.memzero(identity.vault_key);
  }
}

function letterEnvelopeWithoutSignature(envelope) {
  const { signature: _signature, ...unsignedEnvelope } = envelope;
  return unsignedEnvelope;
}

export async function encryptLetter({
  plaintext,
  senderIdentity,
  recipientKey,
  letterId = encode(sodium.randombytes_buf(16)),
}) {
  await ready();

  if (!(plaintext instanceof Uint8Array)) {
    throw new TypeError("Letter plaintext must be a Uint8Array.");
  }

  const recipientEncryptionPublicKey = decode(
    recipientKey.encryption_public_key,
  );
  if (
    recipientKey.fingerprint !==
    packageFingerprint(
      recipientEncryptionPublicKey,
      decode(recipientKey.signing_public_key),
    )
  ) {
    throw new Error("Recipient key fingerprint does not match its public keys.");
  }

  const contentKey = sodium.randombytes_buf(KEY_BYTES);
  const aad = createAad(
    "letter",
    letterId,
    senderIdentity.key_id,
    recipientKey.key_id,
    FORMAT_VERSION,
  );
  const encrypted = encryptWithKey(plaintext, contentKey, aad);
  const unsignedEnvelope = {
    format_version: FORMAT_VERSION,
    algorithm: LETTER_ALGORITHM,
    letter_id: letterId,
    sender_key_id: senderIdentity.key_id,
    recipient_key_id: recipientKey.key_id,
    ciphertext: encrypted.ciphertext,
    nonce: encrypted.nonce,
    wrapped_content_key: encode(
      sodium.crypto_box_seal(contentKey, recipientEncryptionPublicKey),
    ),
  };
  const signature = sodium.crypto_sign_detached(
    textBytes(canonicalize(unsignedEnvelope)),
    senderIdentity.signing_private_key,
  );

  sodium.memzero(contentKey);
  return {
    ...unsignedEnvelope,
    signature: encode(signature),
  };
}

export async function decryptLetter({
  envelope,
  recipientIdentity,
  senderKey,
}) {
  await ready();

  if (
    envelope.format_version !== FORMAT_VERSION ||
    envelope.algorithm !== LETTER_ALGORITHM ||
    envelope.recipient_key_id !== recipientIdentity.key_id ||
    envelope.sender_key_id !== senderKey.key_id
  ) {
    throw new Error("Letter identity metadata does not match the recipient.");
  }

  if (
    senderKey.fingerprint !==
    packageFingerprint(
      decode(senderKey.encryption_public_key),
      decode(senderKey.signing_public_key),
    )
  ) {
    throw new Error("Sender key fingerprint does not match its public keys.");
  }

  const validSignature = sodium.crypto_sign_verify_detached(
    decode(envelope.signature),
    textBytes(canonicalize(letterEnvelopeWithoutSignature(envelope))),
    decode(senderKey.signing_public_key),
  );

  if (!validSignature) {
    throw new Error("Letter signature verification failed.");
  }

  const contentKey = sodium.crypto_box_seal_open(
    decode(envelope.wrapped_content_key),
    recipientIdentity.encryption_public_key,
    recipientIdentity.encryption_private_key,
  );

  try {
    return decryptWithKey(
      {
        algorithm: envelope.algorithm,
        ciphertext: envelope.ciphertext,
        nonce: envelope.nonce,
      },
      contentKey,
      createAad(
        "letter",
        envelope.letter_id,
        envelope.sender_key_id,
        envelope.recipient_key_id,
        FORMAT_VERSION,
      ),
    );
  } finally {
    sodium.memzero(contentKey);
  }
}

export function toBytes(value) {
  return textBytes(value);
}

export function fromBytes(value) {
  return bytesText(value);
}

export function clearIdentity(identity) {
  for (const field of [
    "encryption_private_key",
    "signing_private_key",
    "vault_key",
  ]) {
    if (identity[field]) {
      sodium.memzero(identity[field]);
    }
  }
}
