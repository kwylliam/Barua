(function () {
    "use strict";

    document.querySelectorAll('form[action$="/logout/"]').forEach(function (form) {
        form.addEventListener("submit", function () {
            try {
                sessionStorage.removeItem("barua-pending-account-password");
            } catch (error) {
                // The browser did not expose session storage.
            }
        });
    });
})();
