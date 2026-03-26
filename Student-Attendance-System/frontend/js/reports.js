console.log("REPORTS SCRIPT LOADED - V202");
let allAttendanceLogs = [];

document.addEventListener("DOMContentLoaded", () => {
    loadReports();

    document.getElementById("btn-export-csv").addEventListener("click", downloadCSV);
    document.getElementById("btn-export-pdf").addEventListener("click", downloadPDF);
});

async function loadReports() {
    try {
        const [studentsResp, logsResp] = await Promise.all([
            fetch('/api/students'),
            fetch('/api/attendance')
        ]);

        const students = await studentsResp.json();
        const logs = await logsResp.json();
        allAttendanceLogs = logs; // store for download

        const studentCount = students.length;
        if (studentCount === 0) {
            document.getElementById("total-days").innerText = 0;
            document.getElementById("avg-attendance").innerText = "0%";
            document.getElementById("low-attendance").innerText = "0%";
            return;
        }

        // Calculate unique working days from logs (ignore weekends/holidays if no ones there, only look at days with at least one punch)
        // Ensure we only count days where there's at least one "Present" punch as an active working day for overall metrics
        const uniqueDays = new Set(
            logs.filter(l => l.status !== 'Absent')
                .map(log => log.punch_time.split("T")[0])
        );
        const totalWorkingDays = Math.max(1, uniqueDays.size);

        // Total possible presences
        const totalExpected = studentCount * totalWorkingDays;

        // Ensure one presence per student per day
        const uniquePresences = new Set();
        logs.forEach(log => {
            if (log.status !== 'Absent') {
                const dateStr = log.punch_time.split("T")[0];
                const identity = log.student_name + log.student_zk_id;
                uniquePresences.add(`${dateStr}-${identity}`);
            }
        });

        const presentCount = uniquePresences.size;
        const absentCount = totalExpected - presentCount;

        document.getElementById("total-days").innerText = totalWorkingDays;
        const presentPercent = Math.round((presentCount / totalExpected) * 100);
        const absentPercent = 100 - presentPercent;

        document.getElementById("avg-attendance").innerText = presentPercent + "%";
        document.getElementById("low-attendance").innerText = absentPercent + "%";

        // FILL MONTHLY TABLE (Just use current month for now)
        const tbody = document.getElementById("monthly-summary");
        tbody.innerHTML = ""; // clear previous rows
        const currentMonthName = new Date().toLocaleString('default', { month: 'long' });

        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td>${currentMonthName}</td>
            <td>${presentPercent}%</td>
            <td>${absentPercent}%</td>
        `;
        tbody.appendChild(tr);

    } catch (e) {
        console.error("Error loading reports", e);
    }
}

// ============== RELEVENT EXPORT FUNCTIONS ==============

function downloadCSV() {
    if (allAttendanceLogs.length === 0) {
        window.showToast("No attendance data to download.", "error");
        return;
    }

    // Group logs by student and date to get IN/OUT times
    const groupedLogs = {};
    allAttendanceLogs.forEach(log => {
        const date = new Date(log.punch_time).toDateString();
        const key = `${log.student_zk_id}-${date}`;
        if (!groupedLogs[key]) groupedLogs[key] = [];
        groupedLogs[key].push(log);
    });

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,Student Name,ZK ID,IN Time,OUT Time,Status\n";

    Object.keys(groupedLogs).sort((a,b) => {
        const dateA = new Date(groupedLogs[a][0].punch_time);
        const dateB = new Date(groupedLogs[b][0].punch_time);
        return dateB - dateA; // Newest first
    }).forEach(key => {
        const punches = groupedLogs[key];
        punches.sort((a,b) => new Date(a.punch_time) - new Date(b.punch_time));
        const first = punches[0];
        const last = punches.length > 1 ? punches[punches.length - 1] : null;
        
        const d = new Date(first.punch_time);
        const status = (last ? last.status : first.status) || "Absent";
        
        // Robust check: Mask if status is "Absent" OR if the time is 12:30
        const isAbsent = status.toLowerCase().includes("absent") || (d.getHours() === 12 && d.getMinutes() === 30);

        const inTime = isAbsent ? '--' : d.toLocaleTimeString();
        const outTime = (last && !isAbsent && last !== first) ? new Date(last.punch_time).toLocaleTimeString() : '--';

        const row = [
            csvQuote(d.toLocaleDateString()),
            csvQuote(first.student_name),
            csvQuote(first.student_zk_id),
            csvQuote(inTime),
            csvQuote(outTime),
            csvQuote(isAbsent ? 'Absent' : status)
        ];
        csvContent += row.join(",") + "\n";
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", `STC_Attendance_Report_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadPDF() {
    if (allAttendanceLogs.length === 0) {
        window.showToast("No attendance data to download.", "error");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();

    doc.setFontSize(18);
    doc.text("STC Attendance Report (REAL TIME)", 14, 20);
    doc.setFontSize(8);
    doc.setTextColor(200, 0, 0);
    doc.text("VERIFICATION V202 - (C) 2026 STC", 14, 23);
    doc.setTextColor(0, 0, 0);

    doc.setFontSize(10);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 28);

    const tableColumn = ["Date", "Student Name", "ZK ID", "IN Time", "OUT Time", "Status"];
    const tableRows = [];

    // Group logs by student and date
    const groupedLogs = {};
    allAttendanceLogs.forEach(log => {
        const date = new Date(log.punch_time).toDateString();
        const key = `${log.student_zk_id}-${date}`;
        if (!groupedLogs[key]) groupedLogs[key] = [];
        groupedLogs[key].push(log);
    });

    Object.keys(groupedLogs).sort((a,b) => {
        const dateA = new Date(groupedLogs[a][0].punch_time);
        const dateB = new Date(groupedLogs[b][0].punch_time);
        return dateB - dateA;
    }).forEach(key => {
        const punches = groupedLogs[key];
        punches.sort((a,b) => new Date(a.punch_time) - new Date(b.punch_time));
        const first = punches[0];
        const last = punches.length > 1 ? punches[punches.length - 1] : null;
        
        const d = new Date(first.punch_time);
        const status = (last ? last.status : first.status) || "Absent";
        
        const h = d.getHours();
        const m = d.getMinutes();
        const isAbsent = status.toLowerCase().includes("absent") || (h === 12 && m === 30);

        const inTime = isAbsent ? '--' : d.toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'});
        const outTime = (last && !isAbsent && last !== first) ? new Date(last.punch_time).toLocaleTimeString([], {hour: '2-digit', minute:'2-digit'}) : '--';

        tableRows.push([
            d.toLocaleDateString(),
            first.student_name,
            first.student_zk_id,
            inTime,
            outTime,
            isAbsent ? 'Absent' : status
        ]);
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 35,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80], fontSize: 9 },
        bodyStyles: { fontSize: 8 },
        columnStyles: {
            0: { cellWidth: 25 },
            1: { cellWidth: 'auto' },
            2: { cellWidth: 20 },
            3: { cellWidth: 25 },
            4: { cellWidth: 25 },
            5: { cellWidth: 25 }
        }
    });

    doc.save(`STC_Attendance_Report_${new Date().toISOString().split('T')[0]}.pdf`);
}

// CSV quoting utility — wraps values in quotes if they contain commas, quotes, or newlines
function csvQuote(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}
