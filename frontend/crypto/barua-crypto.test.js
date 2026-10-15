import assert from "node:assert/strict";
import { test } from "node:test";

import {
  changeVaultPassphrase,
  addAccountPasswordWrapper,
  clearIdentity,
  createIdentity,
  decryptLetter,
  deleteDraft,
  encryptLetter,
  fromBytes,
  generateRecoveryPhrase,
  forgetRememberedDevice,
  hasRememberedDevice,
  listDrafts,
  loadDraft,
  rememberDevice,
  recoverIdentity,
  saveDraft,
  toBytes,
  unlockIdentity,
  unlockRememberedDevice,
} from "./barua-crypto.js";

const senderPassphrase = "sender vault passphrase";
const senderAccountPassword = "sender account password";
const senderRecoveryPhrase = generateRecoveryPhrase();
const recipientPassphrase = "recipient vault passphrase";
const recipientRecoveryPhrase = generateRecoveryPhrase();

test("creates an identity that can be unlocked by its vault passphrase", async () => {
  const packageData = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const identity = await unlockIdentity(packageData, senderPassphrase);

  assert.equal(identity.key_id, packageData.key_id);
  assert.equal(identity.fingerprint, packageData.fingerprint);
  assert.equal(identity.encryption_private_key.length, 32);
  clearIdentity(identity);
});

test("creates an identity that can be unlocked by its account password", async () => {
  const packageData = await createIdentity({
    accountPassword: senderAccountPassword,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const identity = await unlockIdentity(
    packageData,
    senderAccountPassword,
    "account",
  );

  assert.ok(packageData.account_wrap);
  assert.equal(packageData.passphrase_wrap, undefined);
  assert.equal(identity.key_id, packageData.key_id);
  clearIdentity(identity);
});

test("creates a recovery-only identity for automatic device unlocking", async () => {
  const packageData = await createIdentity({
    recoveryPhrase: senderRecoveryPhrase,
  });
  const identity = await unlockIdentity(
    packageData,
    senderRecoveryPhrase,
    "recovery",
  );

  assert.equal(packageData.passphrase_wrap, undefined);
  assert.equal(identity.key_id, packageData.key_id);
  clearIdentity(identity);
});

test("remembers a device through the browser-storage fallback", async () => {
  const records = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    get length() {
      return records.size;
    },
    getItem: (key) => records.get(key) ?? null,
    key: (index) => Array.from(records.keys())[index] ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };

  try {
    const packageData = await createIdentity({
      recoveryPhrase: senderRecoveryPhrase,
    });
    const identity = await unlockIdentity(
      packageData,
      senderRecoveryPhrase,
      "recovery",
    );
    await rememberDevice(packageData, identity);
    assert.equal(await hasRememberedDevice(packageData), true);

    const rememberedIdentity = await unlockRememberedDevice(packageData);
    assert.equal(rememberedIdentity.key_id, packageData.key_id);
    clearIdentity(identity);
    clearIdentity(rememberedIdentity);
    await forgetRememberedDevice(packageData);
    assert.equal(await hasRememberedDevice(packageData), false);
  } finally {
    if (previousStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousStorage;
    }
  }
});

test("adds an account-password wrapper to a legacy identity", async () => {
  const packageData = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const identity = await unlockIdentity(packageData, senderPassphrase);
  const migratedPackage = await addAccountPasswordWrapper(
    packageData,
    identity,
    senderAccountPassword,
  );
  const migratedIdentity = await unlockIdentity(
    migratedPackage,
    senderAccountPassword,
    "account",
  );

  assert.ok(migratedPackage.account_wrap);
  assert.equal(migratedIdentity.key_id, packageData.key_id);
  clearIdentity(identity);
  clearIdentity(migratedIdentity);
});

test("rejects the wrong vault passphrase", async () => {
  const packageData = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });

  await assert.rejects(
    unlockIdentity(packageData, "wrong passphrase"),
    /Unable to unlock|verification failed|operation failed/i,
  );
});

test("recovers the same identity and creates an account-password wrapper", async () => {
  const packageData = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const recoveredPackage = await recoverIdentity(
    packageData,
    senderRecoveryPhrase,
    senderAccountPassword,
  );
  const identity = await unlockIdentity(recoveredPackage, senderAccountPassword, "account");

  assert.equal(recoveredPackage.key_id, packageData.key_id);
  assert.equal(recoveredPackage.fingerprint, packageData.fingerprint);
  clearIdentity(identity);
});

