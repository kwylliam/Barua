(function () {
    "use strict";

    const form = document.getElementById("crypto-setup-form");
    const phraseOutput = document.getElementById("recovery-phrase");
    const status = document.getElementById("crypto-setup-status");
    const submitButton = document.getElementById("crypto-setup-submit");

    if (!form || !phraseOutput || !status || !window.BaruaCrypto) {
        return;
    }

    let recoveryPhrase;
    try {
        recoveryPhrase = window.BaruaCrypto.generateRecoveryPhrase();
        phraseOutput.textContent = recoveryPhrase;
    } catch (error) {
        status.textContent = "This browser could not initialize secure key generation.";
        submitButton.disabled = true;
        return;
    }

    function setStatus(message, isError) {
        status.textContent = message;
        status.classList.toggle("error", Boolean(isError));
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();
        setStatus("Creating your encrypted identity…", false);
        submitButton.disabled = true;

        const confirmation = form.elements.recovery_confirmation.value;

        try {
            const normalizedConfirmation = window.BaruaCrypto.normalizeRecoveryPhrase(
                confirmation,
            );
            if (normalizedConfirmation !== recoveryPhrase) {
                throw new Error("Recovery phrase confirmation does not match.");
            }

            let accountPassword;
            try {
                accountPassword = sessionStorage.getItem(
                    "barua-pending-account-password",
                );
            } catch (error) {
                throw new Error(
                    "This browser could not carry your account password into letterbox setup. Return to the signup page and try again.",
                );
            }
            if (!accountPassword) {
                throw new Error(
                    "Your account password is not available for letterbox setup. Return to the signup page and try again.",
                );
            }

            const packageData = await window.BaruaCrypto.createIdentity({
                accountPassword,
                recoveryPhrase,
            });
            const response = await fetch(form.action, {
                method: "POST",
                credentials: "same-origin",
                headers: {
                    "Content-Type": "application/json",
                    "X-CSRFToken": form.elements.csrfmiddlewaretoken.value,
                },
                body: JSON.stringify(packageData),
            });

            const responseData = await response.json();
            if (!response.ok) {
                throw new Error(responseData.error || "Identity setup failed.");
            }

            const identity = await window.BaruaCrypto.unlockIdentity(
                packageData,
                recoveryPhrase,
                "recovery",
            );
            try {
                try {
                    await window.BaruaCrypto.rememberDevice(packageData, identity);
                } catch (error) {
                    // The identity remains usable with recovery if this browser
                    // or browsing mode does not provide persistent storage.
                }
            } finally {
                window.BaruaCrypto.clearIdentity(identity);
            }

            try {
                sessionStorage.removeItem("barua-pending-account-password");
            } catch (error) {
                // Nothing more is needed after the identity has been stored.
            }

            window.location.assign(form.dataset.successUrl);
        } catch (error) {
            setStatus(error.message || "Identity setup failed.", true);
            submitButton.disabled = false;
        }
    });
})();
