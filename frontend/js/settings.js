// i18n.js loads before this file. Each lookup carries its English fallback so a
// stale cached copy after an upgrade shows readable English rather than raw key
// names.
function tr(key, english) {
    return typeof window.t === "function" ? window.t(key, english) : english;
}

function trf(key, vars, english) {
    if (typeof window.tf === "function") return window.tf(key, vars, english);
    let out = english || key;
    Object.keys(vars || {}).forEach(name => {
        out = out.split("{" + name + "}").join(String(vars[name]));
    });
    return out;
}

// Local mirror of the institute's class list. Kept in memory while the page is
// open so a class can be added or removed without a round trip; it is written
// back only when "Save Settings" is pressed, together with everything else on
// the form.
let _standards = [];

// Everything GET /api/settings last returned. Used as the fallback for any field
// whose box could not be found — saving must never blank a stored value just
// because the markup and the script are out of step after an upgrade.
let _loaded = null;

// The shipped wording, fetched once on first use and cached. Backs both the
// per-status Restore Default buttons and Restore All.
let _defaults = null;

/**
 * Status → settings field names.
 *
 * Mirrors STATUS_FIELDS in python_app/message_templates.py. The five statuses
 * are produced by the attendance engine and are not configurable, so this is a
 * fixed contract rather than something to fetch; /api/settings/message-placeholders
 * publishes the same map and is used to check this one has not drifted.
 */
const STATUS_FIELDS = {
    "Present": { phrase: "msg_present", template: "tpl_present" },
    "Late": { phrase: "msg_late", template: "tpl_late" },
    "Absent": { phrase: "msg_absent", template: "tpl_absent" },
    "Left Early": { phrase: "msg_left_early", template: "tpl_left_early" },
    "Left": { phrase: "msg_left", template: "tpl_left" },
};

document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadHolidays();
    wireStandardsEditor();
    wireMessageEditor();
    loadPlaceholderReference();
    wireClassTools();
    loadClassCounts();
});

async function loadSettings() {
    try {
        const resp = await window.apiFetch('/api/settings');
        if (resp.ok) {
            const data = await resp.json();
            _loaded = data;

            document.getElementById('zk_ip_address').value = data.zk_ip_address || '';
            document.getElementById('smtp_email').value = data.smtp_email || '';
            document.getElementById('smtp_password').value = data.smtp_password || '';
            document.getElementById('in_time').value = data.in_time || '08:30';
            document.getElementById('mid_time').value = data.mid_time || '12:00';
            document.getElementById('out_time').value = data.out_time || '15:00';
            document.getElementById('institute_name').value = data.institute_name || 'Biometric Attendance';

            // The stored preference, which is not necessarily what this browser
            // profile is showing — the sidebar's 🌐 button changes the display
            // language without touching the form. Show the stored value so
            // pressing Save does not silently revert a language chosen there.
            const langSelect = document.getElementById('ui_language');
            if (langSelect) langSelect.value = data.ui_language || 'en';

            // Subject and bodies come back resolved: an empty column means "use
            // the shipped default", and the editor has to show the text actually
            // being sent or the admin would be editing a blank box.
            document.getElementById('email_subject').value = data.email_subject || '';
            Object.values(STATUS_FIELDS).forEach(fields => {
                const phrase = document.getElementById(fields.phrase);
                const template = document.getElementById(fields.template);
                if (phrase) phrase.value = data[fields.phrase] || '';
                if (template) template.value = data[fields.template] || '';
            });

            // Declared on the API since 1.9 but never saved until 2.0 — the form
            // now round-trips both, so what is shown here is what is stored.
            document.getElementById('email_retry_window_hours').value = data.email_retry_window_hours ?? 24;
            document.getElementById('admin_retry_all_allowed').checked = !!data.admin_retry_all_allowed;

            _standards = String(data.standards || '11th,12th')
                .split(',')
                .map(s => s.trim())
                .filter(Boolean);
            renderStandards();
            updateMoveToOptions();
        }
    } catch (e) {
        console.error("Failed to load settings from server:", e);
    }
}

// ── Class list editor ────────────────────────────────────────────────────────

function renderStandards() {
    const list = document.getElementById('standards-list');
    if (!list) return;

    if (_standards.length === 0) {
        list.innerHTML = `<small style="color: var(--danger);">${escapeHtml(
            tr("set.noClassesLeft", "No classes left — saving now would restore the default 11th / 12th list."))}</small>`;
        return;
    }

    // Class names are free text, so they are escaped and the remove button is
    // addressed by index rather than by interpolating the name into an onclick.
    list.innerHTML = _standards.map((name, index) => {
        const title = escapeAttr(trf("set.removeTitle", { name }, `Remove ${name}`));
        return `
        <span class="tag">${escapeHtml(name)}
            <button type="button" data-remove-standard="${index}" title="${title}"
                aria-label="${title}">&times;</button>
        </span>
    `;
    }).join("");
}

