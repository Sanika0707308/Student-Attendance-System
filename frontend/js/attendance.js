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

    const btnDailyPdf = document.getElementById("btn-export-daily-pdf");
    if(btnDailyPdf) btnDailyPdf.addEventListener("click", downloadDailyPDF);
    const btnDailyCsv = document.getElementById("btn-export-daily-csv");
    if(btnDailyCsv) btnDailyCsv.addEventListener("click", downloadDailyCSV);
});

async function loadAttendance() {
    const selectedDate = document.getElementById("attendance-date").value;
    const selectedStatus = document.getElementById("attendance-status") ? document.getElementById("attendance-status").value : "All";
    const selectedStandard = document.getElementById("attendance-standard") ? document.getElementById("attendance-standard").value : "All";
    
    try {
        let url = '/api/attendance';
        if (selectedDate) url += `?date=${selectedDate}`;
        const resp = await fetch(url);
        const logs = await resp.json();

        const tbodyEl = document.getElementById("attendance-table-body");
        tbodyEl.innerHTML = "";
        window.currentAttendanceData = [];

        if (logs.length === 0) {
            tbodyEl.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>No attendance records found for this date.</td></tr>";
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

        let rowsAdded = 0;

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
            const standard = firstPunch.standard || "11th";

            if (selectedStatus !== "All" && effectiveStatus !== selectedStatus) {
                return;
            }
            if (selectedStandard !== "All" && standard !== selectedStandard) {
                return;
            }
            
            rowsAdded++;

            const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
            const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(effectiveStatus)}</span>`;

            const tr = document.createElement("tr");
            tr.innerHTML = `
                <td>${escapeHtml(studentName)}</td>
                <td>${escapeHtml(standard)}</td>
                <td>${inTime}</td>
                <td>${outTime}</td>
                <td>${badgeHtml}</td>
            `;
            tbodyEl.appendChild(tr);

            window.currentAttendanceData.push({
                studentName: studentName,
                standard: standard,
                inTime: inTime,
                outTime: outTime,
                status: effectiveStatus,
                zk_id: firstPunch.student_zk_id
            });
        });

        if (rowsAdded === 0) {
             tbodyEl.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>No students found with the selected filters.</td></tr>";
        }
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

// CSV quoting utility 
function csvQuote(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

function downloadDailyCSV() {
    const data = window.currentAttendanceData;
    if (!data || data.length === 0) {
        window.showToast("No data to download.", "warning");
        return;
    }
    
    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ZK ID,Student Name,Standard,In Time,Out Time,Status\n";

    data.forEach(row => {
        csvContent += `${csvQuote(row.zk_id)},${csvQuote(row.studentName)},${csvQuote(row.standard)},${csvQuote(row.inTime)},${csvQuote(row.outTime)},${csvQuote(row.status)}\n`;
    });

    const date = document.getElementById("attendance-date").value;
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `Daily_Attendance_${date}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadDailyPDF() {
    const data = window.currentAttendanceData;
    if (!data || data.length === 0) {
        window.showToast("No data to download.", "warning");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const date = document.getElementById("attendance-date").value;
    const statusFilter = document.getElementById("attendance-status").value;
    const standardFilter = document.getElementById("attendance-standard").value;

    doc.setFontSize(18);
    doc.text("Daily Attendance Report", 14, 20);

    doc.setFontSize(11);
    doc.text(`Date: ${date}`, 14, 28);
    doc.text(`Status Filter: ${statusFilter} | Standard: ${standardFilter}`, 14, 34);

    const tableColumn = ["ZK ID", "Student Name", "Standard", "In Time", "Out Time", "Status"];
    const tableRows = [];

    data.forEach(row => {
        tableRows.push([
            row.zk_id,
            row.studentName,
            row.standard,
            row.inTime,
            row.outTime,
            row.status
        ]);
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 40,
        theme: 'striped',
        styles: { fontSize: 10 },
        headStyles: { fillColor: [44, 62, 80] }
    });

    doc.save(`Daily_Attendance_${date}.pdf`);
}
