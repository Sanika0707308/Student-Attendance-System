document.addEventListener("DOMContentLoaded", () => {
    // Set date to today initially
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("attendance-date").value = today;
    loadAttendance();

    // --- NEW: Auto-update feature every 10 seconds ---
    setInterval(() => {
        const selectedDate = document.getElementById("attendance-date").value;
        const todayStr = new Date().toISOString().split("T")[0];
        
        // Only auto-update if we are looking at today's records
        if (selectedDate === todayStr) {
            console.log("Auto-refreshing attendance table...");
            loadAttendance();
        }
    }, 10000); 
});

async function loadAttendance() {
    const selectedDate = document.getElementById("attendance-date").value;
    try {
        let url = '/api/attendance';
        if (selectedDate) url += `?date=${selectedDate}`;
        const resp = await fetch(url);
        const logs = await resp.json();

        const tbodyEl = document.getElementById("attendance-table-body");
        tbodyEl.innerHTML = "";

        if (logs.length === 0) {
            tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No attendance records found for this date.</td></tr>";
            return;
        }

        // Group logs by student to pair IN/OUT times
        const studentLogs = {};
        logs.forEach(log => {
            const key = log.student_name;
            if (!studentLogs[key]) {
                studentLogs[key] = [];
            }
            studentLogs[key].push(log);
        });

        Object.keys(studentLogs).forEach(studentName => {
            const punches = studentLogs[studentName];
            // Sort by punch_time ascending
            punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

            const firstPunch = punches[0];
            const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;

            const inTime = new Date(firstPunch.punch_time).toLocaleTimeString();
            const outTime = lastPunch ? new Date(lastPunch.punch_time).toLocaleTimeString() : '--';

            // Use the last status as the effective status
            const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;
            const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
            const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(effectiveStatus)}</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(studentName)}</td>
                <td>${inTime}</td>
                <td>${outTime}</td>
                <td>${badgeHtml}</td>
            `;
            tbodyEl.appendChild(tr);
        });
    } catch (e) {
        console.error("Error loading attendance", e);
    }
}

function filterAttendance() {
    loadAttendance();
}

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