function wireStandardsEditor() {
    const input = document.getElementById('new_standard');
    const addBtn = document.getElementById('btnAddStandard');
    const list = document.getElementById('standards-list');
    if (!input || !addBtn || !list) return;

    const addStandard = () => {
        const name = input.value.trim();
        if (!name) {
            window.showToast(tr("set.typeClassFirst", "Type a class name first."), "warning");
            input.focus();
            return;
        }
        if (name.toLowerCase() === 'all') {
            // "All" is the filter sentinel in every dropdown; a real class by that
            // name would be indistinguishable from "no filter".
            window.showToast(tr("set.allReserved",
                '"All" is reserved — it is the "no filter" option in every dropdown.'), "warning");
            return;
        }
        if (_standards.some(s => s.toLowerCase() === name.toLowerCase())) {
            window.showToast(trf("set.alreadyInList", { name }, `"${name}" is already in the list.`), "warning");
            return;
        }
        _standards.push(name);
        input.value = '';
        renderStandards();
        window.showToast(trf("set.classAdded", { name },
            `"${name}" added. Press Save Settings to keep it.`), "success");
    };

    addBtn.addEventListener('click', addStandard);

    // Enter inside the class box would otherwise submit the whole settings form.
    input.addEventListener('keydown', (event) => {
        if (event.key === 'Enter') {
            event.preventDefault();
            addStandard();
        }
    });

    list.addEventListener('click', (event) => {
        const button = event.target.closest('button[data-remove-standard]');
        if (!button) return;
        const index = parseInt(button.dataset.removeStandard, 10);
        if (Number.isNaN(index) || index < 0 || index >= _standards.length) return;
        const [removed] = _standards.splice(index, 1);
        renderStandards();
        window.showToast(trf("set.classRemoved", { name: removed },
            `"${removed}" removed. Press Save Settings to apply.`), "warning");
    });
}

// ── Message templates ────────────────────────────────────────────────────────

/**
 * Replace the static placeholder chips with the list the server actually
 * substitutes.
 *
 * The markup ships with the five most-used tokens so the section is never empty
 * offline; this call adds the rest and their descriptions. A failure is silent
 * on purpose — the fallback chips are still correct, and a warning toast about
 * documentation would be noise.
 */
async function loadPlaceholderReference() {
    const container = document.getElementById('placeholder-ref');
    if (!container) return;

    try {
        const resp = await window.apiFetch('/api/settings/message-placeholders');
        if (!resp.ok) return;
        const data = await resp.json();
        if (!Array.isArray(data.placeholders) || !data.placeholders.length) return;

        container.innerHTML = data.placeholders.map(p => `
            <button type="button" class="placeholder-chip" data-token="${escapeAttr(p.token)}"
                title="${escapeAttr(p.description || '')}">${escapeHtml(p.token)}</button>
        `).join("");

        // A status the server knows about but this page has no panel for would be
        // silently unsavable, so say so in the console rather than nowhere.
        (data.statuses || []).forEach(s => {
            if (!STATUS_FIELDS[s.status]) {
                console.warn("No editor panel for status:", s.status);
            }
        });
    } catch (e) {
        console.error("Failed to load placeholder reference:", e);
    }
}

function wireMessageEditor() {
    const editor = document.querySelector('.tpl-editor');
    const restoreAll = document.getElementById('btnRestoreAllTemplates');
    const closePreview = document.getElementById('btnClosePreview');
    const modal = document.getElementById('preview-modal');
    const placeholders = document.getElementById('placeholder-ref');

    if (editor) {
        editor.addEventListener('click', (event) => {
            const previewBtn = event.target.closest('button[data-preview-status]');
            if (previewBtn) {
                previewMessage(previewBtn.dataset.previewStatus);
                return;
            }
            const restoreBtn = event.target.closest('button[data-restore-status]');
            if (restoreBtn) restoreTemplate(restoreBtn.dataset.restoreStatus);
        });
    }

    if (restoreAll) restoreAll.addEventListener('click', restoreAllTemplates);
    if (closePreview) closePreview.addEventListener('click', hidePreview);

    if (modal) {
        // Clicking the dimmed area closes, clicking the panel does not.
        modal.addEventListener('click', (event) => {
            if (event.target === modal) hidePreview();
        });
    }

    document.addEventListener('keydown', (event) => {
        if (event.key === 'Escape') hidePreview();
    });

    if (placeholders) {
        placeholders.addEventListener('click', (event) => {
            const chip = event.target.closest('button[data-token]');
            if (chip) copyToken(chip.dataset.token);
        });
    }
}

/** The shipped wording, fetched once. */
async function getMessageDefaults() {
    if (_defaults) return _defaults;
    const resp = await window.apiFetch('/api/settings/message-defaults');
    if (!resp.ok) throw new Error("message-defaults returned " + resp.status);
    _defaults = await resp.json();
    return _defaults;
}

/** Human label for one status, in the interface language. */
function statusLabel(status) {
    return typeof window.tStatus === "function" ? window.tStatus(status) : status;
}

async function previewMessage(status) {
    const fields = STATUS_FIELDS[status];
    if (!fields) return;

    const body = document.getElementById(fields.template);
    const phrase = document.getElementById(fields.phrase);
    const subject = document.getElementById('email_subject');

    try {
        const resp = await window.apiFetch('/api/settings/preview-message', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                status: status,
                // What is in the boxes right now, not what is saved — the point of
                // the preview is to check an edit before committing to it.
                subject: subject ? subject.value : null,
                body: body ? body.value : null,
                status_phrase: phrase ? phrase.value : null,
            })
        });

        const data = await resp.json().catch(() => null);
        if (!resp.ok || !data) {
            window.showToast(window.describeApiError(data?.detail)
                || tr("set.previewFailed", "Could not render the preview."), "error");
            return;
        }

        // textContent, not innerHTML: the body is administrator-typed text and
        // the CSS already preserves its line breaks.
        document.getElementById('preview-status-line').textContent = statusLabel(status);
        document.getElementById('preview-subject').textContent = data.subject || '';
        document.getElementById('preview-body').textContent = data.body || '';
        document.getElementById('preview-modal').classList.add('show');
    } catch (e) {
        console.error("Preview failed:", e);
        window.showToast(tr("set.previewFailed", "Could not render the preview."), "error");
    }
}

function hidePreview() {
    const modal = document.getElementById('preview-modal');
    if (modal) modal.classList.remove('show');
}