test("changes a vault passphrase without changing the cryptographic identity", async () => {
  const packageData = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const changedPackage = await changeVaultPassphrase(
    packageData,
    senderPassphrase,
    "another sender vault passphrase",
  );
  const identity = await unlockIdentity(
    changedPackage,
    "another sender vault passphrase",
  );

  assert.equal(changedPackage.key_id, packageData.key_id);
  assert.equal(changedPackage.fingerprint, packageData.fingerprint);
  clearIdentity(identity);
});

test("encrypts, signs, verifies, and decrypts a letter for the recipient", async () => {
  const senderPackage = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const recipientPackage = await createIdentity({
    vaultPassphrase: recipientPassphrase,
    recoveryPhrase: recipientRecoveryPhrase,
  });
  const senderIdentity = await unlockIdentity(senderPackage, senderPassphrase);
  const recipientIdentity = await unlockIdentity(
    recipientPackage,
    recipientPassphrase,
  );
  const envelope = await encryptLetter({
    plaintext: toBytes("A private letter from Alice to Bob."),
    senderIdentity,
    recipientKey: recipientPackage,
  });
  const plaintext = await decryptLetter({
    envelope,
    recipientIdentity,
    senderKey: senderPackage,
  });

  assert.equal(fromBytes(plaintext), "A private letter from Alice to Bob.");
  assert.notEqual(envelope.ciphertext, "A private letter from Alice to Bob.");
  clearIdentity(senderIdentity);
  clearIdentity(recipientIdentity);
});

test("rejects a tampered letter", async () => {
  const senderPackage = await createIdentity({
    vaultPassphrase: senderPassphrase,
    recoveryPhrase: senderRecoveryPhrase,
  });
  const recipientPackage = await createIdentity({
    vaultPassphrase: recipientPassphrase,
    recoveryPhrase: recipientRecoveryPhrase,
  });
  const senderIdentity = await unlockIdentity(senderPackage, senderPassphrase);
  const recipientIdentity = await unlockIdentity(
    recipientPackage,
    recipientPassphrase,
  );
  const envelope = await encryptLetter({
    plaintext: toBytes("Do not alter this letter."),
    senderIdentity,
    recipientKey: recipientPackage,
  });
  envelope.ciphertext = `${envelope.ciphertext.slice(0, -1)}A`;

  await assert.rejects(
    decryptLetter({
      envelope,
      recipientIdentity,
      senderKey: senderPackage,
    }),
    /signature verification failed|operation failed/i,
  );
  clearIdentity(senderIdentity);
  clearIdentity(recipientIdentity);
});

test("saves and deletes an encrypted local draft", async () => {
  const records = new Map();
  const previousStorage = globalThis.localStorage;
  globalThis.localStorage = {
    get length() {
      return records.size;
    },
    getItem: (key) => records.get(key) ?? null,
    key: (index) => Array.from(records.keys())[index] ?? null,
    setItem: (key, value) => records.set(key, value),
    removeItem: (key) => records.delete(key),
  };

  try {
    const packageData = await createIdentity({
      accountPassword: senderAccountPassword,
      recoveryPhrase: senderRecoveryPhrase,
    });
    const identity = await unlockIdentity(
      packageData,
      senderAccountPassword,
      "account",
    );
    const plaintext = JSON.stringify({
      format_version: 1,
      markup: "Dear Bob,\nI will finish this letter tomorrow.",
    });

    await saveDraft({
      identity,
      draftId: "writing-desk",
      plaintext,
    });
    assert.equal(
      Array.from(records.values()).some((value) => value.includes(plaintext)),
      false,
    );

    const saved = await loadDraft({
      identity,
      draftId: "writing-desk",
    });
    assert.equal(saved.plaintext, plaintext);
    assert.equal((await listDrafts({ identity })).length, 1);

    await deleteDraft({
      keyId: identity.key_id,
      draftId: "writing-desk",
    });
    assert.equal(
      await loadDraft({ identity, draftId: "writing-desk" }),
      null,
    );
    clearIdentity(identity);
  } finally {
    if (previousStorage === undefined) {
      delete globalThis.localStorage;
    } else {
      globalThis.localStorage = previousStorage;
    }
  }
});
