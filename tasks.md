# Barua — Development Task Breakdown

## Guiding Rule for All Tasks

All code must be:

* Human-readable (clear variable and function names)
* Well-organized (logical structure, separation of concerns)
* Commented where intent is not obvious
* Written for maintainability over cleverness

Avoid:

* overly abstract or “clever” code
* unnecessary one-liners
* unclear naming

---

## Phase 0 — Project Setup

### Task 0.1 — Initialize Backend Project

* Create Django project and core app structure
* Split settings into:

  * base
  * development
  * production
* Add `.env` support for secrets

### Task 0.2 — Dev Tooling

* Configure:

  * linting (ruff or equivalent)
  * formatting
  * pre-commit hooks
* Add basic Makefile commands:

  * run server
  * lint
  * test

### Task 0.3 — Database Setup

* Configure PostgreSQL
* Ensure connection via environment variables

---

## Phase 1 — Core Models (No Encryption Yet)

### Task 1.1 — User Model Extension

* Extend Django user model (or custom user model)
* Fields:

  * email (unique)
  * created_at

### Task 1.2 — Contact Model

* Represents trusted relationships
* Fields:

  * user_a
  * user_b
  * created_at
  * status

### Task 1.3 — Connection Code Model

* Fields:

  * code (unique)
  * created_by
  * expires_at
  * used (boolean)

### Task 1.4 — Letter Model (Basic)

* Fields:

  * sender
  * recipient
  * encrypted_file (placeholder for now)
  * delivery_timestamp
  * downloaded (boolean)
  * deletion_timestamp

---

## Phase 2 — Contact Handshake System

### Task 2.1 — Generate Connection Code

* Endpoint to create one-time code
* Add expiration logic

### Task 2.2 — Accept Connection Code

* Endpoint to input code
* Validate:

  * exists
  * not expired
  * not used
* Create Contact record

### Task 2.3 — Prevent Duplicate Contacts

* Ensure same pair cannot be created twice

*Implemented: connection records snapshot public-key fingerprints. New
connections are usable immediately when keys remain current; fingerprints are
available for optional advanced manual verification, and key changes block
sending.*

---

## Phase 3 — Basic Letter Flow (No Encryption)

### Task 3.1 — Create Letter Endpoint

* Accept:

  * sender
  * recipient
  * file (temporary plaintext for testing only)
* Assign a random delivery delay from configuration

### Task 3.2 — Delivery Logic

* Store delivery timestamp
* Endpoint to fetch available letters:

  * only return letters where `delivery_timestamp <= now`

* Implemented testing mode: randomly deliver after 1–10 minutes
* Production configuration: randomly deliver after 3–14 days

### Task 3.3 — Download Endpoint

* Allow recipient to download file
* Mark `downloaded = True` after the browser successfully opens the envelope
* Set deletion timestamp (currently now + 7 days)

### Task 3.4 — Cleanup Job

* Background job:

  * deletes letters past deletion timestamp

---

## Phase 4 — Frontend Experience

### Task 4.1 — App Setup

* Build the shared Django-rendered app shell
* Establish the Barua visual system: paper, ink, postal marks, and responsive layout
* Use focused browser JavaScript for interactions that need it

### Task 4.2 — Authentication Pages

* Register
* Login

*Implemented with a shared responsive shell and account setup explanations.*

### Task 4.3 — Dashboard

* List:

  * contacts
  * incoming letters (delivered only)

*The first visual letterbox pass is implemented, including correspondent cards,
envelope states, transit treatment, and a privacy footer.*

### Task 4.4 — Letter Composer UI

* Simple text editor
* Send button

*Implemented as a paper-like writing desk with a recipient line, sealed-post
action, and empty-state guidance.*

---

## Phase 5 — Introduce Encryption (Critical Phase)

### Task 5.1 — Keypair Generation (Client-Side)

* Generate public/private keypair in browser
* Store:

  * public key → server
  * private key → encrypted locally

### Task 5.2 — Vault Key Protection

* Generate a random vault key client-side
* Wrap the random vault key with the account password and recovery phrase
* Encrypt the private key bundle with the vault key
* Store only the encrypted bundle and account/recovery wrappers on the server
* Implemented: a remembered browser stores the vault key under a non-exportable
  Web Crypto AES-GCM device key in IndexedDB