async function restoreTemplate(status) {
    const fields = STATUS_FIELDS[status];
    if (!fields) return;

    try {
        const defaults = await getMessageDefaults();
        const phrase = document.getElementById(fields.phrase);
        const body = document.getElementById(fields.template);
        if (phrase && defaults[fields.phrase] !== undefined) phrase.value = defaults[fields.phrase];
        if (body && defaults[fields.template] !== undefined) body.value = defaults[fields.template];

        window.showToast(trf("set.templateRestored", { label: statusLabel(status) },
            `${statusLabel(status)} restored to the shipped wording. Press Save Settings to keep it.`), "success");
    } catch (e) {
        console.error("Restore default failed:", e);
        window.showToast(tr("set.tplLoadFailed", "Could not load the message templates."), "error");
    }
}

async function restoreAllTemplates() {
    if (!confirm(tr("set.confirmRestoreAll",
        "Replace every subject and message body with the wording the app ships with?\n\nNothing is saved until you press Save Settings."))) {
        return;
    }

    try {
        const defaults = await getMessageDefaults();
        const subject = document.getElementById('email_subject');
        if (subject && defaults.email_subject !== undefined) subject.value = defaults.email_subject;

        Object.values(STATUS_FIELDS).forEach(fields => {
            const phrase = document.getElementById(fields.phrase);
            const body = document.getElementById(fields.template);
            if (phrase && defaults[fields.phrase] !== undefined) phrase.value = defaults[fields.phrase];
            if (body && defaults[fields.template] !== undefined) body.value = defaults[fields.template];
        });

        window.showToast(tr("set.allTemplatesRestored",
            "All messages restored to the shipped wording. Press Save Settings to keep them."), "success");
    } catch (e) {
        console.error("Restore all failed:", e);
        window.showToast(tr("set.tplLoadFailed", "Could not load the message templates."), "error");
    }
}

/**
 * Copy a placeholder to the clipboard.
 *
 * navigator.clipboard needs a secure context; the app is served over plain HTTP
 * on 127.0.0.1, which WebView2 does treat as secure, but the execCommand path is
 * kept because a copy that silently does nothing is worse than an old API.
 */
async function copyToken(token) {
    if (!token) return;
    try {
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(token);
        } else {
            const scratch = document.createElement('textarea');
            scratch.value = token;
            scratch.setAttribute('readonly', '');
            scratch.style.position = 'fixed';
            scratch.style.opacity = '0';
            document.body.appendChild(scratch);
            scratch.select();
            const ok = document.execCommand('copy');
            document.body.removeChild(scratch);
            if (!ok) throw new Error("execCommand('copy') refused");
        }
        window.showToast(trf("set.copied", { token }, `${token} copied.`), "success");
    } catch (e) {
        console.error("Copy failed:", e);
        window.showToast(tr("set.copyFailed",
            "Could not copy — select the placeholder and copy it by hand."), "warning");
    }
}

// ── Change password ──────────────────────────────────────────────────────────

document.getElementById('passwordForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const current = document.getElementById('current_password').value;
    const next = document.getElementById('new_password').value;
    const confirmValue = document.getElementById('confirm_password').value;

    if (!current || !next) {
        window.showToast(tr("set.fillBothPasswords",
            "Fill in both the current and the new password."), "error");
        return;
    }
    // Checked here as well as on the server so a typo in the confirmation box
    // never gets as far as changing the password.
    if (next !== confirmValue) {
        window.showToast(tr("set.passwordsMismatch",
            "The two new-password boxes do not match."), "error");
        document.getElementById('confirm_password').focus();
        return;
    }

    const button = document.getElementById('btnChangePassword');
    const original = button.textContent;
    button.disabled = true;
    button.textContent = tr("set.changing", "Changing…");

    try {
        const resp = await window.apiFetch('/api/auth/change-password', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ current_password: current, new_password: next })
        });

        const data = await resp.json().catch(() => null);

        if (resp.ok) {
            window.showToast(tr("set.passwordChanged",
                "Password changed. Use it the next time you sign in."), "success");
            document.getElementById('passwordForm').reset();
            // Clears the first-run banner on the dashboard.
            sessionStorage.removeItem("must_change_password");
        } else {
            window.showToast(window.describeApiError(data?.detail)
                || tr("set.passwordFailed", "Could not change the password."), "error");
        }
    } catch (e) {
        console.error("Change password failed:", e);
        window.showToast(tr("set.passwordNetwork", "Network error. Password unchanged."), "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
});

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    if (!window.confirmTwice(
        tr("set.confirmSave", "Save these settings and apply the changes?"),
        tr("set.confirmSaveAgain", "Please confirm again to save the settings."))) return;

    const zk_ip_address = document.getElementById('zk_ip_address').value;
    const smtp_email = document.getElementById('smtp_email').value;
    const smtp_password = document.getElementById('smtp_password').value;
    const in_time = document.getElementById('in_time').value;
    const mid_time = document.getElementById('mid_time').value;
    const out_time = document.getElementById('out_time').value;
    const institute_name = document.getElementById('institute_name').value.trim();

    if (!institute_name) {
        window.showToast(tr("set.needInstituteName", "Please enter an institute name."), "error");
        document.getElementById('institute_name').focus();
        return;
    }

    const retryWindow = parseInt(document.getElementById('email_retry_window_hours').value, 10);
    if (Number.isNaN(retryWindow) || retryWindow < 1 || retryWindow > 8760) {
        window.showToast(tr("set.retryRange",
            "Retry window must be between 1 and 8760 hours (1 year)."), "error");
        document.getElementById('email_retry_window_hours').focus();
        return;
    }

    // Message payload. Each field falls back to what was loaded rather than to a
    // hardcoded default, so a box this script cannot find leaves the stored
    // wording alone instead of resetting it.
    const payload = {
        zk_ip_address: zk_ip_address,
        smtp_email: smtp_email,
        smtp_password: smtp_password,
        in_time: in_time,
        mid_time: mid_time,
        out_time: out_time,
        institute_name: institute_name,
        standards: _standards.join(','),
        admin_retry_all_allowed: document.getElementById('admin_retry_all_allowed').checked,
        email_retry_window_hours: retryWindow,
    };

    const languageSelect = document.getElementById('ui_language');
    const language = languageSelect ? languageSelect.value : (_loaded?.ui_language || 'en');
    payload.ui_language = language;

    const subjectBox = document.getElementById('email_subject');
    if (subjectBox) {
        // The server rejects an empty subject or body — catch it here so the
        // message names the field the admin is looking at.
        if (!subjectBox.value.trim()) {
            window.showToast(trf("set.emptyTemplate",
                { label: tr("set.subjectLabel", "Email Subject") },
                "The Email Subject message cannot be empty. Use Restore Default to bring back the original wording."), "error");
            subjectBox.focus();
            return;
        }
        payload.email_subject = subjectBox.value;
    }

    for (const [status, fields] of Object.entries(STATUS_FIELDS)) {
        const phrase = document.getElementById(fields.phrase);
        const body = document.getElementById(fields.template);

        payload[fields.phrase] = phrase ? phrase.value : (_loaded?.[fields.phrase] ?? '');

        if (body) {
            if (!body.value.trim()) {
                window.showToast(trf("set.emptyTemplate", { label: statusLabel(status) },
                    `The ${status} message cannot be empty. Use Restore Default to bring back the original wording.`), "error");
                body.focus();
                return;
            }
            payload[fields.template] = body.value;
        }
    }

    try {
        const resp = await window.apiFetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(payload)
        });

        if (resp.ok) {
            // Compared against what this profile is currently rendering, not
            // against the stored value: the sidebar's 🌐 button can already have
            // switched the display without touching the form.
            const showing = typeof window.getLang === "function" ? window.getLang() : "en";
            if (language !== showing && typeof window.setLang === "function") {
                window.showToast(tr("set.langChanged", "Saved. Switching language…"), "success");
                // setLang reloads, so nothing after this runs. The reload is what
                // re-reads the saved values, which makes the refresh below moot.
                setTimeout(() => window.setLang(language), 600);
                return;
            }

            window.showToast(tr("set.saved", "Settings saved successfully!"), "success");
            // The server normalises the class list (de-duplicates, drops blanks,
            // restores the default if emptied), so re-read rather than trusting
            // what was typed, and refresh every dropdown on the page.
            const standards = await window.refreshStandards().then(() => window.getStandards());
            if (Array.isArray(standards)) {
                _standards = standards.slice();
                renderStandards();
                updateMoveToOptions();
                loadClassCounts();
            }
        } else {
            const errData = await resp.json().catch(() => null);
            const errMsg = window.describeApiError(errData?.detail)
                || tr("set.saveFailed", "Failed to save settings.");
            window.showToast(errMsg, "error");
        }
    } catch (e) {
        console.error("Error saving settings:", e);
        window.showToast(tr("set.saveNetwork", "Network error. Failed to save."), "error");
    }
});

