# Barua Threat Model

Status: v2 baseline

This document defines what Barua protects, what it assumes, and what it does
not promise. It is the security contract that should guide the key-management,
storage, and testing work.

## Security objective

Barua is a privacy-first delivery system for long-form letters. Letter contents
are encrypted in the sender's browser before upload and decrypted in the
recipient's browser after delivery. The service routes and delays opaque
envelopes; it does not have a normal application path to read their contents.

Barua is not intended to be a permanent archive or a real-time messaging
system. It should delete stored envelopes after successful opening plus a short
grace period, or when the maximum retention period expires.

## Primary threat model: honest-but-curious service

The initial guarantee is against a service operator who runs the released
application normally but may inspect ordinary server data, backups, logs, or
database contents. It also covers accidental storage exposure and network
observation.

## Assets to protect

- Plaintext letter contents and attachments
- Private encryption and signing keys
- Recovery phrases
- Undelivered and recently delivered encrypted letters
- Account credentials and authenticated sessions

The following metadata is private to some degree, but is not hidden by the
initial design:

- Sender and recipient identities
- Contact relationships
- Creation, delivery, and download timestamps
- Ciphertext sizes
- Whether a recipient acknowledged opening a letter

## Threats Barua should defend against

Barua should protect letter contents from:

- A database compromise
- A file/object-storage compromise
- A stolen server backup
- A curious administrator inspecting normal server data
- A network attacker observing traffic
- An authenticated user attempting to download another user's letter

In these cases, the attacker should see ciphertext rather than readable
letter content.

## Threats outside the initial guarantee

Barua cannot fully protect against:

- A compromised sender or recipient device
- A recipient copying, photographing, or forwarding a letter
- A user losing both their recovery phrase and all remembered devices
- Malware that can use a remembered browser profile
- A server operator deploying malicious browser JavaScript that reads a letter
  before encryption
- Information inferred from timestamps, relationships, delivery behavior, or
  ciphertext size

The browser limitation is important: a normal web application serves the code
that performs client-side encryption. The initial privacy claim therefore
means protection against database/storage compromise and ordinary server-side
access, not protection against a malicious application server serving altered
client code.

## Trust assumptions

Barua initially trusts:

- HTTPS and the user's browser
- The user's device and local storage of secrets
- The recipient not to misuse a letter they can read
- The cryptographic library used by the client
- The released client-side encryption code, subject to normal deployment
  security

Barua does not trust:

- Database contents to contain readable letters
- File storage or backups to contain readable letters
- Django administrators to be able to decrypt letters
- Logs, errors, or analytics to contain plaintext content

## Core guarantees

The v1 system should be able to make this statement accurately:

> Barua encrypts letter contents in the browser. The service stores and
> delivers ciphertext and metadata, but cannot read normally stored letters as
> the owner of the server. After login, the account password unlocks letters in
> the browser without a second daily secret; the recovery phrase is reserved
> for forgotten-password recovery.

## Consequences for the design

- The server must never receive the recovery phrase.
- The account password is used for both Django authentication and a client-side
  private-key wrapper. The server stores only the opaque wrapper and a one-way
  Django password hash.
- Public keys need stable identities and visible fingerprints.
- Contact creation and key verification are separate concerns.
- Remembered-device keys must not be stored as exportable plaintext secrets.
- Encrypted files must be stored privately and deleted deliberately.
- Logs and error reporting must exclude letter bodies, keys, and secrets.
- Security tests must verify ciphertext-only server storage and unauthorized
  download rejection.

The client should use standards-based feature detection rather than browser
name detection. If a browser cannot provide secure persistent device storage,
the client may use an encrypted browser-local fallback. If all local storage is
blocked, the current login session can still unlock with the account password;
the recovery phrase is not a normal device-enrollment prompt.

This is a Proton-like UX, not a claim of identical authentication architecture.
Because ordinary Django login receives the password, a malicious server that
actively changes the login page could capture it. A future OPAQUE/PAKE login
would remove that active-server exposure while keeping the same user experience.

## Recovery and loss behavior

Account recovery may restore access to the Django account, but must not bypass
cryptographic recovery.

If a user has their recovery phrase, they can restore the existing private key
and enroll a new remembered device. If they lose the phrase and all remembered
devices, they may eventually create a new cryptographic identity, but old
letters encrypted for the previous key remain inaccessible.
