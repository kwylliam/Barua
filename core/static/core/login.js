(function () {
    "use strict";

    const form = document.getElementById("login-form");
    const password = form?.querySelector('input[name="password"]');
    if (!form || !password) {
        return;
    }

    form.addEventListener("submit", function () {
        if (!form.checkValidity()) {
            return;
        }
        try {
            sessionStorage.setItem("barua-pending-account-password", password.value);
        } catch (error) {
            // A restrictive browser can still use a remembered device.
        }
    });
})();