document.getElementById('btnTestConnection').addEventListener('click', async () => {
    const zk_ip_address = document.getElementById('zk_ip_address').value;
    if (!zk_ip_address) {
        window.showToast(tr("set.needIp", "Please enter an IP address first."), "error");
        return;
    }

    window.showToast(tr("set.testing", "Testing connection... Please wait."), "success");

    try {
        const resp = await window.apiFetch('/api/settings/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zk_ip_address: zk_ip_address })
        });

        const data = await resp.json();
        if (data.success) {
            window.showToast(tr("set.testOk", "Connection successful! Device is reachable."), "success");
        } else {
            window.showToast(data.message || tr("set.testFailed", "Failed to connect to device."), "error");
        }
    } catch (e) {
        console.error("Error testing connection:", e);
        window.showToast(tr("set.testNetwork", "Network error while testing connection."), "error");
    }
});

document.getElementById('btnClearLogs').addEventListener('click', async () => {
    if (!window.confirmTwice(
        tr("set.confirmWipeZk",
            "WARNING: This will permanently delete ALL attendance logs stored natively on the ZKTeco hardware. This action cannot be reversed. \n\nAre you absolutely sure?"),
        tr("set.confirmWipeZkAgain", "Please confirm again to permanently wipe the ZKTeco attendance logs."))) {
        return;
    }

    window.showToast(tr("set.wipingZk", "Initiating hardware memory wipe..."), "warning");

    try {
        const resp = await window.apiFetch('/api/settings/clear-device-logs', { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
            window.showToast(data.message, "success");
        } else {
            window.showToast(tr("set.wipeZkError", "Error wiping hardware: ") + data.message, "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast(tr("set.zkNetwork",
            "Network Error: Failed to reach hardware wipe service."), "error");
    }
});

document.getElementById('btnExportDb').addEventListener('click', async () => {
    window.showToast(tr("set.exportPreparing", "Preparing database export..."), "warning");
    try {
        const resp = await window.apiFetch('/api/settings/export-db');
        if (resp.ok) {
            const contentType = resp.headers.get("content-type");
            if (contentType && contentType.includes("application/json")) {
                const data = await resp.json();
                if (data.success) {
                    window.showToast(tr("set.exportOk", "Database exported successfully to:")
                        + "\n" + data.path, "success");
                } else {
                    window.showToast(tr("set.exportFailed", "Export failed: ") + data.message, "error");
                }
            } else {
                // Browser fallback
                const blob = await resp.blob();
                const url = window.URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.style.display = 'none';
                a.href = url;
                const contentDisposition = resp.headers.get('content-disposition');
                let filename = 'attendance_backup.db';
                if (contentDisposition) {
                    const match = contentDisposition.match(/filename="?([^"]+)"?/);
                    if (match) filename = match[1];
                }
                a.download = filename;
                document.body.appendChild(a);
                a.click();
                window.URL.revokeObjectURL(url);
                document.body.removeChild(a);
                window.showToast(tr("set.exportOk", "Database exported successfully to:"), "success");
            }
        } else {
            const errData = await resp.json().catch(() => null);
            window.showToast(tr("set.exportFailed", "Export failed: ")
                + (window.describeApiError(errData?.detail) || tr("set.networkError", "Network error.")), "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast(tr("set.exportNetwork", "Network error during export."), "error");
    }
});

document.getElementById('btnImportDb').addEventListener('click', () => {
    document.getElementById('importDbFile').click();
});

document.getElementById('importDbFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!window.confirmTwice(
        tr("set.confirmImportDb",
            "WARNING: Importing a database will replace ALL current students, attendance, and settings. The application will restart.\n\nAre you sure you want to proceed?"),
        tr("set.confirmImportDbAgain", "Please confirm again to replace the current database."))) {
        e.target.value = ''; // Reset input
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    window.showToast(tr("set.uploading", "Uploading database..."), "warning");

    try {
        const resp = await window.apiFetch('/api/settings/import-db', {
            method: 'POST',
            body: formData
        });

        if (resp.ok) {
            window.showToast(tr("set.importOk", "Database imported successfully! Reloading..."), "success");
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            const data = await resp.json().catch(() => null);
            window.showToast(tr("set.importFailed", "Import failed: ")
                + (window.describeApiError(data?.detail) || tr("set.networkError", "Network error.")), "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast(tr("set.importNetwork", "Network error during import."), "error");
    } finally {
        e.target.value = ''; // Reset input
    }
});

// --- Holiday Management ---
async function loadHolidays() {
    try {
        const resp = await window.apiFetch('/api/holidays');
        if (resp.ok) {
            const holidays = await resp.json();
            const tbody = document.getElementById('holidaysTableBody');
            tbody.innerHTML = '';

            if (holidays.length === 0) {
                tbody.innerHTML = `<tr><td colspan="4" style="text-align:center; padding:10px;">${escapeHtml(
                    tr("set.noHolidays", "No holidays configured."))}</td></tr>`;
                return;
            }

            const allLabel = tr("common.all", "All");
            const deleteLabel = escapeHtml(tr("set.delete", "Delete"));

            holidays.forEach(h => {
                const tr_ = document.createElement('tr');
                // Description is free text typed by the user, so escape it.
                tr_.innerHTML = `
                    <td style="padding: 8px; border: 1px solid var(--border-color);">${escapeHtml(h.date)}</td>
                    <td style="padding: 8px; border: 1px solid var(--border-color);">${escapeHtml(h.standard || allLabel)}</td>
                    <td style="padding: 8px; border: 1px solid var(--border-color);">${escapeHtml(h.description)}</td>
                    <td style="padding: 8px; border: 1px solid var(--border-color); text-align: center;">
                        <button onclick="deleteHoliday(${h.id})" style="background: var(--danger); color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">${deleteLabel}</button>
                    </td>
                `;
                tbody.appendChild(tr_);
            });
        }
    } catch (e) {
        console.error("Failed to load holidays:", e);
    }
}

document.getElementById('btnAddHoliday').addEventListener('click', async () => {
    const date = document.getElementById('holiday_date').value;
    const desc = document.getElementById('holiday_desc').value;
    const standard = document.getElementById('holiday_standard').value;

    if (!date) {
        window.showToast(tr("set.holidayNeedDate", "Please select a date."), "error");
        return;
    }

    try {
        const resp = await window.apiFetch('/api/holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: date, description: desc || 'Holiday', standard: standard })
        });

        const data = await resp.json();
        if (resp.ok) {
            // Only report what the server actually saved. If the response does not
            // confirm the requested standard, the backend is out of date and the row
            // was stored as "All" — say so instead of claiming a false success.
            const savedStandard = data?.holiday?.standard;
            if (savedStandard === standard) {
                window.showToast(trf("set.holidayAdded", { standard: savedStandard },
                    `Holiday added for ${savedStandard}.`), "success");
            } else {
                window.showToast(
                    trf("set.holidayWrongStandard", { saved: savedStandard || 'All', wanted: standard },
                        `Saved as "${savedStandard || 'All'}", not "${standard}". Close and reopen the app so the latest version loads, then delete and re-add this date.`),
                    "error"
                );
            }
            document.getElementById('holiday_date').value = '';
            document.getElementById('holiday_desc').value = '';
            await loadHolidays();
        } else {
            window.showToast(window.describeApiError(data.detail)
                || tr("set.holidayAddFailed", "Failed to add holiday"), "error");
        }
    } catch (e) {
        console.error("Error adding holiday:", e);
        window.showToast(tr("set.networkError", "Network error."), "error");
    }
});

document.getElementById('btnAddHolidayRange').addEventListener('click', async () => {
    const from_date = document.getElementById('holiday_from').value;
    const to_date   = document.getElementById('holiday_to').value;
    const desc      = document.getElementById('holiday_range_desc').value;
    const standard  = document.getElementById('holiday_range_standard').value;

    if (!from_date || !to_date) {
        window.showToast(tr("set.rangeNeedDates", "Please select both From and To dates."), "error");
        return;
    }
    if (to_date < from_date) {
        window.showToast(tr("set.rangeOrder", "'To' date must be on or after 'From' date."), "error");
        return;
    }

    try {
        const resp = await window.apiFetch('/api/holidays/range', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_date, to_date, description: desc || 'Holiday', standard: standard })
        });

        const data = await resp.json();
        if (resp.ok) {
            // Same guard as the single-day form: trust the server's echoed standard.
            if (data?.standard === standard) {
                window.showToast(data.message, "success");
            } else {
                window.showToast(
                    trf("set.rangeWrongStandard", { saved: data?.standard || 'All', wanted: standard },
                        `Range saved as "${data?.standard || 'All'}", not "${standard}". Close and reopen the app so the latest version loads.`),
                    "error"
                );
            }
            document.getElementById('holiday_from').value = '';
            document.getElementById('holiday_to').value   = '';
            document.getElementById('holiday_range_desc').value = '';
            loadHolidays();
        } else {
            window.showToast(window.describeApiError(data.detail)
                || tr("set.rangeAddFailed", "Failed to add holiday range"), "error");
        }
    } catch (e) {
        console.error("Error adding holiday range:", e);
        window.showToast(tr("set.networkError", "Network error."), "error");
    }
});