* Target standards-based Chrome/Chromium, Edge, Firefox, Safari, and mobile
  browsers without user-agent-specific behavior
* Fall back to the account password when secure persistent browser storage is absent

### Task 5.3 — Recovery Phrase Generation

* Generate recovery phrase at signup
* Use it as the offline recovery wrapper for the vault key; do not request it for
  ordinary letter operations
* Use a 24-word English BIP39 phrase with checksum validation
* Display once and require manual confirmation

### Task 5.4 — Cryptographic Identity

* Generate a signing keypair alongside the encryption keypair
* Store public keys, key ID, and fingerprint on the server
* Keep private keys inside the encrypted private-key bundle

---

## Phase 6 — Encrypt Letter Flow

### Task 6.1 — Client-Side PDF Generation

* Convert composed letter to PDF in browser

### Task 6.2 — Encrypt PDF

* Generate random symmetric key
* Encrypt PDF using the selected authenticated-encryption primitive
  (XChaCha20-Poly1305-IETF)

### Task 6.3 — Encrypt Symmetric Key

* Fetch recipient public key
* Encrypt symmetric key with it

### Task 6.4 — Upload Encrypted Package

* Send:

  * encrypted PDF
  * encrypted symmetric key
  * metadata

*The first implementation slice currently sends encrypted text envelopes;
browser PDF generation remains pending. The composer now unlocks through the
remembered browser device key or the account password from the login session;
it does not ask for the recovery phrase.*

---

## Phase 7 — Decryption Flow

### Task 7.1 — Download Encrypted Letter

* Fetch encrypted payload from server

### Task 7.2 — Decrypt Symmetric Key

* Use private key in browser

### Task 7.3 — Decrypt PDF

* Use symmetric key

### Task 7.4 — Deliver to User

* Trigger browser download of decrypted PDF

*Implemented for encrypted text letters: the recipient-only reader fetches the
opaque envelope, unlocks the recipient identity in the browser, verifies the
sender signature, displays the decrypted text, and offers a local readable
copy. PDF support remains
pending.*

---

## Phase 8 — Recovery System

### Task 8.1 — Account-password unlock

* Derive an account wrapper key in the browser
* Unlock the letterbox after ordinary account login
* Keep recovery out of the composer and envelope views

### Task 8.2 — Recovery Phrase Unlock

* Input recovery phrase
* Decrypt private key

### Task 8.3 — Remembered-device and recovery flow

* Generate a non-exportable browser device key
* Wrap the vault key locally in IndexedDB
* Enroll a new browser with the account password
* Reserve the recovery phrase for forgotten-password recovery

### Task 8.4 — Edge Case Handling

* If the recovery phrase and all remembered devices are lost:

  * generate new keypair
  * clearly warn user

---

## Phase 9 — Finalize Letter Lifecycle

### Task 9.1 — First Successful Opening Detection

* Track the first successful local opening acknowledgement

### Task 9.2 — Deletion Timer

* Start seven-day countdown after successful local opening
* Delete unopened envelopes after the 30-day maximum retention period

### Task 9.3 — Ensure No Plaintext Storage

* Verify:

  * server never stores decrypted PDFs
  * logs do not leak content

---

## Phase 10 — UX Polish & Safety

### Task 10.1 — User Warnings

* During signup:

  * explain recovery phrase importance
* During reset:

  * explain consequences

### Task 10.2 — Minimal UI

* Remove unnecessary elements
* Keep interface calm and focused

---

## Phase 11 — Testing

### Task 11.1 — Unit Tests

* Models
* Encryption utilities

### Task 11.2 — Integration Tests

* Full letter flow:

  * send → delay → decrypt → download → delete

### Task 11.3 — Failure Cases

* Wrong password
* Wrong recovery phrase
* Expired letter

---

## Phase 12 — Deployment (Basic)

### Task 12.1 — Hosting Setup

* Backend deployment
* Database provisioning

### Task 12.2 — Environment Config

* Secure secrets
* Production settings

---

## Final Note

Work strictly in phases.

Do not:

* mix encryption into early model work
* build full UI before backend works
* skip testing individual steps

Each task should be:

* implemented
* tested manually
* verified before moving forward

The goal is steady, reliable progress — not speed.
