document.addEventListener("DOMContentLoaded", () => {
    loadStudents();

    // Auto-fill gmail.com helper
    const autoFillGmail = function() {
        if (this.value.endsWith("@")) {
            this.value += "gmail.com";
        }
    };
    document.getElementById("parent_email").addEventListener("input", autoFillGmail);
    document.getElementById("edit_parent_email").addEventListener("input", autoFillGmail);

    document.getElementById("addStudentForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = document.getElementById("student_name").value;
        const zk_id = document.getElementById("zk_id").value;
        const parent_email = document.getElementById("parent_email").value;

        // Front-end duplicate checks
        const existingStudents = window.cachedStudents || [];
        
        const nameCount = existingStudents.filter(s => s.name.trim().toLowerCase() === name.trim().toLowerCase()).length;
        const emailCount = existingStudents.filter(s => s.parent_email.trim().toLowerCase() === parent_email.trim().toLowerCase()).length;

        if (nameCount >= 2) {
            window.showToast("Cannot add student. Name already exists 2 times.", "warning");
            return;
        }

        if (emailCount >= 2) {
            window.showToast("Cannot add student. Email already exists 2 times.", "warning");
            return;
        }

        try {
            const resp = await fetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, zk_id, parent_email })
            });

            if (resp.ok) {
                window.showToast("Student added successfully!", "success");
                document.getElementById("addStudentForm").reset();
                loadStudents();
            } else {
                const data = await resp.json();
                window.showToast("Failed: " + (data.detail || "Unknown error"), "error");
            }
        } catch (err) {
            console.error(err);
            window.showToast("Network error while adding student.", "error");
        }
    });
});

    document.getElementById("editStudentForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const id = document.getElementById("edit_student_id").value;
        const name = document.getElementById("edit_student_name").value;
        const zk_id = document.getElementById("edit_zk_id").value;
        const parent_email = document.getElementById("edit_parent_email").value;

        // Front-end duplicate checks excluding the student being edited
        const existingStudents = window.cachedStudents || [];
        
        const nameCount = existingStudents.filter(s => s.id != id && s.name.trim().toLowerCase() === name.trim().toLowerCase()).length;
        const emailCount = existingStudents.filter(s => s.id != id && s.parent_email.trim().toLowerCase() === parent_email.trim().toLowerCase()).length;

        if (nameCount >= 2) {
            window.showToast("Cannot update student. Name already exists 2 times.", "warning");
            return;
        }

        if (emailCount >= 2) {
            window.showToast("Cannot update student. Email already exists 2 times.", "warning");
            return;
        }

        try {
            const resp = await fetch(`/api/students/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, zk_id, parent_email })
            });

            if (resp.ok) {
                window.showToast("Student updated successfully!", "success");
                closeEditStudentModal();
                loadStudents();
            } else {
                const data = await resp.json();
                window.showToast("Failed: " + (data.detail || "Unknown error"), "error");
            }
        } catch (err) {
            console.error(err);
            window.showToast("Network error while updating student.", "error");
        }
    });

async function loadStudents() {
    try {
        const resp = await fetch('/api/students');
        const students = await resp.json();
        window.cachedStudents = students;

        const tbody = document.getElementById("student-table-body");
        tbody.innerHTML = "";

        if (students.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>";
        } else {
            students.forEach(s => {
                const tr = document.createElement("tr");
                const safeName = escapeHtml(s.name).replace(/'/g, "\\'");
                tr.innerHTML = `
                    <td>${escapeHtml(String(s.id))}</td>
                    <td>${escapeHtml(s.name)}</td>
                    <td>${escapeHtml(s.zk_id)}</td>
                    <td>${escapeHtml(s.parent_email)}</td>
                    <td style="display: flex; gap: 5px; align-items: center; white-space: nowrap; flex-wrap: nowrap;">
                        <button onclick="openAttendanceModal(${s.id}, '${safeName}', '${escapeHtml(s.zk_id)}')" class="btn-add" style="padding: 5px 10px; font-size: 12px; margin: 0;">Attendance</button>
                        <button onclick="openEditStudentModal(${s.id}, '${safeName}', '${escapeHtml(s.zk_id)}', '${escapeHtml(s.parent_email)}')" style="background-color: var(--warning); border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; margin: 0;">Edit</button>
                        <button onclick="deleteStudent(${s.id})" class="btn-delete" style="padding: 5px 10px; font-size: 12px; margin: 0;">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
        // Apply filter in case text is already typed
        filterStudents();
    } catch (e) {
        console.error("Error fetching students:", e);
    }
}

async function deleteStudent(id) {
    if (!confirm("Are you sure you want to delete this student?")) return;
    try {
        const resp = await fetch(`/api/students/${id}`, { method: 'DELETE' });
        if (resp.ok) {
            window.showToast("Student deleted successfully.", "success");
            loadStudents();
        } else {
            window.showToast("Failed to delete student.", "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Error deleting student.", "error");
    }
}

function filterStudents() {
    const term = document.getElementById("search-id").value.toLowerCase();
    const rows = document.getElementById("student-table-body").getElementsByTagName("tr");
    
    for (let i = 0; i < rows.length; i++) {
        const idCol = rows[i].getElementsByTagName("td")[0];
        const zkIdCol = rows[i].getElementsByTagName("td")[2];
        if (zkIdCol) {
            const zkIdText = zkIdCol.textContent || zkIdCol.innerText;
            if (zkIdText.toLowerCase().includes(term)) {
                rows[i].style.display = "";
            } else {
                rows[i].style.display = "none";
            }
        }
    }
}

function openAttendanceModal(studentId, studentName, studentZkId) {
    document.getElementById("attendance-modal").style.display = "block";
    document.getElementById("modal-student-name").textContent = "Attendance: " + studentName;
    
    const zkEl = document.getElementById("modal-student-zk-id");
    zkEl.textContent = "ZK ID: " + studentZkId;
    zkEl.dataset.name = studentName;
    zkEl.dataset.zkid = studentZkId;

    document.getElementById("modal-student-id").value = studentId;

    const now = new Date();
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById("modal-month").value = monthStr;

    loadStudentMonthlyAttendance();
}

function closeAttendanceModal() {
    document.getElementById("attendance-modal").style.display = "none";
}

function openEditStudentModal(id, name, zk_id, parent_email) {
    document.getElementById("edit-student-modal").style.display = "block";
    document.getElementById("edit_student_id").value = id;
    document.getElementById("edit_student_name").value = name;
    document.getElementById("edit_zk_id").value = zk_id;
    document.getElementById("edit_parent_email").value = parent_email;
}

function closeEditStudentModal() {
    document.getElementById("edit-student-modal").style.display = "none";
    document.getElementById("editStudentForm").reset();
}

function downloadStudentMonthlyReport() {
    const zkIdEl = document.getElementById("modal-student-zk-id");
    const studentName = zkIdEl.dataset.name || "Unknown";
    const studentZkId = zkIdEl.dataset.zkid || "Unknown";
    const month = document.getElementById("modal-month").value;
    
    const tbodyEl = document.getElementById("modal-attendance-body");
    const rows = tbodyEl.getElementsByTagName("tr");
    
    if (rows.length === 0 || rows[0].innerText.includes("Loading") || rows[0].innerText.includes("No attendance") || rows[0].innerText.includes("Failed") || rows[0].innerText.includes("Error")) {
        window.showToast("No data to download", "warning");
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        
        doc.setFontSize(18);
        doc.text("Student Attendance Report", 14, 22);
        
        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text(`Student Name: ${studentName}`, 14, 32);
        doc.text(`ZK ID: ${studentZkId}`, 14, 40);
        doc.text(`Month: ${month}`, 14, 48);

        const tableColumn = ["Date", "IN Time", "OUT Time", "Status"];
        const tableRows = [];

        for (let i = 0; i < rows.length; i++) {
            const cols = rows[i].getElementsByTagName("td");
            if (cols.length === 4) {
                const date = cols[0].innerText;
                const inTime = cols[1].innerText;
                const outTime = cols[2].innerText;
                const status = cols[3].innerText;
                tableRows.push([date, inTime, outTime, status]);
            }
        }

        doc.autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: 55,
            theme: 'striped',
            styles: { fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: [59, 130, 246] }, // Primary blue color
        });

        doc.save(`Attendance_${studentName}_${month}.pdf`);
    } catch (e) {
        console.error("PDF generation failed:", e);
        window.showToast("Failed to generate PDF", "error");
    }
}

