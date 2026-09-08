// ── Theme ────────────────────────────────────────────────────────────────────
// Applied before the sidebar renders (and before any page script runs) so a
// dark-mode reload never flashes the light palette first.

const THEME_KEY = "attendance-theme";

window.getTheme = function () {
    try {
        return localStorage.getItem(THEME_KEY) === "dark" ? "dark" : "light";
    } catch (e) {
        return "light";   // private mode / storage disabled
    }
};

window.applyTheme = function (theme) {
    document.documentElement.setAttribute("data-theme", theme === "dark" ? "dark" : "light");
    try {
        localStorage.setItem(THEME_KEY, theme === "dark" ? "dark" : "light");
    } catch (e) { /* Theme still applies for this page view. */ }
};

window.applyTheme(window.getTheme());

// ── Language ─────────────────────────────────────────────────────────────────
// i18n.js is loaded before this file on every page, but the sidebar has to
// survive being loaded on its own (and an older cached i18n.js after an
// upgrade), so every lookup here carries its English fallback.

function tr(key, english) {
    return typeof window.t === "function" ? window.t(key, english) : english;
}

// ── Standards ────────────────────────────────────────────────────────────────
// The class list used to be hardcoded as 11th/12th in seven <select> blocks
// across four pages. It now comes from Settings, so every dropdown is filled
// from one place.

let _standardsPromise = null;

window.getStandards = function () {
    if (!_standardsPromise) {
        _standardsPromise = fetch("/api/settings/standards")
            .then(resp => resp.ok ? resp.json() : null)
            .then(list => (Array.isArray(list) && list.length) ? list : ["11th", "12th"])
            .catch(() => ["11th", "12th"]);
    }
    return _standardsPromise;
};

/** Drop the cached list after Settings edits it, so every dropdown re-reads. */
window.refreshStandards = function () {
    _standardsPromise = null;
    return window.populateStandardSelects();
};

/**
 * Fill every <select data-standards> on the page.
 *
 * data-standards="all"  prepends an "All Standards" option (filters)
 * data-standards="one"  lists only real classes (add/edit forms)
 * data-placeholder="…"  prepends a disabled empty option, so a required field
 *                       forces a deliberate choice instead of silently
 *                       defaulting a new student into the first class
 *
 * A selection made before the fetch resolves is preserved, as is a value the
 * page set programmatically — otherwise opening the edit modal for a 12th
 * student could silently reset them to 11th.
 */
