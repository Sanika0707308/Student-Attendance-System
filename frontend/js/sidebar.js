class Sidebar extends HTMLElement {
    connectedCallback() {
        // Auth guard — redirect to login if not authenticated
        if (sessionStorage.getItem("authenticated") !== "true") {
            window.location.href = "login.html";
            return;
        }

        let currentPage = window.location.pathname.split('/').pop();
        if (!currentPage || currentPage === '') currentPage = 'dashboard.html';

        this.innerHTML = `
        <div class="sidebar">
            <h2 class="institute-name">STC's Vidyamandir Institute</h2>
            <div id="device-status-indicator" style="text-align: center; margin-top: -30px; margin-bottom: 30px; font-size: 11px; font-weight: 600; color: var(--text-muted); display: flex; justify-content: center; align-items: center; gap: 6px;">
                <span class="status-dot offline"></span>
                <span>DEVICE OFFLINE</span>
            </div>
            <nav>
                <a href="dashboard.html" class="${currentPage === 'dashboard.html' ? 'active' : ''}">🏠 Dashboard</a>
                <a href="students.html" class="${currentPage === 'students.html' ? 'active' : ''}">👩‍🎓 Students</a>
                <a href="attendance.html" class="${currentPage === 'attendance.html' ? 'active' : ''}">📝 Attendance</a>
                <a href="reports.html" class="${currentPage === 'reports.html' ? 'active' : ''}">📊 Reports</a>
                <a href="settings.html" class="${currentPage === 'settings.html' ? 'active' : ''}">⚙️ Settings</a>
                <a href="#" onclick="logout()" style="margin-top: auto;">🚪 Logout</a>
            </nav>
        </div>
        `;

        // Inject global toast container if it doesn't exist
        if (!document.getElementById('toast-container')) {
            const toastDiv = document.createElement('div');
            toastDiv.id = 'toast-container';
            toastDiv.className = 'toast';
            document.body.appendChild(toastDiv);
        }

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
                        indicatorDiv.innerHTML = '<span class="status-dot online"></span><span style="color: var(--success);">DEVICE ONLINE</span>';
                    } else {
                        indicatorDiv.innerHTML = '<span class="status-dot offline"></span><span style="color: var(--danger);">DEVICE OFFLINE</span>';
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

// Logout function — clears session and redirects
function logout() {
    sessionStorage.removeItem("authenticated");
    window.location.href = "login.html";
}
