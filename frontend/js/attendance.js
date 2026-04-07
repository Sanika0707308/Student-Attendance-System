document.addEventListener("DOMContentLoaded", () => {
<<<<<<< HEAD
    // Set date to today initially
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("attendance-date").value = today;
=======
    // Set date to today initially (robust local date)
    const now = new Date();
    const today = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
    
    document.getElementById("attendance-date").value = today;
    console.log("Initial load with date:", today);
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
    loadAttendance();

    // --- NEW: Auto-update feature every 10 seconds ---
    setInterval(() => {
        const selectedDate = document.getElementById("attendance-date").value;
<<<<<<< HEAD
        const todayStr = new Date().toISOString().split("T")[0];
        
        // Only auto-update if we are looking at today's records
=======
        const now = new Date();
        const todayStr = now.getFullYear() + '-' + String(now.getMonth() + 1).padStart(2, '0') + '-' + String(now.getDate()).padStart(2, '0');
        
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
        if (selectedDate === todayStr) {
            console.log("Auto-refreshing attendance table...");
            loadAttendance();
        }
    }, 10000); 
});

async function loadAttendance() {
    const selectedDate = document.getElementById("attendance-date").value;
<<<<<<< HEAD
    try {
        let url = '/api/attendance';
        if (selectedDate) url += `?date=${selectedDate}`;
        const resp = await fetch(url);
        const logs = await resp.json();
=======
    const statusFilter = document.getElementById("status-filter").value;
    
    console.log(`Loading attendance for Date: ${selectedDate}, Filter: ${statusFilter}`);

    const tbodyEl = document.getElementById("attendance-table-body");
    tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>Loading records...</td></tr>";

    try {
        const url = `/api/attendance?limit=1000${selectedDate ? `&date=${selectedDate}` : ''}`;
        console.log("Fetching from URL:", url);
        
        const [studentsResp, logsResp] = await Promise.all([
            fetch('/api/students').then(r => r.ok ? r.json() : Promise.reject("Students API failed")),
            fetch(url).then(r => r.ok ? r.json() : Promise.reject("Attendance API failed"))
        ]);

        const allStudents = studentsResp;
        const logs = logsResp;

        // Update Header with Selected Date
        const headerEl = document.getElementById("table-date-header");
        if (headerEl) {
            const dateObj = new Date(selectedDate);
            const formattedDate = dateObj.toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });
            headerEl.innerText = `Attendance for ${formattedDate}`;
        }
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626

        const tbodyEl = document.getElementById("attendance-table-body");
        tbodyEl.innerHTML = "";

<<<<<<< HEAD
        if (logs.length === 0) {
            tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No attendance records found for this date.</td></tr>";
            return;
        }

        // Group logs by student to pair IN/OUT times
        const studentLogs = {};
        logs.forEach(log => {
            const key = log.student_name;
=======
        if (allStudents.length === 0) {
            tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No students enrolled in the system.</td></tr>";
            return;
        }

        if (logs.length === 0 && selectedDate) {
            tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; padding: 60px 20px; color: #991b1b; font-weight: 600; font-size: 16px; background: #fef2f2; border-radius: 12px; border: 1px dashed #fee2e2;'> <div style='margin-bottom: 10px; font-size: 24px;'>🔍</div> No attendance records found for this date.</td></tr>";
            
            // Still update stats to 0/Total
            document.getElementById("total-students-count").innerText = allStudents.length;
            document.getElementById("present-count").innerText = 0;
            document.getElementById("absent-count").innerText = allStudents.length;
            return;
        }

        // Statistics tracking
        let presentCount = 0;
        let absentCount = 0;

        // Group logs by student to pair IN/OUT times
        const studentLogs = {};
        logs.forEach(log => {
            const key = String(log.student_zk_id || "").trim();
            if (!key || key === "Unknown") return;
            
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
            if (!studentLogs[key]) {
                studentLogs[key] = [];
            }
            studentLogs[key].push(log);
        });

<<<<<<< HEAD
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
=======
        // Map through all students to ensure everyone is displayed
        allStudents.forEach(student => {
            const logsKey = String(student.zk_id || "").trim();
            const punches = studentLogs[logsKey] || [];
            
            let effectiveStatus = "Absent";
            let firstPunch = null;
            let lastPunch = null;

            if (punches.length > 0) {
                // Sort by punch_time ascending
                punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));
                firstPunch = punches[0];
                lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;
                effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;
            }

            // Update statistics
            if (effectiveStatus === "Absent") {
                absentCount++;
            } else {
                presentCount++;
            }

            // Apply Status Filter
            if (statusFilter !== "all") {
                let matches = false;
                if (statusFilter === "In Time" && effectiveStatus === "Present") {
                    matches = true;
                } else if (statusFilter === "Departure" && (effectiveStatus === "Left" || effectiveStatus === "Left Early")) {
                    matches = true;
                } else if (statusFilter === effectiveStatus) {
                    matches = true;
                }

                if (!matches) {
                    return; // Skip this student in the table view
                }
            }

            const isAbsent = !effectiveStatus || effectiveStatus.trim().toLowerCase() === "absent";
            const inTime = isAbsent ? '--' : new Date(firstPunch.punch_time).toLocaleTimeString();
            const outTime = (lastPunch && !isAbsent && lastPunch !== firstPunch) ? new Date(lastPunch.punch_time).toLocaleTimeString() : '--';

            // Map backend status to user-friendly labels for display
            let displayStatus = isAbsent ? "Absent" : effectiveStatus;
            if (!isAbsent) {
                if (effectiveStatus === "Present") displayStatus = "In Time";
                else if (effectiveStatus === "Left" || effectiveStatus === "Left Early") displayStatus = "Departure";
            }

            const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
            const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(displayStatus)}</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(student.name)}</td>
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
                <td>${inTime}</td>
                <td>${outTime}</td>
                <td>${badgeHtml}</td>
            `;
            tbodyEl.appendChild(tr);
        });
<<<<<<< HEAD
    } catch (e) {
        console.error("Error loading attendance", e);
=======

        // Update overall stats at the top
        document.getElementById("total-students-count").innerText = allStudents.length;
        document.getElementById("present-count").innerText = presentCount;
        document.getElementById("absent-count").innerText = absentCount;
        
        console.log(`Rendered table with ${presentCount} present and ${absentCount} absent students.`);

    } catch (e) {
        console.error("Error loading attendance:", e);
        window.showToast("Error updating module. Check console for details.", "error");
>>>>>>> 4445c4f78370a36c758193501f0415eb91873626
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
