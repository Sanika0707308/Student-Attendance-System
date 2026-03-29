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

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "Date,Time,Student Name,ZK ID,Status\n";

    allAttendanceLogs.forEach(log => {
        const d = new Date(log.punch_time);
        const dateStr = csvQuote(d.toLocaleDateString());
        const timeStr = csvQuote(d.toLocaleTimeString());
        const name = csvQuote(log.student_name);
        const zkId = csvQuote(log.student_zk_id);
        const status = csvQuote(log.status);
        csvContent += `${dateStr},${timeStr},${name},${zkId},${status}\n`;
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
    doc.text("STC's Vidyamandir - Full Attendance Report", 14, 20);

    doc.setFontSize(11);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 28);

    const tableColumn = ["Date", "Time", "Student Name", "ZK Machine ID", "Status"];
    const tableRows = [];

    allAttendanceLogs.forEach(log => {
        const d = new Date(log.punch_time);
        const logData = [
            d.toLocaleDateString(),
            d.toLocaleTimeString(),
            log.student_name,
            log.student_zk_id,
            log.status
        ];
        tableRows.push(logData);
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 35,
        theme: 'grid',
        headStyles: { fillColor: [44, 62, 80] }
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
