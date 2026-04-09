let allAttendanceLogs = [];
let processedStudents = [];
let currentPage = 1;
const PAGE_SIZE = 50;
document.addEventListener("DOMContentLoaded", () => {
    // Set default month to current month
    const now = new Date();
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById("report-month").value = monthStr;
    
    loadReports();

    document.getElementById("btn-export-csv").addEventListener("click", downloadCSV);
    document.getElementById("btn-export-pdf").addEventListener("click", downloadPDF);

    document.getElementById("btn-prev-page").addEventListener("click", () => {
        if (currentPage > 1) {
            currentPage--;
            renderTablePage(currentPage);
        }
    });

    document.getElementById("btn-next-page").addEventListener("click", () => {
        const totalPages = Math.ceil(processedStudents.length / PAGE_SIZE);
        if (currentPage < totalPages) {
            currentPage++;
            renderTablePage(currentPage);
        }
    });
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
        
        const standardFilter = document.getElementById("report-standard").value;
        const filteredStudents = standardFilter === "All" ? students : students.filter(s => (s.standard || '11th') === standardFilter);
        
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

        const studentCount = filteredStudents.length;
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
        filteredStudents.forEach(s => {
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
        
        filteredStudents.forEach(s => {
            presentCountAll += studentPresences[s.zk_id].size;
        });

        const absentCountAll = totalExpected - presentCountAll;

        document.getElementById("total-days").innerText = totalWorkingDays;
        const presentPercent = totalWorkingDays === 0 ? 0 : Math.round((presentCountAll / totalExpected) * 100);
        const absentPercent = totalWorkingDays === 0 ? 0 : 100 - presentPercent;

        document.getElementById("avg-attendance").innerText = presentPercent + "%";
        document.getElementById("low-attendance").innerText = absentPercent + "%";

        // Process Student Overview Data
        processedStudents = [];

        filteredStudents.forEach(s => {
             const daysPresent = studentPresences[s.zk_id].size;
             let percentage = 0;
             if (totalWorkingDays > 0) {
                  percentage = Math.round((daysPresent / totalWorkingDays) * 100);
             }
             
             let barColor = "var(--primary)";
             if (percentage < 50) barColor = "var(--danger)";
             else if (percentage < 75) barColor = "var(--warning)";
             else barColor = "var(--success)";
             
             processedStudents.push({
                 zk_id: s.zk_id,
                 name: s.name,
                 standard: s.standard,
                 daysPresent: daysPresent,
                 totalWorkingDays: totalWorkingDays,
                 percentage: percentage,
                 barColor: barColor
             });
        });

        // Render first page
        currentPage = 1;
        renderTablePage(currentPage);

    } catch (e) {
        console.error("Error loading reports", e);
    }
}

function renderTablePage(page) {
    const tbody = document.getElementById("student-summary-body");
    tbody.innerHTML = "";
    
    if (processedStudents.length === 0) {
        tbody.innerHTML = "<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>";
        document.getElementById("btn-prev-page").style.display = "none";
        document.getElementById("btn-next-page").style.display = "none";
        document.getElementById("page-info").style.display = "none";
        return;
    }

    const totalPages = Math.ceil(processedStudents.length / PAGE_SIZE);
    const startIndex = (page - 1) * PAGE_SIZE;
    const endIndex = startIndex + PAGE_SIZE;
    const paginatedData = processedStudents.slice(startIndex, endIndex);

    paginatedData.forEach(s => {
        const tr = document.createElement("tr");
        tr.innerHTML = `
            <td style="font-weight: 500;">${s.zk_id}</td>
            <td>${s.name}</td>
            <td>${s.standard || '11th'}</td>
            <td>${s.daysPresent} / ${s.totalWorkingDays}</td>
            <td>
            <div style="display:flex; align-items:center; gap: 10px;">
                <div style="flex:1; background:#e2e8f0; border-radius:10px; height:8px; overflow:hidden;">
                    <div style="width:${s.percentage}%; background:${s.barColor}; height:100%; transition: width 0.5s ease;"></div>
                </div>
                <span style="font-weight:600; font-size:13px; min-width:35px; color:${s.barColor};">${s.percentage}%</span>
            </div>
            </td>
        `;
        tbody.appendChild(tr);
    });

    // Update Pagination Controls Visibility
    document.getElementById("page-info").innerText = `Page ${page} of ${totalPages}`;
    document.getElementById("page-info").style.display = "inline";
    
    const btnPrev = document.getElementById("btn-prev-page");
    const btnNext = document.getElementById("btn-next-page");
    
    btnPrev.style.display = totalPages > 1 ? "inline-block" : "none";
    btnNext.style.display = totalPages > 1 ? "inline-block" : "none";
    
    btnPrev.disabled = page === 1;
    btnNext.disabled = page === totalPages;
    
    btnPrev.style.opacity = page === 1 ? "0.5" : "1";
    btnNext.style.opacity = page === totalPages ? "0.5" : "1";
    btnPrev.style.cursor = page === 1 ? "not-allowed" : "pointer";
    btnNext.style.cursor = page === totalPages ? "not-allowed" : "pointer";
}

// ============== RELEVENT EXPORT FUNCTIONS ==============

function getSummaryDataFromTable() {
    return processedStudents;
}

function downloadCSV() {
    const data = getSummaryDataFromTable();
    if (data.length === 0) {
        window.showToast("No summary data to download for this month.", "warning");
        return;
    }

    let csvContent = "data:text/csv;charset=utf-8,";
    csvContent += "ZK ID,Student Name,Standard,Days Present,Attendance %\n";

    data.forEach(row => {
        const zkId = csvQuote(row.zk_id);
        const name = csvQuote(row.name);
        const standard = csvQuote(row.standard || '11th');
        const days = csvQuote(row.daysPresent);
        const perc = csvQuote(row.percentage);
        csvContent += `${zkId},${name},${standard},${days},${perc}\n`;
    });

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    const month = document.getElementById("report-month").value || "All";
    const standard = document.getElementById("report-standard").value;
    const safeStandard = standard === "All" ? "All" : standard;
    link.setAttribute("download", `Student_Attendance_Summary_${safeStandard}_${month}.csv`);
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
    const standard = document.getElementById("report-standard").value;

    doc.setFontSize(18);
    doc.text("Student Attendance Monthly Summary", 14, 20);

    doc.setFontSize(11);
    doc.text(`Report Month: ${month}    |    Standard: ${standard}`, 14, 28);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 34);

    const tableColumn = ["ZK ID", "Student Name", "Standard", "Days Present", "Attendance %"];
    const tableRows = [];

    data.forEach(row => {
        tableRows.push([
            row.zk_id,
            row.name,
            row.standard || '11th',
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

    const safeStandard = standard === "All" ? "All" : standard;
    doc.save(`Student_Attendance_Summary_${safeStandard}_${month}.pdf`);
}

// CSV quoting utility — wraps values in quotes if they contain commas, quotes, or newlines
function csvQuote(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

