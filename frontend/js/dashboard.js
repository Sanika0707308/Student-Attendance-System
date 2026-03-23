document.addEventListener("DOMContentLoaded", loadDashboard);

async function loadDashboard() {
    try {
        // Set date picker to today
        const today = new Date().toISOString().split("T")[0];
        document.getElementById("attendance-date").value = today;

        // Fetch Students
        const studentsResp = await fetch('/api/students');
        const students = await studentsResp.json();

        document.getElementById("total").innerText = students.length;

        // Initial load
        loadAttendance(today);
        checkDeviceStatus();

        // --- NEW: Auto-update feature every 10 seconds ---
        setInterval(() => {
            const selectedDate = document.getElementById("attendance-date").value;
            const todayStr = new Date().toISOString().split("T")[0];
            
            // Only auto-update if we are looking at today's records
            if (selectedDate === todayStr) {
                console.log("Auto-refreshing dashboard logs...");
                loadAttendance(selectedDate);
                checkDeviceStatus();
            }
        }, 10000); 

    } catch (e) {
        console.error("Error loading dashboard", e);
    }
}

async function loadAttendance(dateStr = null) {
    try {
        const today = new Date().toISOString().split("T")[0];
        const targetDate = dateStr || today;

        let url = `/api/attendance?date=${targetDate}`;

        const resp = await fetch(url);
        const logs = await resp.json();

        const tbodyEl = document.querySelector('#attendance-table tbody');
        tbodyEl.innerHTML = "";

        if (logs.length === 0) {
            tbodyEl.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>No attendance records found for this date.</td></tr>";
        } else {
            // Group logs by student to pair IN/OUT times
            const studentLogs = {};
            logs.forEach(log => {
                const key = log.student_name;
                if (!studentLogs[key]) {
                    studentLogs[key] = [];
                }
                studentLogs[key].push(log);
            });

            // Render each student's record
            Object.keys(studentLogs).forEach(studentName => {
                const punches = studentLogs[studentName];
                // Sort by punch_time ascending
                punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

                const firstPunch = punches[0];
                const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;

                const dateObj = new Date(firstPunch.punch_time);
                const inTime = dateObj.toLocaleTimeString();
                const outTime = lastPunch ? new Date(lastPunch.punch_time).toLocaleTimeString() : '--';

                // Use the last status as the effective status
                const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;
                const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
                const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(effectiveStatus)}</span>`;

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${dateObj.toLocaleDateString()}</td>
                    <td>${escapeHtml(studentName)}</td>
                    <td>${inTime}</td>
                    <td>${outTime}</td>
                    <td>${badgeHtml} 
                        <span style="font-size:10px;color:gray;margin-left:8px;">
                            (Email: ${firstPunch.email_sent ? 'Sent' : 'Failed'})
                        </span>
                    </td>
                `;
                tbodyEl.appendChild(tr);
            });
        }

        // Count unique present students (any non-Absent status)
        const uniqueStudentsPunched = new Set(
            logs.filter(l => l.status !== 'Absent')
                .map(l => l.student_id || l.student_name)
        ).size;

        document.getElementById("present").innerText = uniqueStudentsPunched;

        const totalElems = parseInt(document.getElementById("total").innerText) || 0;
        document.getElementById("absent").innerText = Math.max(0, totalElems - uniqueStudentsPunched);

    } catch (e) {
        console.error("Error loading attendance logs", e);
    }
}

async function checkDeviceStatus() {
    try {
        const resp = await fetch('/api/settings/device-status');
        const data = await resp.json();
        const dot = document.getElementById("status-dot");
        const text = document.getElementById("status-text");

        if (data.online) {
            dot.className = "status-dot online";
            text.innerText = "Device Online";
            text.style.color = "var(--success)";
        } else {
            dot.className = "status-dot offline";
            text.innerText = "Device Offline";
            text.style.color = "var(--danger)";
        }
    } catch (e) {
        console.error("Error checking device status", e);
    }
}

function showDateRecords() {
    const selectedDate = document.getElementById("attendance-date").value;
    loadAttendance(selectedDate);
}

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
