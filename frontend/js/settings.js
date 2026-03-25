document.addEventListener("DOMContentLoaded", loadSettings);

async function loadSettings() {
    try {
        const resp = await fetch('/api/settings');
        if (resp.ok) {
            const data = await resp.json();
            document.getElementById('zk_ip_address').value = data.zk_ip_address || '';
            document.getElementById('smtp_email').value = data.smtp_email || '';
            document.getElementById('smtp_password').value = data.smtp_password || '';
            document.getElementById('in_time').value = data.in_time || '08:30';
            document.getElementById('mid_time').value = data.mid_time || '12:00';
            document.getElementById('out_time').value = data.out_time || '15:00';
        }
    } catch (e) {
        console.error("Failed to load settings from server:", e);
    }
}

document.getElementById('settingsForm').addEventListener('submit', async (e) => {
    e.preventDefault();

    const zk_ip_address = document.getElementById('zk_ip_address').value;
    const smtp_email = document.getElementById('smtp_email').value;
    const smtp_password = document.getElementById('smtp_password').value;
    const in_time = document.getElementById('in_time').value;
    const mid_time = document.getElementById('mid_time').value;
    const out_time = document.getElementById('out_time').value;

    try {
        const resp = await fetch('/api/settings', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                zk_ip_address: zk_ip_address,
                smtp_email: smtp_email,
                smtp_password: smtp_password,
                in_time: in_time,
                mid_time: mid_time,
                out_time: out_time
            })
        });

        if (resp.ok) {
            window.showToast("Settings saved successfully!", "success");
        } else {
            window.showToast("Failed to save settings.", "error");
        }
    } catch (e) {
        console.error("Error saving settings:", e);
        window.showToast("Network error. Failed to save.", "error");
    }
});

document.getElementById('btnTestConnection').addEventListener('click', async () => {
    const zk_ip_address = document.getElementById('zk_ip_address').value;
    if (!zk_ip_address) {
        window.showToast("Please enter an IP address first.", "error");
        return;
    }

    window.showToast("Testing connection... Please wait.", "success");

    try {
        const resp = await fetch('/api/settings/test-connection', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ zk_ip_address: zk_ip_address })
        });

        const data = await resp.json();
        if (data.success) {
            window.showToast("Connection successful! Device is reachable.", "success");
        } else {
            window.showToast(data.message || "Failed to connect to device.", "error");
        }
    } catch (e) {
        console.error("Error testing connection:", e);
        window.showToast("Network error while testing connection.", "error");
    }
});

document.getElementById('btnClearLogs').addEventListener('click', async () => {
    if (!confirm("WARNING: This will permanently delete ALL attendance logs stored natively on the ZKTeco hardware. This action cannot be reversed. \n\nAre you absolutely sure?")) {
        return;
    }

    window.showToast("Initiating hardware memory wipe...", "warning");

    try {
        const resp = await fetch('/api/settings/clear-device-logs', { method: 'POST' });
        const data = await resp.json();

        if (data.success) {
            window.showToast(data.message, "success");
        } else {
            window.showToast("Error wiping hardware: " + data.message, "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Network Error: Failed to reach hardware wipe service.", "error");
    }
});
