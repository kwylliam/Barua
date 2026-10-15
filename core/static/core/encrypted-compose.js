(function () {
    "use strict";

    const form = document.getElementById("encrypted-compose-form");
    const panel = document.querySelector("[data-recipient-key-template]");
    const status = document.getElementById("encrypted-compose-status");
    const submitButton = document.getElementById("encrypted-compose-submit");
    const editor = document.getElementById("letter-editor");
    const letterField = document.getElementById("letter-text");
    const wordCountElement = document.getElementById("letter-word-count");
    const discardDraftButton = document.getElementById("letter-discard-draft");
    const saveDraftButton = document.getElementById("save-draft-button");
    const newDraftButton = document.getElementById("new-draft-button");
    const draftList = document.getElementById("local-drafts-list");
    const draftCountElement = document.getElementById("draft-count");
    const toolbar = document.querySelector(".editor-toolbar");
    const minimumWordCount = form
        ? Number(form.dataset.minWords) || 100
        : 100;
    const legacyDraftId = "writing-desk";
    const requestedDraftId = new URLSearchParams(window.location.search).get(
        "draft",
    );
    let currentDraftId = requestedDraftId || null;
    if (
        !form ||
        !panel ||
        !status ||
        !submitButton ||
        !editor ||
        !letterField ||
        !wordCountElement ||
        !discardDraftButton ||
        !saveDraftButton ||
        !newDraftButton ||
        !draftList ||
        !draftCountElement ||
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
    const fontDefinitions = {
        caveat: { family: "Caveat" },
        "dancing-script": { family: "Dancing Script" },
        "homemade-apple": { family: "Homemade Apple" },
        "cedarville-cursive": { family: "Cedarville Cursive" },
        kalam: { family: "Kalam" },
        "patrick-hand": { family: "Patrick Hand" },
        "indie-flower": { family: "Indie Flower" },
        "shadows-into-light": { family: "Shadows Into Light" },
    };
    const allowedFontKeys = new Set(Object.keys(fontDefinitions));
    const allowedFaces = new Set([
        "cursive",
        "Segoe Print",
        "Bradley Hand",
        "URW Chancery L",
    ]);
    let draftIdentity = null;
    let draftIdentityPromise = null;
    let draftSaveTimer = null;
    let draftSavePromise = null;
    let userHasEdited = false;

    function sanitizeMarkup(markup) {
        const template = document.createElement("template");
        template.innerHTML = markup;
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

    function syncLetterField() {
        const fontKey = allowedFontKeys.has(editor.dataset.fontKey)
            ? editor.dataset.fontKey
            : "caveat";
        const safeContent = sanitizeMarkup(editor.innerHTML);
        letterField.value = `<div data-barua-font="${fontKey}">${safeContent}</div>`;
        return letterField.value;
    }

    function wordCount(text) {
        return text.trim().split(/\s+/).filter(Boolean).length;
    }

    function updateWordCount() {
        const count = wordCount(editor.textContent);
        wordCountElement.textContent = `${count} word${count === 1 ? "" : "s"}`;
    }

    function setDraftStatus(message, isError = false) {
        const draftStatus = document.getElementById("letter-draft-status");
        if (!draftStatus) {
            return;
        }
        draftStatus.textContent = message;
        draftStatus.classList.toggle("error", isError);
    }

    function setDraftAvailable(isAvailable) {
        discardDraftButton.hidden = !isAvailable;
    }

    function updateDraftUrl() {
        const url = new URL(window.location.href);
        if (currentDraftId) {
            url.searchParams.set("draft", currentDraftId);
        } else {
            url.searchParams.delete("draft");
        }
        window.history.replaceState({}, "", url);
    }

    function draftPayload(plaintext) {
        const draft = JSON.parse(plaintext);
        if (
            draft.format_version !== 1 ||
            typeof draft.markup !== "string" ||
            typeof draft.recipient_id !== "string" ||
            typeof draft.font_key !== "string"
        ) {
            throw new Error("The saved Barua draft is invalid.");
        }
        return draft;
    }

    function draftText(markup) {
        const template = document.createElement("template");
        template.innerHTML = markup;
        return template.content.textContent.trim().replace(/\s+/g, " ");
    }

    function recipientLabel(recipientId) {
        const option = Array.from(form.elements.recipient.options).find(
            (item) => item.value === recipientId,
        );
        return option ? option.textContent : "No correspondent chosen";
    }

    function draftDate(timestamp) {
        if (!timestamp) {
            return "Not saved yet";
        }
        try {
            return new Intl.DateTimeFormat(undefined, {
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
            }).format(new Date(timestamp));
        } catch (error) {
            return "Recently saved";
        }
    }

    function renderDraftList(drafts) {
        draftCountElement.textContent = drafts.length;
        draftList.replaceChildren();
        if (!drafts.length) {
            const empty = document.createElement("li");
            empty.className = "draft-empty";
            empty.textContent = "No drafts yet. Begin a letter and keep it here for later.";
            draftList.append(empty);
            return;
        }

        drafts.forEach((savedDraft) => {
            try {
                const draft = draftPayload(savedDraft.plaintext);
                const text = draftText(draft.markup);
                const title = text.split(/\n+/)[0].trim() || "Untitled letter";
                const row = document.createElement("button");
                row.className = "draft-row";
                row.type = "button";
                row.dataset.draftId = savedDraft.draft_id;
                row.classList.toggle(
                    "is-current",
                    savedDraft.draft_id === currentDraftId,
                );

                const titleElement = document.createElement("span");
                titleElement.className = "draft-row-title";
                titleElement.textContent = title;
                row.append(titleElement);

                const meta = document.createElement("span");
                meta.className = "draft-row-meta";
                const count = wordCount(text);
                meta.textContent = `${recipientLabel(draft.recipient_id)} · ${count} word${count === 1 ? "" : "s"} · ${draftDate(savedDraft.updated_at)}`;
                row.append(meta);

                const item = document.createElement("li");
                item.append(row);
                draftList.append(item);
            } catch (error) {
                // Do not let one damaged local draft prevent the binder opening.
            }
        });
    }

    function applyFont(fontKey) {
        const selectedFont = fontDefinitions[fontKey] || fontDefinitions.caveat;
        editor.dataset.fontKey = allowedFontKeys.has(fontKey) ? fontKey : "caveat";
        editor.style.fontFamily = `"${selectedFont.family}", cursive`;
        if (toolbar) {
            const fontPicker = document.getElementById("letter-font");
            if (fontPicker) {
                fontPicker.value = editor.dataset.fontKey;
            }
        }
    }

    let savedRange = null;

    function saveSelection() {
        const selection = window.getSelection();
        if (
            selection &&
            selection.rangeCount &&
            editor.contains(selection.getRangeAt(0).commonAncestorContainer)
        ) {
            savedRange = selection.getRangeAt(0).cloneRange();
        }
    }

    function restoreSelection() {
        if (!savedRange) {
            editor.focus();
            return;
        }
        const selection = window.getSelection();
        selection.removeAllRanges();
        selection.addRange(savedRange);
    }

    document.addEventListener("selectionchange", saveSelection);
    editor.addEventListener("input", () => {
        userHasEdited = true;
        syncLetterField();
        updateWordCount();
        scheduleDraftSave();
    });
    editor.addEventListener("paste", function (event) {
        event.preventDefault();
        const text = event.clipboardData.getData("text/plain");
        document.execCommand("insertText", false, text);
        syncLetterField();
        updateWordCount();
        scheduleDraftSave();
    });

    if (toolbar) {
        toolbar.querySelectorAll("[data-command]").forEach((button) => {
            button.addEventListener("mousedown", (event) => event.preventDefault());
            button.addEventListener("click", () => {
                restoreSelection();
                editor.focus();
                document.execCommand(button.dataset.command, false, null);
                syncLetterField();
                scheduleDraftSave();
            });
        });

        const fontPicker = document.getElementById("letter-font");
        if (fontPicker) {
            fontPicker.addEventListener("change", () => {
                applyFont(fontPicker.value);
                syncLetterField();
                scheduleDraftSave();
            });
        }
    }

    form.elements.recipient.addEventListener("change", scheduleDraftSave);

    applyFont(editor.dataset.fontKey || "caveat");
    updateWordCount();

    function setStatus(message, isError) {
        status.textContent = message;
        status.classList.toggle("error", Boolean(isError));
    }

    function recipientKeyUrl(userId) {
        return panel.dataset.recipientKeyTemplate.replace("/0/", `/${encodeURIComponent(userId)}/`);
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

    async function getJson(url, options) {
        const response = await fetch(url, {
            credentials: "same-origin",
            ...options,
        });
        const data = await response.json();
        if (!response.ok) {
            throw new Error(data.error || "The request failed.");
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
        await getJson(form.dataset.identityUrl, {
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

    async function ensureDraftIdentity() {
        if (draftIdentity) {
            return draftIdentity;
        }
        if (!draftIdentityPromise) {
            draftIdentityPromise = getJson(form.dataset.identityUrl)
                .then((packageData) => unlockForLetter(packageData))
                .then((identity) => {
                    draftIdentity = identity;
                    return identity;
                })
                .catch((error) => {
                    draftIdentityPromise = null;
                    throw error;
                });
        }
        return draftIdentityPromise;
    }

    function draftSnapshot() {
        return JSON.stringify({
            format_version: 1,
            recipient_id: form.elements.recipient.value,
            font_key: allowedFontKeys.has(editor.dataset.fontKey)
                ? editor.dataset.fontKey
                : "caveat",
            markup: sanitizeMarkup(editor.innerHTML),
        });
    }

    function makeDraftId() {
        if (window.crypto && typeof window.crypto.randomUUID === "function") {
            return window.crypto.randomUUID();
        }
        return `draft-${Date.now()}-${Math.random().toString(36).slice(2)}`;
    }

    async function refreshDraftList(identity) {
        const unlockedIdentity = identity || (await ensureDraftIdentity());
        const drafts = await window.BaruaCrypto.listDrafts({
            identity: unlockedIdentity,
        });
        renderDraftList(drafts);
        return drafts;
    }

    async function saveCurrentDraft() {
        if (draftSavePromise) {
            return draftSavePromise;
        }

        draftSavePromise = (async () => {
            if (!editor.textContent.trim()) {
                setDraftStatus("Write something before saving", true);
                return false;
            }

            const identity = await ensureDraftIdentity();
            if (!currentDraftId) {
                currentDraftId = makeDraftId();
                updateDraftUrl();
            }
            await window.BaruaCrypto.saveDraft({
                identity,
                draftId: currentDraftId,
                plaintext: draftSnapshot(),
            });
            setDraftAvailable(true);
            setDraftStatus("Saved on this device");
            await refreshDraftList(identity);
            return true;
        })()
            .catch((error) => {
                setDraftStatus("Draft saving is unavailable here", true);
                return false;
            })
            .finally(() => {
                draftSavePromise = null;
            });
        return draftSavePromise;
    }

    async function persistDraft() {
        if (!editor.textContent.trim()) {
            if (!currentDraftId || !draftIdentity) {
                return;
            }
            const draftToDelete = currentDraftId;
            try {
                await window.BaruaCrypto.deleteDraft({
                    keyId: draftIdentity.key_id,
                    draftId: draftToDelete,
                });
                currentDraftId = null;
                updateDraftUrl();
                setDraftAvailable(false);
                setDraftStatus("Drafts stay on this device");
                await refreshDraftList(draftIdentity);
            } catch (error) {
                setDraftStatus("This draft could not be cleared", true);
            }
            return;
        }
        await saveCurrentDraft();
    }

    function scheduleDraftSave() {
        window.clearTimeout(draftSaveTimer);
        draftSaveTimer = window.setTimeout(() => {
            void persistDraft();
        }, 700);
    }

    function clearEditor() {
        editor.innerHTML = "";
        userHasEdited = false;
        form.elements.recipient.value = "";
        applyFont("caveat");
        syncLetterField();
        updateWordCount();
    }

    async function loadDraftIntoEditor(draftId, identity) {
        const savedDraft = await window.BaruaCrypto.loadDraft({
            identity,
            draftId,
        });
        if (!savedDraft) {
            throw new Error("That draft is no longer available on this device.");
        }

        const draft = draftPayload(savedDraft.plaintext);
        const recipientOption = Array.from(
            form.elements.recipient.options,
        ).find((option) => option.value === draft.recipient_id);
        form.elements.recipient.value = recipientOption
            ? draft.recipient_id
            : "";
        editor.innerHTML = sanitizeMarkup(draft.markup);
        userHasEdited = false;
        applyFont(draft.font_key);
        syncLetterField();
        updateWordCount();
        currentDraftId = draftId;
        updateDraftUrl();
        setDraftAvailable(true);
        setDraftStatus("Draft restored from this device");
    }

    async function openDraft(draftId) {
        if (draftId === currentDraftId) {
            return;
        }
        if (editor.textContent.trim()) {
            await saveCurrentDraft();
        }
        try {
            const identity = await ensureDraftIdentity();
            await loadDraftIntoEditor(draftId, identity);
            await refreshDraftList(identity);
        } catch (error) {
            setDraftStatus(error.message || "Draft could not be opened", true);
        }
    }

    async function initializeDraftBinder() {
        try {
            const identity = await ensureDraftIdentity();
            const drafts = await refreshDraftList(identity);
            const draftIds = new Set(drafts.map((draft) => draft.draft_id));
            const draftToOpen = !userHasEdited && currentDraftId && draftIds.has(currentDraftId)
                ? currentDraftId
                : !userHasEdited && !currentDraftId && draftIds.has(legacyDraftId)
                    ? legacyDraftId
                    : null;
            if (draftToOpen) {
                await loadDraftIntoEditor(draftToOpen, identity);
            }
        } catch (error) {
            draftList.replaceChildren();
            const empty = document.createElement("li");
            empty.className = "draft-empty";
            empty.textContent = "Drafts are unavailable in this browser session.";
            draftList.append(empty);
            setDraftStatus("Draft saving is unavailable here", true);
        }
    }

    form.addEventListener("submit", async function (event) {
        event.preventDefault();

        try {
            const letterMarkup = syncLetterField();
            if (!editor.textContent.trim()) {
                throw new Error("Write a letter before posting.");
            }
            if (wordCount(editor.textContent) < minimumWordCount) {
                throw new Error(
                    `A Barua letter must be at least ${minimumWordCount} words.`,
                );
            }

            const recipientId = form.elements.recipient.value;
            if (!recipientId) {
                throw new Error("Choose a recipient.");
            }

            submitButton.disabled = true;
            setStatus("Unlocking your identity and encrypting the letter…", false);

            const [recipientKey, senderIdentity] = await Promise.all([
                getJson(recipientKeyUrl(recipientId)),
                ensureDraftIdentity(),
            ]);
            try {
                const envelope = await window.BaruaCrypto.encryptLetter({
                    plaintext: window.BaruaCrypto.toBytes(letterMarkup),
                    senderIdentity,
                    recipientKey,
                });
                const requiredStringFields = [
                    "letter_id",
                    "sender_key_id",
                    "recipient_key_id",
                    "ciphertext",
                    "nonce",
                    "wrapped_content_key",
                    "signature",
                ];
                if (
                    requiredStringFields.some(
                        (field) => typeof envelope[field] !== "string",
                    )
                ) {
                    throw new Error(
                        "This page loaded an outdated crypto bundle. Refresh and try again.",
                    );
                }

                await getJson(form.action, {
                    method: "POST",
                    headers: {
                        "Content-Type": "application/json",
                        "X-CSRFToken": form.elements.csrfmiddlewaretoken.value,
                        "X-Barua-Client": "6",
                    },
                    body: JSON.stringify({ recipient: recipientId, envelope }),
                });
                try {
                    if (currentDraftId) {
                        await window.BaruaCrypto.deleteDraft({
                            keyId: senderIdentity.key_id,
                            draftId: currentDraftId,
                        });
                        currentDraftId = null;
                        updateDraftUrl();
                    }
                } catch (error) {
                    // Sending succeeded; local cleanup is best effort.
                }
                window.location.assign(form.dataset.successUrl);
            } finally {
                window.BaruaCrypto.clearIdentity(senderIdentity);
                if (senderIdentity === draftIdentity) {
                    draftIdentity = null;
                    draftIdentityPromise = null;
                }
            }
        } catch (error) {
            setStatus(error.message || "The letter could not be encrypted.", true);
            submitButton.disabled = false;
        }
    });

    saveDraftButton.addEventListener("click", async () => {
        window.clearTimeout(draftSaveTimer);
        saveDraftButton.disabled = true;
        await saveCurrentDraft();
        saveDraftButton.disabled = false;
    });

    newDraftButton.addEventListener("click", async () => {
        window.clearTimeout(draftSaveTimer);
        newDraftButton.disabled = true;
        try {
            if (editor.textContent.trim() && !(await saveCurrentDraft())) {
                return;
            }
            currentDraftId = null;
            updateDraftUrl();
            clearEditor();
            setDraftAvailable(false);
            setDraftStatus("A fresh sheet of paper");
            if (draftIdentity) {
                await refreshDraftList(draftIdentity);
            }
        } finally {
            newDraftButton.disabled = false;
        }
    });

    draftList.addEventListener("click", (event) => {
        const row = event.target.closest("[data-draft-id]");
        if (row) {
            void openDraft(row.dataset.draftId);
        }
    });

    discardDraftButton.addEventListener("click", async () => {
        window.clearTimeout(draftSaveTimer);
        discardDraftButton.disabled = true;
        try {
            if (currentDraftId) {
                const identity = await ensureDraftIdentity();
                await window.BaruaCrypto.deleteDraft({
                    keyId: identity.key_id,
                    draftId: currentDraftId,
                });
            }
            currentDraftId = null;
            updateDraftUrl();
            clearEditor();
            setDraftAvailable(false);
            setDraftStatus("Draft discarded");
            if (draftIdentity) {
                await refreshDraftList(draftIdentity);
            }
        } catch (error) {
            setDraftStatus("This draft could not be discarded", true);
        } finally {
            discardDraftButton.disabled = false;
        }
    });

    void initializeDraftBinder();
})();
