# Barua — Project Overview (Updated: Encryption & Recovery Model)

## 1. Purpose

Barua is a privacy-first web application for long-form digital letter writing between trusted individuals. It prioritizes intentional communication, delayed delivery, and strong privacy guarantees.

---

## 2. Core Principles

* Long-form only (no chat or short messages)
* Delayed delivery (5–14 days randomized)
* Ephemeral server storage (delivery-focused, not archival)
* Privacy-first by design (server cannot read letters)
* Intentional, distraction-free experience

---

## 3. Letter Storage Model

Barua is a **delivery system, not a storage platform**.

### Lifecycle

1. Letter is written and encrypted client-side
2. Stored encrypted on server during transit
3. Delivered after delay
4. User opens the envelope and decrypts it in the browser
5. Server retains encrypted copy for **7 days after successful opening**
6. Unopened letters expire after a **30-day maximum retention period**
7. After retention → permanently deleted

### Implications

* No permanent inbox
* No server-side archives
* Users are responsible for storing letters locally

---

## 4. Encryption Model (Core Requirement)

Barua uses **end-to-end encryption from v1**.

### Key Principles

* Letters are encrypted in the sender’s browser
* Server only stores encrypted data (ciphertext)
* Server cannot decrypt letters
* Decryption happens only in the recipient’s browser

---

## 5. Cryptographic Architecture

### 5.1 User Keys

* Each user has a **public/private encryption keypair** and a signing keypair
* Public key:

  * Stored on server
  * Used by others to encrypt letters
* Private key:

  * Never stored in plaintext on server
  * Stored inside an encrypted package
  * Unlocked automatically on a remembered browser
* Each identity has a stable key ID and human-readable fingerprint

---

### 5.2 Letter Encryption Flow

1. Sender writes letter
2. Letter is converted to PDF (client-side)
3. App generates a one-time symmetric key
4. PDF is encrypted using that key (AES-GCM)
5. Symmetric key is encrypted using recipient’s public key
6. Server stores:

   * encrypted PDF
   * encrypted symmetric key
   * metadata (timestamps, IDs)

---

### 5.3 Decryption Flow

1. Recipient downloads encrypted package
2. Browser uses private key to decrypt symmetric key
3. Symmetric key decrypts PDF
4. PDF is opened/downloaded locally

---

## 6. Key Management

### 6.1 Private Key Storage

* Private keys are encrypted client-side with a random vault key
* The vault key is wrapped using the account password and recovery phrase in
  the browser, with an optional non-exportable browser device key locally

* The account password unlocks the letterbox after login, so users do not enter
  a second daily passphrase
* See `key-management.md` for the package format and recovery flow

### 6.2 Critical Rule

Barua must never be able to reconstruct a user’s private key without user-provided secrets.

---

## 7. Authentication & Recovery Model

### 7.1 Account Password Role

* Used to authenticate the Django account
* Also unlocks the private key bundle locally after login
* Is not stored by Barua as a plaintext encryption key

---

### 7.2 Remembered Browser

* A trusted browser stores a non-exportable device key locally
* Signing in then unlocks the letterbox automatically
* Shared computers should not be remembered

---

### 7.3 Recovery Phrase

At account creation:

* User is given a **recovery phrase**
* Must be saved by the user
* Used to recover access to the private key

---

### 7.4 Recovery Flow

If the user uses a new browser or loses remembered-device storage:

1. User authenticates the Django account
2. User provides the recovery phrase only in the dedicated forgotten-password
   recovery flow
3. Browser decrypts the existing private key
4. Browser creates a new account-password wrapper and local remembered-device
   record

**Important:**

* No new keypair is generated
* Existing letters remain accessible

---

### 7.5 Loss Scenario

If user loses:

* all remembered devices **and**
* recovery phrase

Then:

* private key is unrecoverable
* in-transit and undelivered letters cannot be decrypted
* user must generate a new keypair (new cryptographic identity)

---

## 8. Key Identity Rule

* A user’s identity is tied to their **keypair**
* Recovering account = restoring same keypair
* Generating new keypair = new identity

---

## 9. System Behavior Rules

* Letters are always encrypted before reaching server
* Server never handles plaintext letter content
* Letters cannot be decrypted without private key
* No backdoor or admin access to user content
* All cryptographic operations occur client-side

---

## 10. UX Requirements

### 10.1 User Warnings

Users must be clearly informed:

* Barua cannot read your letters
* Barua cannot recover your letters without your recovery phrase
* Losing all remembered devices and the recovery phrase means permanent loss of access

These warnings must appear:

* during signup
* when recovery phrase is generated

---

### 10.2 Reading Experience

* Letters are delivered as PDFs
* Reading happens after download
* No persistent in-app reading archive

---

## 11. Non-Goals

* Real-time messaging
* Permanent cloud storage of letters
* Social features (feeds, discovery)
* Server-side access to user content
* Account recovery that bypasses encryption guarantees

---

## 12. Design Philosophy Summary

Barua prioritizes:

* privacy over convenience
* intentionality over speed
* ownership over centralization

The system is designed so that:

> Even the platform owner cannot read user correspondence.

---
