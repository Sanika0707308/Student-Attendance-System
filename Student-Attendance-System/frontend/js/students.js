let currentStudentId = null;
let currentStudentName = "";
let currentStudentZkId = "";
let currentStudentEmail = "";

document.addEventListener("DOMContentLoaded", () => {
    loadStudents();
    populateYearDropdown();

    document.getElementById("addStudentForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = document.getElementById("student_name").value;
        const zk_id = document.getElementById("zk_id").value;
        const parent_email = document.getElementById("parent_email").value;

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

    // Handle month/year changes in modal
    document.getElementById("report-month").addEventListener("change", updatePersonalStats);
    document.getElementById("report-year").addEventListener("change", updatePersonalStats);

    // Close modal when clicking outside
    window.onclick = function(event) {
        const modal = document.getElementById("attendance-modal");
        if (event.target == modal) {
            closeAttendanceModal();
        }
    }
});


async function updatePersonalStats() {
    if (!currentStudentZkId) return;
    const month = document.getElementById("report-month").value;
    const year = document.getElementById("report-year").value;
    
    try {
        const resp = await fetch(`/api/attendance?limit=5000`);
        const allLogs = await resp.json();
        
        const studentLogs = allLogs.filter(log => {
            const logDate = new Date(log.punch_time);
            return String(log.student_zk_id) === String(currentStudentZkId) && 
                   (logDate.getMonth() + 1) === parseInt(month) && 
                   logDate.getFullYear() === parseInt(year);
        });
        
        // Group by date to get unique present days
        const logsByDate = new Set();
        studentLogs.forEach(l => {
            if (l.status !== 'Absent') {
                logsByDate.add(new Date(l.punch_time).toDateString());
            }
        });
        const presentDays = logsByDate.size;
        
        // Use current date for total days comparison if looking at current month
        const now = new Date();
        let totalDaysToCount;
        if (parseInt(year) === now.getFullYear() && parseInt(month) === (now.getMonth() + 1)) {
            totalDaysToCount = now.getDate(); // Only count up to today
        } else {
            totalDaysToCount = new Date(year, month, 0).getDate(); // Full month
        }
        
        const presentPercent = totalDaysToCount > 0 ? Math.round((presentDays / totalDaysToCount) * 100) : 0;
        const absentPercent = 100 - presentPercent;
        
        const logsContainer = document.getElementById("modal-logs-container");
        const logsBody = document.getElementById("modal-logs-body");
        const summaryStats = document.getElementById("student-summary-stats");
 
        document.getElementById("personal-present-percent").innerText = presentPercent + "%";
        document.getElementById("personal-absent-percent").innerText = absentPercent + "%";

        if (summaryStats) {
            summaryStats.style.display = studentLogs.length === 0 ? "none" : "flex";
        }

        if (logsContainer) {
            logsContainer.style.display = "block";
            logsBody.innerHTML = "";
            
            if (studentLogs.length === 0) {
                const tr = document.createElement("tr");
                tr.innerHTML = `<td colspan="4" style="text-align:center; padding: 25px; color: #94a3b8; font-style: italic;">No attendance records found for this period.</td>`;
                logsBody.appendChild(tr);
            } else {
                // Group by date for the table
                const logsByDate = {};
                studentLogs.forEach(log => {
                    const dateStr = new Date(log.punch_time).toDateString();
                    if (!logsByDate[dateStr]) logsByDate[dateStr] = [];
                    logsByDate[dateStr].push(log);
                });

                logsBody.innerHTML = "";
                // Sort dates descending (latest first)
                Object.keys(logsByDate).sort((a,b) => new Date(b) - new Date(a)).forEach(dateStr => {
                    const punches = logsByDate[dateStr];
                    punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));
                    
                    const firstPunch = punches[0];
                    const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;
                    const effectiveStatus = (lastPunch ? lastPunch.status : firstPunch.status) || "Absent";
                    
                    // Robust check: Mask if status is "Absent" OR if the time is exactly 12:30 (the common system default)
                    const punchTime = new Date(firstPunch.punch_time);
                    const is1230 = punchTime.getHours() === 12 && punchTime.getMinutes() === 30;
                    const isAbsent = effectiveStatus.trim().toLowerCase() === "absent" || is1230;

                    const inTime = isAbsent ? '--' : punchTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
                    const outTime = (lastPunch && !isAbsent && lastPunch !== firstPunch) ? new Date(lastPunch.punch_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--';

                    const tr = document.createElement("tr");
                    tr.style.borderBottom = "1px solid #f1f5f9";
                    tr.innerHTML = `
                        <td style="padding: 12px 15px; color: #475569; font-weight: 500;">${new Date(dateStr).toLocaleDateString('en-GB', {day:'2-digit', month:'short'})}</td>
                        <td style="padding: 12px 15px; color: #0f172a; font-weight: 600;">${inTime}</td>
                        <td style="padding: 12px 15px; color: #0f172a; font-weight: 600;">${outTime}</td>
                        <td style="padding: 12px 15px;">
                            <span style="font-size: 11px; font-weight: 700; text-transform: uppercase; padding: 4px 10px; border-radius: 20px; 
                                ${!isAbsent && effectiveStatus === 'Present' ? 'background: #ecfdf5; color: #059669;' : 
                                  isAbsent ? 'background: #fef2f2; color: #dc2626;' : 
                                  effectiveStatus === 'Late' ? 'background: #fffbeb; color: #d97706;' : 
                                  'background: #eff6ff; color: #2563eb;'}">
                                ${!isAbsent && effectiveStatus === 'Present' ? 'In Time' : 
                                  !isAbsent && (effectiveStatus === 'Left' || effectiveStatus === 'Left Early') ? 'Departure' : 
                                  isAbsent ? 'Absent' : effectiveStatus}
                            </span>
                        </td>
                    `;
                    logsBody.appendChild(tr);
                });
            }
        }
    } catch (e) {
        console.error("Error updating personal stats:", e);
    }
}
async function loadStudents() {
    try {
        const resp = await fetch('/api/students');
        const students = await resp.json();

        const tbody = document.getElementById("student-table-body");
        tbody.innerHTML = "";

        if (students.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>";
        } else {
            students.forEach(s => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${escapeHtml(String(s.id))}</td>
                    <td>${escapeHtml(s.name)}</td>
                    <td>${escapeHtml(s.zk_id)}</td>
                    <td>${escapeHtml(s.parent_email)}</td>
                    <td style="display: flex; gap: 8px;">
                        <button onclick="openAttendanceModal(${s.id}, '${escapeHtml(s.name)}', '${escapeHtml(s.zk_id)}', '${escapeHtml(s.parent_email)}')" class="btn-attendance" style="padding: 8px 12px; font-size: 13px;">Attendance</button>
                        <button onclick="deleteStudent(${s.id})" class="btn-delete" style="padding: 8px 12px; font-size: 13px;">Delete</button>
                    </td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Error fetching students:", e);
    }
}

function searchStudents() {
    const query = document.getElementById("student-search").value.toLowerCase();
    const rows = document.querySelectorAll("#student-table-body tr");
    
    rows.forEach(row => {
        const idCell = row.cells[0]?.innerText.toLowerCase() || "";
        const nameCell = row.cells[1]?.innerText.toLowerCase() || "";
        const zkIdCell = row.cells[2]?.innerText.toLowerCase() || "";
        
        if (idCell.includes(query) || nameCell.includes(query) || zkIdCell.includes(query)) {
            row.style.display = "";
        } else {
            row.style.display = "none";
        }
    });
}

function openAttendanceModal(id, name, zkId, email) {
    currentStudentId = id;
    currentStudentName = name;
    currentStudentZkId = zkId;
    currentStudentEmail = email || "N/A";
    document.getElementById("modal-student-name").innerText = `Attendance for ${name}`;
    document.getElementById("attendance-modal").style.display = "flex";
    
    // Set current month as default
    const now = new Date();
    document.getElementById("report-month").value = now.getMonth() + 1;
    document.getElementById("report-year").value = now.getFullYear();

    updatePersonalStats();
}

function closeAttendanceModal() {
    document.getElementById("attendance-modal").style.display = "none";
}

function populateYearDropdown() {
    const yearSelect = document.getElementById("report-year");
    const currentYear = new Date().getFullYear();
    for (let y = currentYear; y >= currentYear - 5; y--) {
        const opt = document.createElement("option");
        opt.value = y;
        opt.textContent = y;
        yearSelect.appendChild(opt);
    }
}

async function downloadStudentPDF() {
    const month = document.getElementById("report-month").value;
    const year = document.getElementById("report-year").value;
    
    try {
        window.showToast("Generating report...", "info");
        
        const resp = await fetch(`/api/attendance?limit=5000`);
        const allLogs = await resp.json();
        
        // Filter by student and month/year
        const studentLogs = allLogs.filter(log => {
            const logDate = new Date(log.punch_time);
            return String(log.student_zk_id) === String(currentStudentZkId) && 
                   (logDate.getMonth() + 1) === parseInt(month) && 
                   logDate.getFullYear() === parseInt(year);
        });

        if (studentLogs.length === 0) {
            window.showToast("No attendance records found for the selected period.", "warning");
            return;
        }

        // Group by date to get In/Out times
        const logsByDate = {};
        studentLogs.forEach(log => {
            const dateStr = new Date(log.punch_time).toDateString();
            if (!logsByDate[dateStr]) logsByDate[dateStr] = [];
            logsByDate[dateStr].push(log);
        });

        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();
        const primaryColor = [15, 23, 42]; // Slate 900
        const accentColor = [59, 130, 246]; // Blue 500

        // Background header
        doc.setFillColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.rect(0, 0, 210, 40, 'F');
        
        // Title
        doc.setTextColor(255, 255, 255);
        doc.setFontSize(24);
        doc.setFont("helvetica", "bold");
        doc.text("ATTENDANCE REPORT", 14, 25);
        
        doc.setFontSize(10);
        doc.setFont("helvetica", "normal");
        doc.setTextColor(200, 200, 200);
        doc.text(`${getMonthName(month).toUpperCase()} ${year}`, 14, 32);

        // Student Info Block
        doc.setTextColor(primaryColor[0], primaryColor[1], primaryColor[2]);
        doc.setFontSize(10);
        doc.setFont("helvetica", "bold");
        doc.text("STUDENT DETAILS", 14, 50);
        
        doc.setDrawColor(226, 232, 240);
        doc.line(14, 52, 196, 52);
        
        doc.setFont("helvetica", "normal");
        doc.setTextColor(100, 100, 100);
        doc.text(`Name:`, 14, 60);
        doc.text(`ZK Machine ID:`, 14, 66);
        doc.text(`Email:`, 14, 72);
        
        doc.setTextColor(0, 0, 0);
        doc.setFont("helvetica", "bold");
        doc.text(currentStudentName, 50, 60);
        doc.text(String(currentStudentZkId), 50, 66);
        doc.text(currentStudentEmail, 50, 72);

        // Stats Summary Cards in PDF
        const presentDays = Object.keys(logsByDate).filter(d => {
            const p = logsByDate[d];
            const lastS = (p[p.length-1] || p[0]).status;
            return lastS && lastS.trim().toLowerCase() !== "absent";
        }).length;
        const totalDaysInMonth = new Date(year, month, 0).getDate();
        const pPercent = Math.round((presentDays / totalDaysInMonth) * 100);
        
        doc.setFillColor(248, 250, 252);
        doc.roundedRect(140, 55, 56, 22, 3, 3, 'F');
        doc.setTextColor( accentColor[0], accentColor[1], accentColor[2]);
        doc.setFontSize(16);
        doc.text(`${pPercent}%`, 145, 70);
        doc.setFontSize(8);
        doc.setTextColor(100, 100, 100);
        doc.text("Presence Score", 145, 62);

        const tableColumn = ["Date", "In Time", "Out Time", "Status"];
        const tableRows = [];

        Object.keys(logsByDate).sort((a,b) => new Date(a) - new Date(b)).forEach(dateStr => {
            const punches = logsByDate[dateStr];
            punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));
            
            const firstPunch = punches[0];
            const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;
            const effectiveStatus = (lastPunch ? lastPunch.status : firstPunch.status) || "Absent";
            
            // Robust check: Mask if status is "Absent" OR if the time is exactly 12:30
            const punchTime = new Date(firstPunch.punch_time);
            const is1230 = punchTime.getHours() === 12 && punchTime.getMinutes() === 30;
            const isAbsent = effectiveStatus.trim().toLowerCase() === "absent" || is1230;

            const inTime = isAbsent ? '--' : punchTime.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
            const outTime = (lastPunch && !isAbsent) ? new Date(lastPunch.punch_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--';

            tableRows.push([
                new Date(dateStr).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
                inTime,
                outTime,
                isAbsent ? 'Absent' : effectiveStatus
            ]);
        });
        
        doc.autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: 85,
            theme: 'striped',
            headStyles: { 
                fillColor: primaryColor,
                textColor: [255, 255, 255],
                fontSize: 10,
                fontStyle: 'bold',
                halign: 'left'
            },
            bodyStyles: { 
                fontSize: 9,
                textColor: [50, 50, 50]
            },
            alternateRowStyles: {
                fillColor: [250, 250, 250]
            },
            columnStyles: {
                3: { fontStyle: 'bold' }
            },
            margin: { top: 85 }
        });

        // Footer
        const pageCount = doc.internal.getNumberOfPages();
        for(let i = 1; i <= pageCount; i++) {
            doc.setPage(i);
            doc.setFontSize(8);
            doc.setTextColor(150, 150, 150);
            doc.text(`Generated by EcoTrack Attendance System on ${new Date().toLocaleString()}`, 14, 285);
            doc.text(`Page ${i} of ${pageCount}`, 190, 285, { align: 'right' });
        }

        doc.save(`Attendance_${currentStudentName.replace(/\s+/g, '_')}_${month}_${year}.pdf`);
        window.showToast("Report downloaded successfully!", "success");
        
    } catch (e) {
        console.error("Error generating PDF", e);
        window.showToast("Failed to generate PDF.", "error");
    }
}

function getMonthName(m) {
    const months = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
    return months[parseInt(m) - 1];
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

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
