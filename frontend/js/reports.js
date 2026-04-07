let allAttendanceLogs = [];

document.addEventListener("DOMContentLoaded", () => {
    // Set default month to current month
    const now = new Date();
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById("report-month").value = monthStr;
    
    loadReports();

    document.getElementById("btn-export-csv").addEventListener("click", downloadCSV);
    document.getElementById("btn-export-pdf").addEventListener("click", downloadPDF);
});

async function loadReports() {
    const month = document.getElementById("report-month").value || "";
    document.getElementById("table-report-title").innerText = `Student Attendance Report (${month})`;
    
    try {
        let url = '/api/attendance?limit=1000';
        if (month) {
            url += `&month=${month}`;
        }
        
        const [studentsResp, logsResp] = await Promise.all([
            fetch('/api/students'),
            fetch(url)
        ]);

        const students = await studentsResp.json();
        let logs = await logsResp.json();
        
        // --- STRICT FRONTEND FILTERING TO BYPASS BACKEND IGNORING ---
        if (month) {
           const targetYear = parseInt(month.split('-')[0], 10);
           const targetMonth = parseInt(month.split('-')[1], 10);
           logs = logs.filter(log => {
               const d = new Date(log.punch_time);
               return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
           });
        }
        
        allAttendanceLogs = logs; // store for download

        const studentCount = students.length;
        if (studentCount === 0) {
            document.getElementById("total-days").innerText = 0;
            document.getElementById("avg-attendance").innerText = "0%";
            document.getElementById("low-attendance").innerText = "0%";
            document.getElementById("student-summary-body").innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>";
            return;
        }

        // Calculate unique working days from logs
        const uniqueDays = new Set(
            logs.filter(l => l.status !== 'Absent')
                .map(log => log.punch_time.split("T")[0])
        );
        const totalWorkingDays = uniqueDays.size;

        // Group presences per student using ZK ID
        const studentPresences = {};
        students.forEach(s => {
             studentPresences[s.zk_id] = new Set();
        });
        
        logs.forEach(log => {
            const zkid = String(log.student_zk_id);
            if (studentPresences[zkid] && log.status !== 'Absent') {
                const dateStr = log.punch_time.split("T")[0];
                studentPresences[zkid].add(dateStr);
            }
        });

        // Update overall analytics cards
        const totalExpected = studentCount * (totalWorkingDays === 0 ? 1 : totalWorkingDays);
        let presentCountAll = 0;
        
        students.forEach(s => {
            presentCountAll += studentPresences[s.zk_id].size;
        });

        const absentCountAll = totalExpected - presentCountAll;

        document.getElementById("total-days").innerText = totalWorkingDays;
        const presentPercent = totalWorkingDays === 0 ? 0 : Math.round((presentCountAll / totalExpected) * 100);
        const absentPercent = totalWorkingDays === 0 ? 0 : 100 - presentPercent;

        document.getElementById("avg-attendance").innerText = presentPercent + "%";
        document.getElementById("low-attendance").innerText = absentPercent + "%";

        // Fill Student Overview Table
        const tbody = document.getElementById("student-summary-body");
        tbody.innerHTML = "";
        
        if (students.length === 0) {
            tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>";
            return;
        }

        students.forEach(s => {
             const daysPresent = studentPresences[s.zk_id].size;
             let percentage = 0;
             if (totalWorkingDays > 0) {
                  percentage = Math.round((daysPresent / totalWorkingDays) * 100);
             }
             
             let barColor = "var(--primary)";
             if (percentage < 50) barColor = "var(--danger)";
             else if (percentage < 75) barColor = "var(--warning)";
             else barColor = "var(--success)";
             
             const tr = document.createElement("tr");
             tr.innerHTML = `
                 <td style="font-weight: 500;">${s.zk_id}</td>
                 <td>${s.name}</td>
                 <td>${daysPresent} / ${totalWorkingDays}</td>
                 <td>
                    <div style="display:flex; align-items:center; gap: 10px;">
                        <div style="flex:1; background:#e2e8f0; border-radius:10px; height:8px; overflow:hidden;">
                            <div style="width:${percentage}%; background:${barColor}; height:100%; transition: width 0.5s ease;"></div>
                        </div>
                        <span style="font-weight:600; font-size:13px; min-width:35px; color:${barColor};">${percentage}%</span>
                    </div>
                 </td>
             `;
             tbody.appendChild(tr);
        });

    } catch (e) {
        console.error("Error loading reports", e);
    }
}

// ============== RELEVENT EXPORT FUNCTIONS ==============

function getSummaryDataFromTable() {
    const tbody = document.getElementById("student-summary-body");
    const rows = tbody.getElementsByTagName("tr");
    const data = [];
    
    if (rows.length === 0 || (rows.length === 1 && (rows[0].innerText.includes("Loading") || rows[0].innerText.includes("No students")))) {
        return data;
    }
    
    for (let i = 0; i < rows.length; i++) {
        const cols = rows[i].getElementsByTagName("td");
        if (cols.length === 4) {
            const zkId = cols[0].innerText.trim();
            const name = cols[1].innerText.trim();
            const daysPresent = cols[2].innerText.trim();
            const percentage = cols[3].innerText.trim();
            data.push({ zkId, name, daysPresent, percentage });
        }
    }
    return data;
}

function downloadCSV() {
    const data = getSummaryDataFromTable();
    if (data.length === 0) {
        window.showToast("No summary data to download for this month.", "warning");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ZK ID,Student Name,Days Present,Attendance %\n";

    data.forEach(row => {
        const zkId = csvQuote(row.zkId);
        const name = csvQuote(row.name);
        const days = csvQuote(row.daysPresent);
        const perc = csvQuote(row.percentage);
        csvContent += `${zkId},${name},${days},${perc}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const month = document.getElementById("report-month").value || "All";
    link.setAttribute("download", `Student_Attendance_Summary_${month}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadPDF() {
    const data = getSummaryDataFromTable();
    if (data.length === 0) {
        window.showToast("No summary data to download for this month.", "warning");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const month = document.getElementById("report-month").value || "All";

    doc.setFontSize(18);
    doc.text("Student Attendance Monthly Summary", 14, 20);

    doc.setFontSize(11);
    doc.text(`Report Month: ${month}`, 14, 28);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 34);

    const tableColumn = ["ZK ID", "Student Name", "Days Present", "Attendance %"];
    const tableRows = [];

    data.forEach(row => {
        tableRows.push([
            row.zkId,
            row.name,
            row.daysPresent,
            row.percentage
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

    doc.save(`Student_Attendance_Summary_${month}.pdf`);
}

// CSV quoting utility — wraps values in quotes if they contain commas, quotes, or newlines
function csvQuote(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}
