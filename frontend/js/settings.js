document.addEventListener("DOMContentLoaded", () => {
    loadSettings();
    loadHolidays();
});

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
            document.getElementById('institute_name').value = data.institute_name || 'My Institute';
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
    const institute_name = document.getElementById('institute_name').value;

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
                out_time: out_time,
                institute_name: institute_name
            })
        });

        if (resp.ok) {
            window.showToast("Settings saved successfully!", "success");
        } else {
            const errData = await resp.json().catch(() => null);
            const errMsg = errData?.detail || "Failed to save settings.";
            window.showToast(errMsg, "error");
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

document.getElementById('btnExportDb').addEventListener('click', () => {
    // Navigate to the export endpoint which triggers a download
    window.location.href = '/api/settings/export-db';
});

document.getElementById('btnImportDb').addEventListener('click', () => {
    document.getElementById('importDbFile').click();
});

document.getElementById('importDbFile').addEventListener('change', async (e) => {
    const file = e.target.files[0];
    if (!file) return;

    if (!confirm("WARNING: Importing a database will replace ALL current students, attendance, and settings. The application will restart.\n\nAre you sure you want to proceed?")) {
        e.target.value = ''; // Reset input
        return;
    }

    const formData = new FormData();
    formData.append('file', file);

    window.showToast("Uploading database...", "warning");

    try {
        const resp = await fetch('/api/settings/import-db', {
            method: 'POST',
            body: formData
        });

        if (resp.ok) {
            window.showToast("Database imported successfully! Reloading...", "success");
            setTimeout(() => {
                window.location.reload();
            }, 2000);
        } else {
            const data = await resp.json().catch(() => null);
            window.showToast("Import failed: " + (data?.detail || "Unknown error"), "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Network error during import.", "error");
    } finally {
        e.target.value = ''; // Reset input
    }
});

// --- Holiday Management ---
async function loadHolidays() {
    try {
        const resp = await fetch('/api/holidays');
        if (resp.ok) {
            const holidays = await resp.json();
            const tbody = document.getElementById('holidaysTableBody');
            tbody.innerHTML = '';
            
            if (holidays.length === 0) {
                tbody.innerHTML = '<tr><td colspan="3" style="text-align:center; padding:10px;">No holidays configured.</td></tr>';
                return;
            }

            holidays.forEach(h => {
                const tr = document.createElement('tr');
                tr.innerHTML = `
                    <td style="padding: 8px; border: 1px solid #ddd;">${h.date}</td>
                    <td style="padding: 8px; border: 1px solid #ddd;">${h.description}</td>
                    <td style="padding: 8px; border: 1px solid #ddd; text-align: center;">
                        <button onclick="deleteHoliday(${h.id})" style="background: var(--danger); color: white; border: none; padding: 5px 10px; border-radius: 4px; cursor: pointer;">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Failed to load holidays:", e);
    }
}

document.getElementById('btnAddHoliday').addEventListener('click', async () => {
    const date = document.getElementById('holiday_date').value;
    const desc = document.getElementById('holiday_desc').value;

    if (!date) {
        window.showToast("Please select a date.", "error");
        return;
    }

    try {
        const resp = await fetch('/api/holidays', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ date: date, description: desc || 'Holiday' })
        });

        if (resp.ok) {
            window.showToast("Holiday added!", "success");
            document.getElementById('holiday_date').value = '';
            document.getElementById('holiday_desc').value = '';
            loadHolidays();
        } else {
            const err = await resp.json();
            window.showToast(err.detail || "Failed to add holiday", "error");
        }
    } catch (e) {
        console.error("Error adding holiday:", e);
        window.showToast("Network error.", "error");
    }
});

document.getElementById('btnAddHolidayRange').addEventListener('click', async () => {
    const from_date = document.getElementById('holiday_from').value;
    const to_date   = document.getElementById('holiday_to').value;
    const desc      = document.getElementById('holiday_range_desc').value;

    if (!from_date || !to_date) {
        window.showToast("Please select both From and To dates.", "error");
        return;
    }
    if (to_date < from_date) {
        window.showToast("'To' date must be on or after 'From' date.", "error");
        return;
    }

    try {
        const resp = await fetch('/api/holidays/range', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_date, to_date, description: desc || 'Holiday' })
        });

        const data = await resp.json();
        if (resp.ok) {
            window.showToast(data.message, "success");
            document.getElementById('holiday_from').value = '';
            document.getElementById('holiday_to').value   = '';
            document.getElementById('holiday_range_desc').value = '';
            loadHolidays();
        } else {
            window.showToast(data.detail || "Failed to add holiday range", "error");
        }
    } catch (e) {
        console.error("Error adding holiday range:", e);
        window.showToast("Network error.", "error");
    }
});

async function deleteHoliday(id) {
    if (!confirm("Remove this holiday?")) return;

    try {
        const resp = await fetch(`/api/holidays/${id}`, {
            method: 'DELETE'
        });

        if (resp.ok) {
            window.showToast("Holiday removed.", "success");
            loadHolidays();
        } else {
            window.showToast("Failed to remove holiday.", "error");
        }
    } catch (e) {
        console.error("Error deleting holiday:", e);
    }
}