window.populateStandardSelects = async function (root = document) {
    const selects = root.querySelectorAll("select[data-standards]");
    if (!selects.length) return;

    const standards = await window.getStandards();

    selects.forEach(select => {
        const desired = select.dataset.selected || select.value;
        // Options are built here rather than in markup, so their labels cannot
        // carry data-i18n attributes — the key is named on the <select> instead.
        const allLabel = select.dataset.allLabelKey
            ? tr(select.dataset.allLabelKey, select.dataset.allLabel || "All Standards")
            : (select.dataset.allLabel || tr("common.allStandards", "All Standards"));
        const placeholder = select.dataset.placeholderKey
            ? tr(select.dataset.placeholderKey, select.dataset.placeholder || "")
            : select.dataset.placeholder;
        const options = [];

        if (placeholder) {
            const label = String(placeholder).replace(/</g, "&lt;");
            options.push(`<option value="" disabled selected>${label}</option>`);
        }
        if (select.dataset.standards === "all") {
            options.push(`<option value="All">${allLabel}</option>`);
        }
        standards.forEach(s => {
            const safe = String(s).replace(/"/g, "&quot;");
            options.push(`<option value="${safe}">${safe}</option>`);
        });

        select.innerHTML = options.join("");

        if (desired && Array.from(select.options).some(o => o.value === desired)) {
            select.value = desired;
        }
        delete select.dataset.selected;
        select.dispatchEvent(new Event("standards-loaded"));
    });
};

class Sidebar extends HTMLElement {
    connectedCallback() {
        // Fast client-side guard so a stale tab bounces immediately. The real
        // boundary is the server middleware — this only saves a round trip.
        if (sessionStorage.getItem("authenticated") !== "true") {
            window.location.href = "login.html";
            return;
        }

        let currentPage = window.location.pathname.split('/').pop();
        if (!currentPage || currentPage === '') currentPage = 'dashboard.html';

        const isDark = window.getTheme() === "dark";
        const themeLabel = isDark
            ? "☀️ " + tr("nav.lightMode", "Light Mode")
            : "🌙 " + tr("nav.darkMode", "Dark Mode");
        // The toggle shows the language you would switch *to*, always written in
        // that language — "मराठी" in an English UI and "English" in a Marathi one.
        // A label like "Language" would leave a Marathi-only user guessing.
        const otherLangLabel = tr("nav.language", "मराठी");

        this.innerHTML = `
        <div class="sidebar">
            <h2 class="institute-name" id="sidebar-institute-name">Biometric Attendance</h2>
            <div id="device-status-indicator" style="text-align: center; margin-top: -30px; margin-bottom: 30px; font-size: 11px; font-weight: 600; color: var(--text-muted); display: flex; justify-content: center; align-items: center; gap: 6px;">
                <span class="status-dot offline"></span>
                <span>${tr("device.offline", "DEVICE OFFLINE")}</span>
            </div>
            <nav>
                <a href="dashboard.html" class="${currentPage === 'dashboard.html' ? 'active' : ''}">🏠 ${tr("nav.dashboard", "Dashboard")}</a>
                <a href="students.html" class="${currentPage === 'students.html' ? 'active' : ''}">👩‍🎓 ${tr("nav.students", "Students")}</a>
                <a href="attendance.html" class="${currentPage === 'attendance.html' ? 'active' : ''}">📝 ${tr("nav.attendance", "Attendance")}</a>
                <a href="reports.html" class="${currentPage === 'reports.html' ? 'active' : ''}">📊 ${tr("nav.reports", "Reports")}</a>
                <a href="settings.html" class="${currentPage === 'settings.html' ? 'active' : ''}">⚙️ ${tr("nav.settings", "Settings")}</a>
                <a href="#" id="lang-toggle" style="margin-top: auto;">🌐 ${otherLangLabel}</a>
                <a href="#" id="theme-toggle">${themeLabel}</a>
                <a href="#" onclick="logout(event)">🚪 ${tr("nav.logout", "Logout")}</a>
            </nav>
        </div>
        `;

        const langToggle = this.querySelector('#lang-toggle');
        if (langToggle) {
            langToggle.addEventListener('click', (event) => {
                event.preventDefault();
                const current = typeof window.getLang === "function" ? window.getLang() : "en";
                window.setLang(current === "mr" ? "en" : "mr");   // reloads the page
            });
        }

        const themeToggle = this.querySelector('#theme-toggle');
        if (themeToggle) {
            themeToggle.addEventListener('click', (event) => {
                event.preventDefault();
                const next = window.getTheme() === "dark" ? "light" : "dark";
                window.applyTheme(next);
                themeToggle.textContent = next === "dark"
                    ? "☀️ " + tr("nav.lightMode", "Light Mode")
                    : "🌙 " + tr("nav.darkMode", "Dark Mode");
            });
        }

        // Inject global toast container if it doesn't exist
        if (!document.getElementById('toast-container')) {
            const toastDiv = document.createElement('div');
            toastDiv.id = 'toast-container';
            toastDiv.className = 'toast';
            document.body.appendChild(toastDiv);
        }

        fetch('/api/settings')
            .then(resp => resp.ok ? resp.json() : null)
            .then(data => {
                const name = data?.institute_name?.trim();
                const heading = document.getElementById('sidebar-institute-name');
                if (heading && name) heading.textContent = name;
            })
            .catch(() => { /* Keep the useful default if settings are unavailable. */ });

        window.populateStandardSelects();
        this.startDeviceStatusPolling();
    }

    async startDeviceStatusPolling() {
        const checkStatus = async () => {
            try {
                const resp = await fetch('/api/settings/device-status');
                const data = await resp.json();

                const indicatorDiv = document.getElementById('device-status-indicator');
                if (indicatorDiv) {
                    if (data.online) {
                        indicatorDiv.innerHTML = `<span class="status-dot online"></span><span style="color: var(--success);">${tr("device.online", "DEVICE ONLINE")}</span>`;
                    } else {
                        indicatorDiv.innerHTML = `<span class="status-dot offline"></span><span style="color: var(--danger);">${tr("device.offline", "DEVICE OFFLINE")}</span>`;
                    }
                }
            } catch (e) {
                // Silently fail to not clutter console if server is simply inaccessible
            }
        };

        // Check immediately, then every 15 seconds
        checkStatus();
        setInterval(checkStatus, 15000);
    }
}

customElements.define('app-sidebar', Sidebar);

// Track active toast timer so new toasts cancel the previous timer
let _toastTimer = null;

// Global Toast function — with timer overlap fix
window.showToast = function (message, type = 'success') {
    const toast = document.getElementById('toast-container');
    if (toast) {
        // Cancel any previous timer to prevent premature dismissal
        if (_toastTimer) {
            clearTimeout(_toastTimer);
            _toastTimer = null;
        }

        toast.innerText = message;
        toast.className = `toast show ${type}`;

        // Remove toast after 3 seconds
        _toastTimer = setTimeout(() => {
            toast.className = 'toast';
            _toastTimer = null;
        }, 3000);
    } else {
        console.warn("Toast container not found.");
    }
};

window.hideToast = function () {
    const toast = document.getElementById('toast-container');
    if (toast) toast.className = 'toast';
    if (_toastTimer) {
        clearTimeout(_toastTimer);
        _toastTimer = null;
    }
};

window.confirmTwice = function (message, secondMessage = message) {
    return confirm(message) && confirm(secondMessage);
};

// Logout — destroys the server-side session, then clears the local hint.
async function logout(event) {
    if (event) event.preventDefault();
    try {
        await fetch("/api/auth/logout", { method: "POST" });
    } catch (e) {
        // Even if the request fails, drop the local flag and leave the page —
        // the session expires on its own and the user expects to be signed out.
    }
    sessionStorage.removeItem("authenticated");
    sessionStorage.removeItem("must_change_password");
    window.location.href = "login.html";
}

/**
 * fetch() wrapper that reacts to the auth middleware's 401 by returning to the
 * login screen instead of leaving the page showing an empty table.
 */
window.apiFetch = async function (url, options) {
    const resp = await fetch(url, options);
    if (resp.status === 401) {
        sessionStorage.removeItem("authenticated");
        window.location.href = "login.html";
        throw new Error("Session expired");
    }
    return resp;
};

// ── File saving ──────────────────────────────────────────────────────────────
// pywebview blocks browser-initiated downloads (ALLOW_DOWNLOADS defaults to
// False), so an <a download> silently does nothing inside the desktop window.
// Everything that produces a file routes through the native save dialog the
// Python side exposes, and falls back to a real download when the UI happens to
// be open in an ordinary browser.

/**
 * @param {string} base64      file contents, base64-encoded
 * @param {string} filename    suggested name in the save dialog
 * @param {string} description dialog file-type label, e.g. "Excel Workbook"
 * @param {string} extension   dialog filter, e.g. "*.xlsx"
 * @param {string} [mimeType]  used only by the browser fallback
 */
window.saveBase64File = function (base64, filename, description, extension, mimeType) {
    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
        return window.pywebview.api.save_file(base64, filename, description, extension)
            .then(res => {
                if (res.status === "success") {
                    window.showToast(tr("common.fileSaved", "File saved successfully to:")
                        + "\n" + res.path, "success");
                } else if (res.status === "error") {
                    window.showToast(tr("common.fileSaveFailed", "Failed to save file: {error}")
                        .replace("{error}", res.error), "error");
                }
                // status "cancelled" is the user closing the dialog — say nothing.
            })
            .catch(err => {
                console.error("save_file bridge error:", err);
                window.browserDownloadBase64(base64, filename, mimeType);
                return { status: "success" };
            });
    } else {
        window.browserDownloadBase64(base64, filename, mimeType);
        return Promise.resolve({ status: "success" });
    }
};

window.browserDownloadBase64 = function (base64, filename, mimeType) {
    const binary = window.atob(base64);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    const blob = new Blob([bytes], { type: mimeType || "application/octet-stream" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
};

/**
 * FastAPI returns `detail` as a string for HTTPException but as a list of field
 * errors for a validation failure — show something readable either way.
 */
window.describeApiError = function (detail) {
    if (!detail) return null;
    if (typeof detail === "string") return detail;
    if (Array.isArray(detail)) {
        return detail.map(d => d.msg || JSON.stringify(d)).join("; ");
    }
    return null;
};

