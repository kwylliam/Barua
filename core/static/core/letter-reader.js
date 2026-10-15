(function () {
    "use strict";

    const panel = document.querySelector("[data-envelope-url]");
    const form = document.getElementById("letter-reader-form");
    const status = document.getElementById("letter-reader-status");
    const submitButton = document.getElementById("letter-reader-submit");
    const body = document.getElementById("letter-body");
    const errorBox = document.getElementById("letter-reader-error");
    const readableDownload = document.getElementById("letter-readable-download");

    if (
        !panel ||
        !form ||
        !status ||
        !submitButton ||
        !body ||
        !errorBox ||
        !readableDownload ||
        !window.BaruaCrypto
    ) {
        return;
    }

    const allowedTags = new Set([
        "B",
        "BR",
        "DIV",
        "EM",
        "FONT",
        "I",
        "P",
        "STRONG",
        "U",
    ]);
    const allowedFontKeys = new Set([
        "caveat",
        "dancing-script",
        "homemade-apple",
        "cedarville-cursive",
        "kalam",
        "patrick-hand",
        "indie-flower",
        "shadows-into-light",
    ]);
    const allowedFaces = new Set([
        "cursive",
        "Segoe Print",
        "Bradley Hand",
        "URW Chancery L",
    ]);

    function escapedText(text) {
        const holder = document.createElement("div");
        holder.textContent = text;
        return holder.innerHTML.replace(/\r?\n/g, "<br>");
    }

    function sanitizeMarkup(markup) {
        const template = document.createElement("template");
        template.innerHTML = markup;
        if (!template.content.querySelector("*")) {
            return escapedText(markup);
        }

        template.content
            .querySelectorAll("script, style, iframe, object, embed, link, meta, img")
            .forEach((element) => element.remove());

        Array.from(template.content.querySelectorAll("*"), (element) => {
            if (!allowedTags.has(element.tagName)) {
                element.replaceWith(...Array.from(element.childNodes));
                return;
            }

            if (element.tagName === "DIV") {
                const fontKey = element.getAttribute("data-barua-font");
                Array.from(element.attributes).forEach((attribute) => {
                    element.removeAttribute(attribute.name);
                });
                if (allowedFontKeys.has(fontKey)) {
                    element.setAttribute("data-barua-font", fontKey);
                }
                return;
            }

            if (element.tagName === "FONT") {
                const face = element.getAttribute("face");
                Array.from(element.attributes).forEach((attribute) => {
                    element.removeAttribute(attribute.name);
                });
                if (allowedFaces.has(face)) {
                    element.setAttribute("face", face);
                }
                return;
            }

            Array.from(element.attributes).forEach((attribute) => {
                element.removeAttribute(attribute.name);
            });
        });
        return template.innerHTML.trim();
    }

    function setStatus(message, isError) {
        status.textContent = message;
        status.classList.toggle("error", Boolean(isError));
    }

    function pendingAccountPassword() {
        try {
            return sessionStorage.getItem("barua-pending-account-password");
        } catch (error) {
            return null;
        }
    }

    function clearPendingAccountPassword() {
        try {
            sessionStorage.removeItem("barua-pending-account-password");
        } catch (error) {
            // The browser did not expose session storage.
        }
    }

    async function getJson(url, options = {}) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "The letter could not be loaded.");
        }
        return data;
    }

    async function migrateLegacyPackage(packageData, identity, accountPassword) {
        if (packageData.account_wrap || !accountPassword) {
            return;
        }
        const updatedPackage = await window.BaruaCrypto.addAccountPasswordWrapper(
            packageData,
            identity,
            accountPassword,
        );
        await getJson(panel.dataset.identityUrl, {
            method: "POST",
            headers: {
                "Content-Type": "application/json",
                "X-CSRFToken": form.elements.csrfmiddlewaretoken.value,
            },
            body: JSON.stringify(updatedPackage),
        });
        clearPendingAccountPassword();
    }

    async function unlockForLetter(packageData) {
        try {
            const identity = await window.BaruaCrypto.unlockRememberedDevice(packageData);
            await migrateLegacyPackage(
                packageData,
                identity,
                pendingAccountPassword(),
            );
            if (packageData.account_wrap) {
                clearPendingAccountPassword();
            }
            return identity;
        } catch (error) {
            if (
                error.code !== "DEVICE_NOT_REMEMBERED" &&
                error.code !== "DEVICE_STORAGE_UNAVAILABLE"
            ) {
                throw error;
            }
        }

        const accountPassword = pendingAccountPassword();
        if (!accountPassword) {
            throw new Error(
                "Your letterbox is not unlocked in this tab. Sign out and sign back in here; no recovery phrase is needed.",
            );
        }

        const identity = await window.BaruaCrypto.unlockIdentity(
            packageData,
            accountPassword,
            "account",
        );
        try {
            await window.BaruaCrypto.rememberDevice(packageData, identity);
            try {
                sessionStorage.removeItem("barua-pending-account-password");
            } catch (error) {
                // The browser did not expose session storage.
            }
        } catch (error) {
            setStatus(
                "This browser could not save its local unlock, but your current sign-in remains active.",
                false,
            );
        }
        return identity;
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        submitButton.disabled = true;
        errorBox.hidden = true;
        setStatus("Loading and decrypting your letter…", false);
        let recipientIdentity;

        try {
            const [packageData, letterData] = await Promise.all([
                getJson(panel.dataset.identityUrl),
                getJson(panel.dataset.envelopeUrl),
            ]);
            recipientIdentity = await unlockForLetter(packageData);
            const plaintext = await window.BaruaCrypto.decryptLetter({
                envelope: letterData.envelope,
                recipientIdentity,
                senderKey: letterData.sender_key,
            });

            const letterMarkup = window.BaruaCrypto.fromBytes(plaintext);
            const safeMarkup = sanitizeMarkup(letterMarkup);
            body.innerHTML = safeMarkup;
            body.hidden = false;
            form.hidden = true;
            const readableDocument = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Barua letter</title><style>body{max-width:42rem;margin:3rem auto;padding:0 1.5rem;color:#233746;font:1.15rem/2 "Segoe Print","Bradley Hand",cursive}p,div{margin:0 0 1rem}</style></head><body>${safeMarkup}</body></html>`;
            const downloadUrl = URL.createObjectURL(
                new Blob([readableDocument], { type: "text/html;charset=utf-8" }),
            );
            readableDownload.innerHTML = "";
            const downloadLink = document.createElement("a");
            downloadLink.href = downloadUrl;
            downloadLink.download = "barua-letter.html";
            downloadLink.textContent = "Download a formatted copy";
            readableDownload.append(downloadLink);
            readableDownload.append(" (this copy is unencrypted and stays on your device)");
            readableDownload.hidden = false;
            try {
                await getJson(panel.dataset.openedUrl, {
                    method: "POST",
                    headers: {
                        "X-CSRFToken": form.elements.csrfmiddlewaretoken.value,
                    },
                });
            } catch (error) {
                // A retention acknowledgement should not hide a letter that
                // the browser has already authenticated and displayed.
            }
            setStatus("Envelope opened and signature verified.", false);
        } catch (error) {
            errorBox.textContent = error.message || "The letter could not be decrypted.";
            errorBox.hidden = false;
            setStatus("The letter could not be unlocked.", true);
            submitButton.disabled = false;
        } finally {
            if (recipientIdentity) {
                window.BaruaCrypto.clearIdentity(recipientIdentity);
            }
        }
    });
})();
