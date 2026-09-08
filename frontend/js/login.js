const EYE_OPEN = `<svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7S2 12 2 12z" />
    <circle cx="12" cy="12" r="3" />
</svg>`;

const EYE_OFF = `<svg class="icon-eye" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
    <path d="M17.9 17.9A10.5 10.5 0 0 1 12 19c-6.4 0-10-7-10-7a18.4 18.4 0 0 1 5.1-5.9" />
    <path d="M9.9 5.2A10.5 10.5 0 0 1 12 5c6.4 0 10 7 10 7a18.5 18.5 0 0 1-2.4 3.3" />
    <path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" />
    <path d="m2 2 20 20" />
</svg>`;

const prefersReducedMotion = () => window.matchMedia("(prefers-reduced-motion: reduce)").matches;

// i18n.js is loaded first, but keep the English fallback so a stale cached copy
// after an upgrade cannot leave the login screen blank.
function tr(key, english) {
    return typeof window.t === "function" ? window.t(key, english) : english;
}

function showError(message) {
    const error = document.getElementById("error");
    const card = document.getElementById("login-card");

    error.textContent = message;

    if (card && !prefersReducedMotion()) {
        card.classList.remove("shake");
        // Force a reflow so the animation replays on repeated failures.
        void card.offsetWidth;
        card.classList.add("shake");
        card.addEventListener("animationend", () => card.classList.remove("shake"), { once: true });
    }
}

async function login(event) {
    if (event) event.preventDefault();

    const u = document.getElementById("username").value.trim();
    const p = document.getElementById("password").value;
    const error = document.getElementById("error");
    const button = document.getElementById("login-button");
    const label = button.querySelector(".btn-label");

    error.textContent = "";

    if (!u || !p) {
        showError(tr("login.needBoth", "Enter both a username and a password"));
        return;
    }

    const setBusy = (busy) => {
        button.disabled = busy;
        button.classList.toggle("is-loading", busy);
        const text = busy ? tr("login.signingIn", "Signing in…") : tr("login.signIn", "Sign in");
        if (label) label.textContent = text;
        else button.textContent = text;
    };

    setBusy(true);

    // The password is checked by the server now, not compared in this file. The
    // response sets an HttpOnly session cookie, which is what actually unlocks
    // the pages and the API.
    try {
        const resp = await fetch("/api/auth/login", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ username: u, password: p })
        });

        if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            // Kept so the sidebar can redirect instantly on a stale tab. It is a
            // convenience only — the cookie is the real credential.
            sessionStorage.setItem("authenticated", "true");
            if (data.must_change_password) {
                sessionStorage.setItem("must_change_password", "true");
            } else {
                sessionStorage.removeItem("must_change_password");
            }
            window.location.href = "dashboard.html";
            return;
        }

        const detail = await resp.json().then(d => d.detail).catch(() => null);
        setBusy(false);
        showError(detail || tr("login.invalid", "Invalid username or password"));
        document.getElementById("password").focus();
    } catch (err) {
        setBusy(false);
        showError(tr("login.unreachable", "Cannot reach the server. Is the application still starting?"));
    }
}

document.addEventListener("DOMContentLoaded", () => {
    const password = document.getElementById("password");
    const toggle = document.getElementById("password-toggle");
    const error = document.getElementById("error");
    const card = document.getElementById("login-card");
    const button = document.getElementById("login-button");
    const capsHint = document.getElementById("caps-hint");
    const username = document.getElementById("username");

    toggle.innerHTML = EYE_OPEN;

    toggle.addEventListener("click", () => {
        const isHidden = password.type === "password";
        password.type = isHidden ? "text" : "password";
        toggle.innerHTML = isHidden ? EYE_OFF : EYE_OPEN;
        toggle.setAttribute("aria-label", isHidden
            ? tr("login.hidePassword", "Hide password")
            : tr("login.showPassword", "Show password"));
        toggle.setAttribute("aria-pressed", String(isHidden));
        password.focus();
    });

    const langToggle = document.getElementById("login-lang-toggle");
    if (langToggle) {
        langToggle.addEventListener("click", () => {
            const current = typeof window.getLang === "function" ? window.getLang() : "en";
            window.setLang(current === "mr" ? "en" : "mr");   // reloads the page
        });
    }

    document.querySelectorAll("#username, #password").forEach((input) => {
        input.addEventListener("input", () => { error.textContent = ""; });
    });

    // Caps Lock warning while typing a password.
    const syncCapsHint = (event) => {
        if (typeof event.getModifierState !== "function") return;
        capsHint.classList.toggle("show", event.getModifierState("CapsLock"));
    };
    password.addEventListener("keydown", syncCapsHint);
    password.addEventListener("keyup", syncCapsHint);
    password.addEventListener("blur", () => capsHint.classList.remove("show"));

    // Ripple feedback on the sign-in button.
    button.addEventListener("pointerdown", (event) => {
        if (button.disabled || prefersReducedMotion()) return;
        const rect = button.getBoundingClientRect();
        const size = Math.max(rect.width, rect.height);
        const ripple = document.createElement("span");
        ripple.className = "ripple";
        ripple.style.width = ripple.style.height = `${size}px`;
        ripple.style.left = `${event.clientX - rect.left - size / 2}px`;
        ripple.style.top = `${event.clientY - rect.top - size / 2}px`;
        button.appendChild(ripple);
        ripple.addEventListener("animationend", () => ripple.remove(), { once: true });
    });

    // Subtle 3D tilt that follows the pointer across the card.
    if (card && window.matchMedia("(hover: hover)").matches) {
        card.addEventListener("pointermove", (event) => {
            if (prefersReducedMotion()) return;
            const rect = card.getBoundingClientRect();
            const px = (event.clientX - rect.left) / rect.width - 0.5;
            const py = (event.clientY - rect.top) / rect.height - 0.5;
            card.classList.add("is-tilting");
            card.style.setProperty("--tilt-y", `${(px * 6).toFixed(2)}deg`);
            card.style.setProperty("--tilt-x", `${(-py * 5).toFixed(2)}deg`);
        });

        card.addEventListener("pointerleave", () => {
            card.classList.remove("is-tilting");
            card.style.setProperty("--tilt-y", "0deg");
            card.style.setProperty("--tilt-x", "0deg");
        });
    }

    if (username) username.focus();

    // /api/settings is behind the auth gate now, so the login screen reads the
    // institute name from a public endpoint that exposes nothing else.
    fetch('/api/public/branding')
        .then(resp => resp.ok ? resp.json() : null)
        .then(data => {
            const name = data?.institute_name?.trim();
            const heading = document.querySelector('.login-institute');
            if (name && heading) {
                heading.textContent = name;
                document.title = `${tr("login.title", "Login")} | ${name}`;
            }

            // On a machine that has never signed in there is no stored language
            // yet, so adopt the one saved in Settings. A local choice always
            // wins — someone who just pressed the toggle should not have it
            // undone by the server a moment later.
            const serverLang = data?.ui_language;
            if (serverLang && serverLang !== "en" && !localStorage.getItem("attendance-language")) {
                window.setLang(serverLang);   // reloads
            }
        })
        .catch(() => { /* Login remains usable while the server is starting. */ });
});
