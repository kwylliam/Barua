(function () {
    "use strict";

    const button = document.getElementById("forget-device-button");
    const status = document.getElementById("forget-device-status");

    if (!button || !status || !window.BaruaCrypto) {
        return;
    }

    button.addEventListener("click", async function () {
        button.disabled = true;
        status.textContent = "Forgetting this browser…";
        try {
            const response = await fetch(button.dataset.identityUrl, {
                credentials: "same-origin",
            });
            const packageData = await response.json();
            if (!response.ok) {
                throw new Error(packageData.error || "The browser could not be forgotten.");
            }
            await window.BaruaCrypto.forgetRememberedDevice(packageData);
            status.textContent = "This browser has been forgotten. Sign in again here to reopen the letterbox.";
        } catch (error) {
            status.textContent = error.message || "The browser could not be forgotten.";
            button.disabled = false;
        }
    });
})();