async function loadStudentMonthlyAttendance() {
    const studentId = document.getElementById("modal-student-id").value;
    const month = document.getElementById("modal-month").value;
    const tbodyEl = document.getElementById("modal-attendance-body");
    
    tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center;'>Loading...</td></tr>";

    if (!month) return;

    try {
        const resp = await fetch(`/api/attendance?student_id=${studentId}&month=${month}&limit=1000`);
        if (!resp.ok) {
           tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: red;'>Failed to load attendance.</td></tr>";
           document.getElementById("btn-download-report").style.display = "none";
           return;
        }
        
        let logs = await resp.json();
        
        // --- STRICT FRONTEND FILTERING (Fallback) ---
        // This ensures that even if the backend hasn't been safely restarted, 
        // the user only sees the exact selected student and the exact month.
        const targetYear = parseInt(month.split('-')[0], 10);
        const targetMonth = parseInt(month.split('-')[1], 10);
        const modalZkId = document.getElementById("modal-student-zk-id").dataset.zkid;
        
        logs = logs.filter(log => {
            if (log.student_zk_id && String(log.student_zk_id) !== String(modalZkId)) {
                return false;
            }
            const d = new Date(log.punch_time);
            return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
        });
        
        tbodyEl.innerHTML = "";
        
        if (logs.length === 0) {
            tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No attendance records found for this month.</td></tr>";
            document.getElementById("btn-download-report").style.display = "none";
            return;
        }

        document.getElementById("btn-download-report").style.display = "block";

        const dailyLogs = {};
        logs.forEach(log => {
            const dateObj = new Date(log.punch_time);
            const dateStr = dateObj.toLocaleDateString();
            if (!dailyLogs[dateStr]) dailyLogs[dateStr] = [];
            dailyLogs[dateStr].push(log);
        });

        const sortedDates = Object.keys(dailyLogs).sort((a,b) => new Date(a) - new Date(b));

        sortedDates.forEach(dateStr => {
            const punches = dailyLogs[dateStr];
            punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

            const firstPunch = punches[0];
            const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;

            const inTime = new Date(firstPunch.punch_time).toLocaleTimeString();
            const outTime = lastPunch ? new Date(lastPunch.punch_time).toLocaleTimeString() : '--';
            const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;

            const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
            const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(effectiveStatus)}</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${escapeHtml(dateStr)}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${inTime}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${outTime}</td>
                <td style="padding: 10px; border-bottom: 1px solid #eee;">${badgeHtml}</td>
            `;
            tbodyEl.appendChild(tr);
        });

    } catch(e) {
        console.error(e);
        tbodyEl.innerHTML = "<tr><td colspan='4' style='text-align:center; color: red;'>Error loading attendance.</td></tr>";
    }
}

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
