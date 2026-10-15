(function () {
    "use strict";

    const password = document.getElementById("id_password1");
    const confirmation = document.getElementById("id_password2");
    if (!password || !confirmation) {
        return;
    }

    function updateRequirement(id, met) {
        const requirement = document.getElementById(id);
        if (!requirement) {
            return;
        }
        requirement.classList.toggle("met", met);
        requirement.querySelector("span").textContent = met ? "✓" : "○";
    }

    function update() {
        const value = password.value;
        updateRequirement("account-password-length", value.length >= 8);
        updateRequirement(
            "account-password-not-numeric",
            value.length > 0 && !/^\d+$/.test(value),
        );
        updateRequirement(
            "account-password-match",
            value.length > 0 && value === confirmation.value,
        );
    }

    password.addEventListener("input", update);
    confirmation.addEventListener("input", update);
    update();

    const form = password.form;
    form?.addEventListener("submit", function () {
        if (form.checkValidity()) {
            try {
                sessionStorage.setItem("barua-pending-account-password", password.value);
            } catch (error) {
                // The setup page can explain the fallback if storage is blocked.
            }
        }
    });
})();