async function deleteHoliday(id) {
    if (!window.confirmTwice(
        tr("set.confirmRemoveHoliday", "Remove this holiday?"),
        tr("set.confirmRemoveHolidayAgain", "Please confirm again to permanently remove this holiday."))) return;

    try {
        const resp = await window.apiFetch(`/api/holidays/${id}`, {
            method: 'DELETE'
        });

        if (resp.ok) {
            window.showToast(tr("set.holidayRemoved", "Holiday removed."), "success");
            loadHolidays();
        } else {
            window.showToast(tr("set.holidayRemoveFailed", "Failed to remove holiday."), "error");
        }
    } catch (e) {
        console.error("Error deleting holiday:", e);
    }
}

// HTML escaping utility — holiday descriptions and class names are free text.
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// escapeHtml() leaves quotes alone, which is fine for text nodes but would let a
// class name containing a double quote break out of an attribute.
function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// ── Class tools ──────────────────────────────────────────────────────────────
// Year-end promotion, forward class-to-class moves, and clearing a batch.

function wireClassTools() {
    const refresh = document.getElementById("btn-refresh-counts");
    const preview = document.getElementById("btn-preview-promotion");
    const move = document.getElementById("btn-move-class");
    const clear = document.getElementById("btn-clear-class");
    const graduateAction = document.getElementById("graduate-action");
    const moveFrom = document.getElementById("move-from");

    if (refresh) refresh.addEventListener("click", () => loadClassCounts(true));
    if (preview) preview.addEventListener("click", previewPromotion);
    if (move) move.addEventListener("click", moveClass);
    if (clear) clear.addEventListener("click", openDeleteClassModal);

    if (graduateAction) {
        graduateAction.addEventListener("change", () => {
            if (window.cachedPromotionPlan) renderPromotionPlan(window.cachedPromotionPlan);
        });
    }

    if (moveFrom) {
        moveFrom.addEventListener("change", updateMoveToOptions);
        moveFrom.addEventListener("standards-loaded", updateMoveToOptions);
    }

    // Modal backdrop click handler
    window.addEventListener("click", (e) => {
        const modal = document.getElementById("delete-class-modal");
        if (modal && e.target === modal) {
            closeDeleteClassModal();
        }
    });

    // Modal escape key handler
    window.addEventListener("keydown", (e) => {
        if (e.key === "Escape") {
            closeDeleteClassModal();
        }
    });
}

