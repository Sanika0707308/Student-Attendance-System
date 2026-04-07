document.addEventListener("DOMContentLoaded", loadDashboard);

async function loadDashboard() {
    try {
<<<<<<< HEAD
        // Set date picker to today
        const today = new Date().toISOString().split("T")[0];
=======
        const now = new Date();
        const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
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
<<<<<<< HEAD
                // Sort by punch_time ascending
=======
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
                punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

                const firstPunch = punches[0];
                const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;
<<<<<<< HEAD

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
=======
                const effectiveStatus = (lastPunch ? lastPunch.status : firstPunch.status) || "Absent";

                let inTimeText = "--";
                let outTimeText = "--";

                if (effectiveStatus.trim().toLowerCase() !== "absent") {
                    inTimeText = new Date(firstPunch.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    if (lastPunch && lastPunch !== firstPunch) {
                        outTimeText = new Date(lastPunch.punch_time).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
                    }
                }

                const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
                const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(effectiveStatus)}</span>`;
                
                let emailHtml = "";
                if (firstPunch.email_sent) {
                    emailHtml = `
                        <div style="display:flex; align-items:center; gap:5px; font-size:10px; padding:2px 10px; border-radius:50px; background: rgba(240, 253, 244, 0.9); border: 1px solid #bbf7d0; color: #166534; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-left:10px;" title="Email sent successfully">
                            <span style="width: 6px; height: 6px; background: #16a34a; border-radius: 50%; display: inline-block;"></span>
                            <span style="letter-spacing: 0.5px;">SENT</span>
                        </div>`;
                } else {
                    emailHtml = `
                        <div style="display:flex; align-items:center; gap:5px; font-size:10px; padding:2px 10px; border-radius:50px; background: rgba(254, 242, 242, 0.9); border: 1px solid #fecaca; color: #991b1b; font-weight: 700; box-shadow: 0 1px 2px rgba(0,0,0,0.05); margin-left:10px;" title="Email delivery failed - check settings">
                            <span style="width: 6px; height: 6px; background: #dc2626; border-radius: 50%; display: inline-block;"></span>
                            <span style="letter-spacing: 0.5px;">FAILED</span>
                        </div>`;
                }

                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${new Date(firstPunch.punch_time).toLocaleDateString('en-GB', { day: '2-digit', month: 'short' })}</td>
                    <td>${escapeHtml(studentName)}</td>
                    <td>${inTimeText}</td>
                    <td>${outTimeText}</td>
                    <td>
                        <div style="display: flex; align-items: center;">
                            ${badgeHtml} ${emailHtml}
                        </div>
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
                    </td>
                `;
                tbodyEl.appendChild(tr);
            });
        }
<<<<<<< HEAD
=======
        
        // Update Last Updated Timestamp
        const lastUpdatedEl = document.getElementById("last-updated-text");
        if (lastUpdatedEl) {
            lastUpdatedEl.innerText = `Last update: ${new Date().toLocaleTimeString()}`;
        }
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626

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
