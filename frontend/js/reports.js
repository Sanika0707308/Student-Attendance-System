function tr(key, english) {
    return typeof window.t === "function" ? window.t(key, english) : english;
}
function trf(key, vars, english) {
    if (typeof window.tf === "function") return window.tf(key, vars, english);
    let out = english || key;
    Object.keys(vars || {}).forEach(name => {
        out = out.split("{" + name + "}").join(String(vars[name]));
    });
    return out;
}

let allAttendanceLogs = [];
let processedStudents = [];
let currentPage = 1;
let instituteName = "Biometric Attendance";
const PAGE_SIZE = 50;

// True when the given date is a holiday for that standard — either an "All Standards"
// holiday or one added specifically for that class.
function isHolidayFor(holidayIndex, dateStr, standard) {
    const standards = holidayIndex[dateStr];
    if (!standards) return false;
    return standards.has('All') || standards.has(standard || '11th');
}

document.addEventListener("DOMContentLoaded", () => {
    // Set default month to current month
    const now = new Date();
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById("report-month").value = monthStr;
    
    loadReports();

    document.getElementById("btn-export-xlsx").addEventListener("click", downloadXLSX);
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
    
    // Fetch settings to get institute name
    try {
        const settingsResp = await window.apiFetch('/api/settings');
        if (settingsResp.ok) {
            const settings = await settingsResp.json();
            instituteName = settings.institute_name || "Biometric Attendance";
            document.title = trf("rep.titleFor", { institute: instituteName },
                `${instituteName} Reports`);
        }
    } catch (e) {
        console.error("Failed to load institute name", e);
    }

    document.getElementById("table-report-title").innerText =
        trf("rep.tableTitleFor", { institute: instituteName, month: month },
            `${instituteName} - Attendance Report (${month})`);

    try {
        let url = '/api/attendance?limit=100000';
        if (month) {
            url += `&month=${month}`;
        }

        const [studentsResp, logsResp, holidaysResp] = await Promise.all([
            window.apiFetch('/api/students'),
            window.apiFetch(url),
            window.apiFetch('/api/holidays')
        ]);

        const students = await studentsResp.json();
        let logs = await logsResp.json();
        const holidays = await holidaysResp.json();

        // Map every holiday date to the standards that are off that day ("All" covers every standard)
        const holidayIndex = {};
        holidays.forEach(h => {
            if (!h.date) return;
            if (!holidayIndex[h.date]) holidayIndex[h.date] = new Set();
            holidayIndex[h.date].add(h.standard || 'All');
        });

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
        
        // Drop punches recorded on a day that was a holiday for that student's standard,
        // so a class-specific holiday never counts against the other class.
        logs = logs.filter(log => !isHolidayFor(holidayIndex, log.punch_time.split("T")[0], log.standard));

        allAttendanceLogs = logs; // store for download

        const studentCount = filteredStudents.length;
        if (studentCount === 0) {
            document.getElementById("total-days").innerText = 0;
            document.getElementById("avg-attendance").innerText = "0%";
            document.getElementById("low-attendance").innerText = "0%";
            document.getElementById("student-summary-body").innerHTML =
                "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>"
                + escapeHtml(tr("rep.noStudents", "No students enrolled.")) + "</td></tr>";
            return;
        }

        // A working day is any date the system actually recorded attendance for —
        // whether that was a punch (Present/Late/Left) or an auto-marked absence.
        // Absences must be counted here: on a day where nobody turned up the only
        // records are "Absent", and ignoring them would drop the day from the
        // total entirely and leave every percentage measured against zero.
        // Holidays never reach this point; they are already filtered out above.
        const uniqueDays = new Set(logs.map(log => log.punch_time.split("T")[0]));

        // A day only counts as a working day for a standard that was not on holiday that day,
        // so 11th and 12th can legitimately have different totals for the same month.
        const workingDaysByStandard = {};
        function workingDaysFor(standard) {
            const key = standard || '11th';
            if (!(key in workingDaysByStandard)) {
                let count = 0;
                uniqueDays.forEach(d => {
                    if (!isHolidayFor(holidayIndex, d, key)) count++;
                });
                workingDaysByStandard[key] = count;
            }
            return workingDaysByStandard[key];
        }

        // The headline card follows the selected standard filter
        const totalWorkingDays = standardFilter === "All" ? uniqueDays.size : workingDaysFor(standardFilter);

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

        // Update overall analytics cards.
        // Each standard may have its own working-day count, so expectations are summed per student
        // instead of assuming every student shares the same denominator.
        let totalExpected = 0;
        let presentCountAll = 0;

        filteredStudents.forEach(s => {
            totalExpected += workingDaysFor(s.standard);
            presentCountAll += studentPresences[s.zk_id].size;
        });

        document.getElementById("total-days").innerText = totalWorkingDays;
        const presentPercent = totalExpected === 0 ? 0 : Math.round((presentCountAll / totalExpected) * 100);
        const absentPercent = totalExpected === 0 ? 0 : 100 - presentPercent;

        document.getElementById("avg-attendance").innerText = presentPercent + "%";
        document.getElementById("low-attendance").innerText = absentPercent + "%";

        // Process Student Overview Data
        processedStudents = [];

        filteredStudents.forEach(s => {
             const studentWorkingDays = workingDaysFor(s.standard);
             const daysPresent = studentPresences[s.zk_id].size;
             let percentage = 0;
             if (studentWorkingDays > 0) {
                  percentage = Math.round((daysPresent / studentWorkingDays) * 100);
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
                 totalWorkingDays: studentWorkingDays,
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
        tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>"
            + escapeHtml(tr("rep.noStudents", "No students enrolled.")) + "</td></tr>";
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
        // Named "row", not the idiomatic "tr" — tr() is the translation helper
        // declared at the top of this file, and shadowing it in this scope would
        // be a temporal-dead-zone ReferenceError on every render.
        const row = document.createElement("tr");
        row.innerHTML = `
            <td style="font-weight: 500;">${escapeHtml(s.zk_id)}</td>
            <td>${escapeHtml(s.name)}</td>
            <td>${escapeHtml(s.standard || '11th')}</td>
            <td>${s.daysPresent} / ${s.totalWorkingDays}</td>
            <td>
            <div style="display:flex; align-items:center; gap: 10px;">
                <div style="flex:1; background:var(--table-header-bg); border-radius:10px; height:8px; overflow:hidden;">
                    <div style="width:${s.percentage}%; background:${s.barColor}; height:100%; transition: width 0.5s ease;"></div>
                </div>
                <span style="font-weight:600; font-size:13px; min-width:35px; color:${s.barColor};">${s.percentage}%</span>
            </div>
            </td>
        `;
        tbody.appendChild(row);
    });

    // Update Pagination Controls Visibility
    document.getElementById("page-info").innerText =
        trf("rep.pageInfo", { page: page, total: totalPages }, `Page ${page} of ${totalPages}`);
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
//
// Everything written into an exported file below stays English in both
// languages. The PDF is drawn by jsPDF, which ships Helvetica only and cannot
// shape Devanagari, and a CSV whose column names shift with a UI setting is
// hostile to whatever opens it next. Only the toasts are translated.

function getSummaryDataFromTable() {
    return processedStudents;
}

/**
 * A genuine Excel workbook, not a CSV with an .xls name. openpyxl builds it
 * server-side from reports_service.compute_monthly_report, which mirrors the
 * working-day and holiday rules this page uses — so the sheet and the table on
 * screen can never disagree.
 */
async function downloadXLSX() {
    const month = document.getElementById("report-month").value;
    const standard = document.getElementById("report-standard").value || "All";

    if (!month) {
        window.showToast(tr("rep.needMonth", "Pick a month first."), "warning");
        return;
    }

    const button = document.getElementById("btn-export-xlsx");
    // Captures the markup as rendered, so restoring it puts back the icon and
    // whichever language is on screen.
    const original = button.innerHTML;
    button.disabled = true;
    button.textContent = tr("rep.buildingWorkbook", "Building workbook…");

    try {
        const resp = await window.apiFetch(
            `/api/reports/monthly-xlsx?month=${encodeURIComponent(month)}&standard=${encodeURIComponent(standard)}`);

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail)
                || tr("rep.workbookFailed", "Could not build the workbook."), "warning");
            return;
        }

        const data = await resp.json();
        window.saveBase64File(data.content_base64, data.filename,
            "Excel Workbook", "*.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
        console.error("Monthly xlsx export failed", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
    } finally {
        button.disabled = false;
        button.innerHTML = original;
    }
}

function downloadCSV() {
    const data = getSummaryDataFromTable();
    if (data.length === 0) {
        window.showToast(tr("rep.noSummary",
            "No summary data to download for this month."), "warning");
        return;
    }

    let csvContent = "";
    csvContent += csvQuote(instituteName) + "\n";
    csvContent += "ZK ID,Student Name,Standard,Days Present,Working Days,Attendance %\n";

    data.forEach(row => {
        const zkId = csvQuote(row.zk_id);
        const name = csvQuote(row.name);
        const standard = csvQuote(row.standard || '11th');
        const days = csvQuote(row.daysPresent);
        const workingDays = csvQuote(row.totalWorkingDays);
        const perc = csvQuote(row.percentage);
        csvContent += `${zkId},${name},${standard},${days},${workingDays},${perc}\n`;
    });

    const month = document.getElementById("report-month").value || "All";
    const standard = document.getElementById("report-standard").value;
    const safeStandard = standard === "All" ? "All" : standard;
    const filename = `Student_Attendance_Summary_${safeStandard}_${month}.csv`;

    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
        const contentBase64 = window.btoa(unescape(encodeURIComponent(csvContent)));
        window.pywebview.api.save_file(contentBase64, filename, "Comma Separated Values", "*.csv")
            .then(res => {
                if (res.status === "success") {
                    window.showToast(tr("common.fileSaved", "File saved successfully to:")
                        + "\n" + res.path, "success");
                } else if (res.status === "error") {
                    window.showToast(trf("common.fileSaveFailed", { error: res.error },
                        `Failed to save file: ${res.error}`), "error");
                }
            })
            .catch(err => {
                console.error("Save CSV API error:", err);
                fallbackCSV(csvContent, filename);
            });
    } else {
        fallbackCSV(csvContent, filename);
    }
}

function fallbackCSV(csvContent, filename) {
    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

function downloadPDF() {
    const data = getSummaryDataFromTable();
    if (data.length === 0) {
        window.showToast(tr("rep.noSummary",
            "No summary data to download for this month."), "warning");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const month = document.getElementById("report-month").value || "All";
    const standard = document.getElementById("report-standard").value;

    doc.setFontSize(18);
    doc.text(instituteName, 14, 20);
    doc.setFontSize(14);
    doc.text("Student Attendance Monthly Summary", 14, 28);

    doc.setFontSize(11);
    doc.text(`Report Month: ${month}    |    Standard: ${standard}`, 14, 36);
    doc.text(`Generated on: ${new Date().toLocaleDateString()}`, 14, 42);

    const tableColumn = ["ZK ID", "Student Name", "Standard", "Days Present", "Working Days", "Attendance %"];
    const tableRows = [];

    data.forEach(row => {
        tableRows.push([
            row.zk_id,
            row.name,
            row.standard || '11th',
            row.daysPresent,
            row.totalWorkingDays,
            row.percentage
        ]);
    });

    doc.autoTable({
        head: [tableColumn],
        body: tableRows,
        startY: 48,
        theme: 'striped',
        styles: { fontSize: 10 },
        headStyles: { fillColor: [44, 62, 80] }
    });

    const safeStandard = standard === "All" ? "All" : standard;
    const filename = `Student_Attendance_Summary_${safeStandard}_${month}.pdf`;

    if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
        const dataUri = doc.output('datauristring');
        const base64String = dataUri.substring(dataUri.indexOf(',') + 1);
        window.pywebview.api.save_file(base64String, filename, "PDF Document", "*.pdf")
            .then(res => {
                if (res.status === "success") {
                    window.showToast(tr("common.pdfSaved", "PDF saved successfully to:")
                        + "\n" + res.path, "success");
                } else if (res.status === "error") {
                    window.showToast(trf("common.pdfSaveFailed", { error: res.error },
                        `Failed to save PDF: ${res.error}`), "error");
                }
            })
            .catch(err => {
                console.error("Save PDF API error:", err);
                doc.save(filename);
            });
    } else {
        doc.save(filename);
    }
}

// CSV quoting utility — wraps values in quotes if they contain commas, quotes, or newlines
function csvQuote(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// HTML escaping utility to prevent XSS — student names are free text.
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