async function updateMoveToOptions() {
    const moveFrom = document.getElementById("move-from");
    const moveTo = document.getElementById("move-to");
    if (!moveFrom || !moveTo) return;

    const fromVal = (moveFrom.value || "").trim();

    // Dynamically retrieve standards from memory, cached settings, or window.getStandards()
    let standards = (_standards && _standards.length) ? [..._standards] : [];
    if (!standards.length && typeof window.getStandards === "function") {
        try {
            standards = await window.getStandards();
        } catch (e) {
            standards = [];
        }
    }
    if (!standards.length) {
        standards = Array.from(moveFrom.options).map(o => o.value).filter(Boolean);
    }

    if (!fromVal) {
        moveTo.innerHTML = `<option value="" disabled selected>Select source class first</option>`;
        moveTo.disabled = true;
        return;
    }

    // Destination classes: all available classes except the chosen From class
    const destinationClasses = standards.filter(s => s !== fromVal);

    if (destinationClasses.length === 0) {
        moveTo.innerHTML = `<option value="" disabled selected>No other classes available</option>`;
        moveTo.disabled = true;
        return;
    }

    moveTo.disabled = false;
    let html = `<option value="" disabled selected>Select destination class</option>`;
    destinationClasses.forEach(dest => {
        html += `<option value="${escapeAttr(dest)}">${escapeHtml(dest)}</option>`;
    });
    moveTo.innerHTML = html;
}

async function loadClassCounts(announce = false) {
    const box = document.getElementById("class-counts");
    if (!box) return;

    try {
        const resp = await window.apiFetch('/api/students/by-standard');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const rows = data.standards || [];
        window.cachedClassCounts = rows;

        if (rows.length === 0) {
            box.innerHTML = `<span style="font-size:13px; color: var(--text-muted);">${tr("students.none", "No students enrolled.")}</span>`;
            return;
        }

        box.innerHTML = rows.map(r => {
            const archived = r.archived > 0
                ? ` <span class="count-value" style="color: var(--text-muted);">+${r.archived}</span>`
                : "";
            const title = r.archived > 0
                ? ` title="${escapeAttr(r.archived + " " + tr("students.archived", "Archived"))}"`
                : "";
            return `<span class="count-chip${r.archived > 0 && r.active === 0 ? ' archived' : ''}"${title}>` +
                `<strong>${escapeHtml(r.standard)}</strong>` +
                `<span class="count-value">${r.active}</span>${archived}</span>`;
        }).join("");

        if (announce) window.showToast(tr("classTools.countsRefreshed", "Class sizes updated."), "success");
    } catch (e) {
        console.error("Class counts failed", e);
        box.innerHTML = `<span style="font-size:13px; color: var(--danger);">${tr("classTools.countsFailed", "Could not read the class sizes.")}</span>`;
    }
}

/** Head count of one class, from the cached chips — used only in confirm text. */
function cachedCountFor(standard, key = "active") {
    const rows = window.cachedClassCounts || [];
    const match = rows.find(r => r.standard === standard);
    return match ? match[key] : 0;
}

async function previewPromotion() {
    const box = document.getElementById("promotion-plan");
    const button = document.getElementById("btn-preview-promotion");
    if (!box) return;

    box.style.display = "block";
    box.innerHTML = `<span style="color: var(--text-muted);">${tr("classTools.loadingPlan", "Working out the plan…")}</span>`;
    button.disabled = true;

    try {
        const resp = await window.apiFetch('/api/students/promotion-plan');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        window.cachedPromotionPlan = data;
        renderPromotionPlan(data);
    } catch (e) {
        console.error("Promotion plan failed", e);
        box.innerHTML = `<span style="color: var(--danger);">${tr("classTools.planFailed", "Could not build the promotion plan.")}</span>`;
    } finally {
        button.disabled = false;
    }
}

function renderPromotionPlan(data) {
    const box = document.getElementById("promotion-plan");
    const plan = data.plan || [];

    if (plan.length < 2) {
        box.innerHTML = `<span style="color: var(--danger);">${tr("classTools.needTwoClasses", "Add at least two classes in Settings before promoting.")}</span>`;
        return;
    }

    const action = document.getElementById("graduate-action").value || "archive";
    const graduateConsequence = {
        archive: tr("classTools.graduatingArchive", "will be archived (records kept)"),
        delete: tr("classTools.graduatingDelete", "will be deleted permanently, with all attendance"),
        keep: tr("classTools.graduatingKeep", "stay where they are")
    }[action];

    const items = plan.map(step => {
        const count = step.students;
        if (step.graduating) {
            if (count === 0) {
                return `<li class="plan-empty">${escapeHtml(step.from_standard)} — ${tr("classTools.noStudents", "No students in this class.")}</li>`;
            }
            return `<li class="plan-graduating">${escapeHtml(step.from_standard)} · ${count} ` +
                `${tr("classTools.students", "students")} ${tr("classTools.willGraduate", "graduating")} — ${escapeHtml(graduateConsequence)}</li>`;
        }
        if (count === 0) {
            return `<li class="plan-empty">${escapeHtml(step.from_standard)} → ${escapeHtml(step.to_standard)} — ${tr("classTools.noStudents", "No students in this class.")}</li>`;
        }
        return `<li>${escapeHtml(step.from_standard)} → ${escapeHtml(step.to_standard)} · ${count} ${tr("classTools.students", "students")}</li>`;
    }).join("");

    const nobody = (data.total_moving || 0) === 0 && (data.total_graduating || 0) === 0;

    box.innerHTML = `
        <h5>${tr("classTools.planTitle", "What will happen")}</h5>
        <ul>${items}</ul>
        ${nobody
            ? `<span class="plan-empty">${tr("classTools.nothingToDo", "Nothing to promote — no students are enrolled.")}</span>`
            : `<label class="tool-label" for="promote-confirm">${tr("classTools.typePromote", "Type PROMOTE to confirm")}</label>
               <input type="text" id="promote-confirm" class="input-field" autocomplete="off" spellcheck="false">
               <button type="button" class="btn btn-danger" id="btn-confirm-promotion" style="margin-top: 10px;">${tr("classTools.promoteConfirmBtn", "Promote All Classes")}</button>`}
    `;

    const confirmBtn = document.getElementById("btn-confirm-promotion");
    if (confirmBtn) confirmBtn.addEventListener("click", confirmPromotion);

    const promoteInput = document.getElementById("promote-confirm");
    if (promoteInput) {
        promoteInput.addEventListener("keydown", (e) => {
            if (e.key === "Enter") {
                e.preventDefault();
                confirmPromotion();
            }
        });
    }
}

async function confirmPromotion() {
    const input = document.getElementById("promote-confirm");
    const button = document.getElementById("btn-confirm-promotion");
    const typed = (input.value || "").trim();

    if (typed !== "PROMOTE") {
        window.showToast(tr("classTools.promoteConfirm", "Type PROMOTE (in capitals) to run this promotion."), "warning");
        input.focus();
        return;
    }

    if (!window.confirmTwice(
        tr("classTools.promoteConfirmAgain", "The promotion plan is ready. Do you want to continue?"),
        tr("classTools.promoteFinalConfirm", "Please confirm again to promote all classes."))) return;

    const action = document.getElementById("graduate-action").value || "archive";
    const original = button.textContent;
    button.disabled = true;
    button.textContent = tr("common.working", "Working…");

    try {
        const resp = await window.apiFetch('/api/students/promote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graduate_action: action, confirm: "PROMOTE" })
        });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("classTools.promoteFailed", "Could not run the promotion."), "error");
            return;
        }

        const result = await resp.json();
        let message = trf("classTools.promoted", { moved: result.promoted },
            `Promotion complete. ${result.promoted} students moved.`);
        if (result.graduate_action === "archive" && result.graduated > 0) {
            message += " " + trf("classTools.promotedArchived", { n: result.graduated }, `${result.graduated} archived.`);
        } else if (result.graduate_action === "delete" && result.graduated > 0) {
            message += " " + trf("classTools.promotedDeleted", { n: result.graduated }, `${result.graduated} deleted.`);
        }
        window.showToast(message, "success");

        window.cachedPromotionPlan = null;
        document.getElementById("promotion-plan").style.display = "none";
        loadClassCounts();
    } catch (e) {
        console.error("Promotion failed", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

async function moveClass() {
    const from = (document.getElementById("move-from").value || "").trim();
    const to = (document.getElementById("move-to").value || "").trim();
    const button = document.getElementById("btn-move-class");

    if (!from || !to) {
        window.showToast("Choose both a source and a destination class.", "warning");
        return;
    }
    if (from === to) {
        window.showToast("Those are the same class — nothing to move.", "warning");
        return;
    }

    const standards = (_standards && _standards.length) ? _standards : (await window.getStandards());
    const sourceIdx = standards.indexOf(from);
    const targetIdx = standards.indexOf(to);

    if (sourceIdx === -1 || targetIdx === -1) {
        window.showToast("Please select valid classes.", "error");
        return;
    }

    const count = cachedCountFor(from);
    if (count === 0) {
        window.showToast(`There are no active students in ${from}.`, "warning");
        return;
    }

    if (!window.confirmTwice(
        `Move ${count} students from ${from} to ${to}?`,
        "Please confirm again to move these students.")) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = "Working…";

    try {
        const resp = await window.apiFetch('/api/students/change-standard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_standard: from, to_standard: to })
        });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) || "Could not move that class.", "error");
            return;
        }

        const result = await resp.json();
        window.showToast(`Moved ${result.moved} students to ${to}.`, "success");
        await loadClassCounts();
        await updateMoveToOptions();
    } catch (e) {
        console.error("Class move failed", e);
        window.showToast("Error connecting to server", "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

function openDeleteClassModal() {
    const select = document.getElementById("clear-class");
    const cls = (select ? select.value : "").trim();

    if (!cls) {
        window.showToast("Choose the class you want to delete.", "warning");
        return;
    }

    const total = cachedCountFor(cls, "total");
    const active = cachedCountFor(cls, "active");
    const displayCount = total > 0 ? `${total} students (${active} active)` : `0 students`;

    const modal = document.getElementById("delete-class-modal");
    const targetName = document.getElementById("delete-class-target-name");
    const displayName = document.getElementById("delete-class-display-name");
    const studentCount = document.getElementById("delete-class-student-count");
    const hiddenInput = document.getElementById("delete_class_standard");
    const checkbox = document.getElementById("delete-class-confirm-checkbox");
    const deleteBtn = document.getElementById("btn-confirm-delete-class");

    if (targetName) targetName.textContent = cls;
    if (displayName) displayName.textContent = cls;
    if (studentCount) studentCount.textContent = displayCount;
    if (hiddenInput) hiddenInput.value = cls;
    if (checkbox) checkbox.checked = false;
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = "0.5";
        deleteBtn.style.cursor = "not-allowed";
        deleteBtn.textContent = "Delete";
    }

    if (modal) modal.style.display = "block";
}

function closeDeleteClassModal() {
    const modal = document.getElementById("delete-class-modal");
    if (modal) modal.style.display = "none";
    const checkbox = document.getElementById("delete-class-confirm-checkbox");
    if (checkbox) checkbox.checked = false;
    const deleteBtn = document.getElementById("btn-confirm-delete-class");
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.style.opacity = "0.5";
        deleteBtn.style.cursor = "not-allowed";
        deleteBtn.textContent = "Delete";
    }
}

function onDeleteClassCheckboxChange() {
    const checkbox = document.getElementById("delete-class-confirm-checkbox");
    const deleteBtn = document.getElementById("btn-confirm-delete-class");
    if (deleteBtn) {
        if (checkbox && checkbox.checked) {
            deleteBtn.disabled = false;
            deleteBtn.style.opacity = "1";
            deleteBtn.style.cursor = "pointer";
        } else {
            deleteBtn.disabled = true;
            deleteBtn.style.opacity = "0.5";
            deleteBtn.style.cursor = "not-allowed";
        }
    }
}

async function executeDeleteClass() {
    const hiddenInput = document.getElementById("delete_class_standard");
    const cls = (hiddenInput ? hiddenInput.value : "").trim();
    const deleteBtn = document.getElementById("btn-confirm-delete-class");
    const checkbox = document.getElementById("delete-class-confirm-checkbox");

    if (!cls) {
        window.showToast("No class selected.", "warning");
        closeDeleteClassModal();
        return;
    }

    if (!checkbox || !checkbox.checked) {
        window.showToast("Please confirm by checking the box before deleting.", "warning");
        return;
    }

    const originalText = deleteBtn ? deleteBtn.textContent : "Delete";
    if (deleteBtn) {
        deleteBtn.disabled = true;
        deleteBtn.textContent = "Deleting…";
    }

    try {
        const resp = await window.apiFetch('/api/students/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ standard: cls, confirm: cls, include_archived: true })
        });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) || "Could not delete that class.", "error");
            return;
        }

        const result = await resp.json();
        closeDeleteClassModal();

        const msg = result.students_deleted > 0
            ? `Deleted class "${cls}" with ${result.students_deleted} students and ${result.attendance_deleted} attendance records.`
            : `Class "${cls}" has been successfully removed.`;
        window.showToast(msg, "success");

        // Remove from local _standards array if present
        if (Array.isArray(_standards)) {
            _standards = _standards.filter(s => s !== cls);
            renderStandards();
        }

        // Refresh standards everywhere
        if (typeof window.refreshStandards === "function") {
            await window.refreshStandards();
        }

        // Reload class counts & update options
        await loadClassCounts();
        await updateMoveToOptions();

        // Clear selection in clear-class dropdown
        const clearSelect = document.getElementById("clear-class");
        if (clearSelect) clearSelect.value = "";
    } catch (e) {
        console.error("Class delete failed", e);
        window.showToast("Error connecting to server", "error");
    } finally {
        if (deleteBtn) {
            deleteBtn.disabled = false;
            deleteBtn.textContent = originalText;
        }
    }
}

window.openDeleteClassModal = openDeleteClassModal;
window.closeDeleteClassModal = closeDeleteClassModal;
window.onDeleteClassCheckboxChange = onDeleteClassCheckboxChange;
window.executeDeleteClass = executeDeleteClass;

