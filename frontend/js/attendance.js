// i18n.js loads before this file. Each lookup carries its English fallback so a
// stale cached copy after an upgrade shows readable English rather than raw key
// names.
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

// Statuses arrive from the API in English ("Left Early") and are shown in the
// interface language. The English original is kept in currentAttendanceData so
// the CSV and PDF exports below stay English regardless of display language —
// jsPDF ships Helvetica only and cannot shape Devanagari.
function displayStatus(status) {
    return typeof window.tStatus === "function" ? window.tStatus(status) : status;
}

let instituteName = "Biometric Attendance";

// id -> { studentName, label, punchTime, status } for every punch currently on
// screen. The delegated click handler reads this instead of interpolating a
// student's name into an inline onclick, which would break on an apostrophe.
window._punchIndex = {};

let _studentsForRecordLoaded = false;

function formatEmailStatus(status, reason = null) {
    if (status === 'sent') {
        return `<span style="color: var(--success); font-weight: 600;">${escapeHtml(tr("dash.emailSent", "sent"))}</span>`;
    } else if (status === 'failed') {
        const escapedReason = escapeAttr(trf("dash.failureReasonTitle",
            { reason: reason || tr("dash.unknownError", "Unknown error") },
            `Failure Reason: ${reason || 'Unknown error'}`));
        return `<span style="color: var(--danger); font-weight: 600; cursor: help; border-bottom: 1px dotted var(--danger);" title="${escapedReason}">${escapeHtml(tr("dash.emailFailed", "failed"))}</span>`;
    } else if (status === 'N/A') {
        return `<span style="color: var(--text-muted); font-weight: normal;">${escapeHtml(tr("common.na", "N/A"))}</span>`;
    } else {
        return `<span style="color: var(--warning); font-weight: 600;">${escapeHtml(tr("dash.emailPending", "pending"))}</span>`;
    }
}

async function loadInstituteName() {
    try {
        const resp = await window.apiFetch('/api/settings');
        if (resp.ok) {
            const data = await resp.json();
            instituteName = data.institute_name || "Biometric Attendance";
            document.title = trf("att.titleFor", { institute: instituteName },
                `${instituteName} Attendance`);
        }
    } catch (e) {
        console.error("Failed to load settings in attendance.js", e);
    }
}

document.addEventListener("DOMContentLoaded", async () => {
    await loadInstituteName();
    // Set date to today initially
    const today = new Date().toISOString().split("T")[0];
    document.getElementById("attendance-date").value = today;
    loadAttendance();

    // --- Auto-update feature every 10 seconds ---
    setInterval(() => {
        const selectedDate = document.getElementById("attendance-date").value;
        const todayStr = new Date().toISOString().split("T")[0];

        // Only auto-update if we are looking at today's records
        if (selectedDate === todayStr) {
            loadAttendance();
        }
    }, 10000);

    const btnDailyPdf = document.getElementById("btn-export-daily-pdf");
    if (btnDailyPdf) btnDailyPdf.addEventListener("click", downloadDailyPDF);
    const btnDailyCsv = document.getElementById("btn-export-daily-csv");
    if (btnDailyCsv) btnDailyCsv.addEventListener("click", downloadDailyCSV);
    const btnDailyXlsx = document.getElementById("btn-export-daily-xlsx");
    if (btnDailyXlsx) btnDailyXlsx.addEventListener("click", downloadDailyExcel);
});

async function loadAttendance() {
    const selectedDate = document.getElementById("attendance-date").value;
    const selectedStatus = document.getElementById("attendance-status") ? document.getElementById("attendance-status").value : "All";
    const selectedStandard = document.getElementById("attendance-standard") ? document.getElementById("attendance-standard").value : "All";
    const searchNameInput = document.getElementById("search-student-name");
    const searchName = searchNameInput ? searchNameInput.value.trim().toLowerCase() : "";
    const searchWords = searchName ? searchName.split(/\s+/).filter(Boolean) : [];

    try {
        let url = '/api/attendance?limit=10000';
        if (selectedDate) url += `&date=${selectedDate}`;

        const [resp, holidaysResp] = await Promise.all([
            window.apiFetch(url),
            window.apiFetch('/api/holidays')
        ]);
        const logs = await resp.json();
        const holidays = await holidaysResp.json();

        // Find standard(s) on holiday today
        const holidaysToday = holidays.filter(h => h.date === selectedDate);
        const holidayStandards = new Set();
        let isGlobalHoliday = false;
        holidaysToday.forEach(h => {
            const standard = h.standard || "All";
            if (standard === "All") {
                isGlobalHoliday = true;
            } else {
                holidayStandards.add(standard);
            }
        });

        // Filter logs to exclude those on holiday
        let activeLogs = logs;
        if (isGlobalHoliday) {
            activeLogs = [];
        } else if (holidayStandards.size > 0) {
            activeLogs = logs.filter(l => !holidayStandards.has(l.standard || "11th"));
        }

        const tbodyEl = document.getElementById("attendance-table-body");
        tbodyEl.innerHTML = "";
        window.currentAttendanceData = [];

        if (activeLogs.length === 0) {
            tbodyEl.innerHTML = `<tr><td colspan='6' style='text-align:center; color: var(--text-muted);'>${escapeHtml(
                tr("dash.noRecordsForDate", "No attendance records found for this date."))}</td></tr>`;
            return;
        }

        // Group activeLogs by unique student to pair IN/OUT times
        // Use composite key (student_zk_id + student_name) so multiple students
        // with the same name are displayed as distinct individual records.
        const studentLogs = {};
        activeLogs.forEach(log => {
            const key = String(log.student_zk_id || log.student_id || "") + "_" + String(log.student_name || "");
            if (!studentLogs[key]) {
                studentLogs[key] = [];
            }
            studentLogs[key].push(log);
        });

        let rowsAdded = 0;

        Object.keys(studentLogs).forEach(key => {
            const punches = studentLogs[key];
            // Sort by punch_time ascending
            punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

            const firstPunch = punches[0];
            const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;

            const studentName = firstPunch.student_name || "Unknown";
            const zkId = String(firstPunch.student_zk_id != null ? firstPunch.student_zk_id : "");
            const standard = firstPunch.standard || "11th";

            // Use the last status as the effective status
            const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;

            let inTime = '--';
            let outTime = '--';

            if (punches.length === 1) {
                if (effectiveStatus === 'Left' || effectiveStatus === 'Left Early') {
                    outTime = new Date(firstPunch.punch_time).toLocaleTimeString();
                } else {
                    inTime = new Date(firstPunch.punch_time).toLocaleTimeString();
                }
            } else {
                inTime = new Date(firstPunch.punch_time).toLocaleTimeString();
                outTime = new Date(lastPunch.punch_time).toLocaleTimeString();
            }

            // Filter by Status
            if (selectedStatus !== "All" && effectiveStatus !== selectedStatus) {
                return;
            }
            // Filter by Standard/Class
            if (selectedStandard !== "All" && standard !== selectedStandard) {
                return;
            }
            // Filter by Student Name (case-insensitive, partial match, all words)
            if (searchWords.length > 0) {
                const lowerName = studentName.toLowerCase();
                const matches = searchWords.every(word => lowerName.includes(word));
                if (!matches) {
                    return;
                }
            }

            rowsAdded++;

            let inPunch = null;
            let outPunch = null;

            if (punches.length === 1) {
                if (effectiveStatus === 'Left' || effectiveStatus === 'Left Early') {
                    outPunch = firstPunch;
                } else {
                    inPunch = firstPunch;
                }
            } else {
                inPunch = firstPunch;
                outPunch = lastPunch;
            }

            const isManual = punches.some(p => p.is_manual);

            const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
            let badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(displayStatus(effectiveStatus))}</span>`;
            if (isManual) {
                badgeHtml += `<span class="manual-badge" title="${escapeAttr(
                    tr("att.manualTitle", "Added or corrected by an administrator"))}">${escapeHtml(
                    tr("common.manual", "Manual"))}</span>`;
            }

            let inStatus = 'pending';
            let inReason = null;
            if (inPunch) {
                if (inPunch.email_sent) {
                    inStatus = 'sent';
                } else if (inPunch.email_failure_reason) {
                    inStatus = 'failed';
                    inReason = inPunch.email_failure_reason;
                }
            }

            let outStatus = 'pending';
            let outReason = null;
            if (inPunch && inPunch.status === 'Absent') {
                outStatus = 'N/A';
            } else if (outPunch) {
                if (outPunch.email_sent) {
                    outStatus = 'sent';
                } else if (outPunch.email_failure_reason) {
                    outStatus = 'failed';
                    outReason = outPunch.email_failure_reason;
                }
            }

            let emailStatusHtml = `
                <div style="font-size: 11px; color: var(--text-muted); margin-top: 4px;">
                    (${escapeHtml(tr("dash.inShort", "In"))}: ${formatEmailStatus(inStatus, inReason)}, ${escapeHtml(tr("dash.outShort", "Out"))}: ${formatEmailStatus(outStatus, outReason)})
                </div>
            `;

            if (inReason) {
                emailStatusHtml += `<div style="color: var(--danger); font-size: 10px; margin-top: 2px; line-height: 1.2;">${escapeHtml(
                    trf("dash.inFailureReason", { reason: inReason }, `In Failure Reason: ${inReason}`))}</div>`;
            }
            if (outReason) {
                emailStatusHtml += `<div style="color: var(--danger); font-size: 10px; margin-top: 2px; line-height: 1.2;">${escapeHtml(
                    trf("dash.outFailureReason", { reason: outReason }, `Out Failure Reason: ${outReason}`))}</div>`;
            }

            // View-only table row: no action buttons
            const row = document.createElement("tr");
            row.dataset.name = studentName;
            row.dataset.zkid = zkId;
            row.innerHTML = `
                <td><div style="font-weight: 500;">${escapeHtml(studentName)}</div></td>
                <td>${escapeHtml(zkId)}</td>
                <td>${escapeHtml(standard)}</td>
                <td>${inTime}</td>
                <td>${outTime}</td>
                <td>
                    <div style="display: flex; flex-direction: column; align-items: flex-start;">
                        ${badgeHtml}
                        ${emailStatusHtml}
                    </div>
                </td>
            `;
            tbodyEl.appendChild(row);

            window.currentAttendanceData.push({
                studentName: studentName,
                standard: standard,
                inTime: inTime,
                outTime: outTime,
                status: effectiveStatus,
                zk_id: zkId,
                isManual: isManual
            });
        });

        if (rowsAdded === 0) {
            tbodyEl.innerHTML = `<tr><td colspan='6' style='text-align:center; color: var(--text-muted);'>${escapeHtml(
                tr("att.noneMatchFilters", "No students found with the selected filters."))}</td></tr>`;
        }
    } catch (e) {
        console.error("Error loading attendance", e);
    }
}

function filterAttendance() {
    loadAttendance();
}

/**
 * FastAPI returns `detail` as a string for HTTPException but as a list of field
 * errors for validation failures — show something readable either way.
 */
const describeApiError = (detail) => window.describeApiError(detail);

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// escapeHtml() leaves quotes alone, which is fine inside a text node but would
// let a student name containing a quote break out of a title attribute.
function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// CSV quoting utility
function csvQuote(value) {
    const str = String(value);
    if (str.includes(',') || str.includes('"') || str.includes('\n')) {
        return '"' + str.replace(/"/g, '""') + '"';
    }
    return str;
}

// The exported file contents below stay English in both languages: the PDF is
// drawn by jsPDF, which ships Helvetica only and cannot shape Devanagari, and a
// CSV whose column names shift with a UI setting is hostile to anything that
// consumes it. Only the toasts around the export are translated.
function downloadDailyCSV() {
    const data = window.currentAttendanceData;
    if (!data || data.length === 0) {
        window.showToast(tr("att.noDataToDownload", "No data to download."), "warning");
        return;
    }

    let csvContent = "";
    csvContent += csvQuote(instituteName) + "\n";
    csvContent += "ZK ID,Student Name,Standard,In Time,Out Time,Status,Source\n";

    data.forEach(row => {
        const source = row.isManual ? "Manual" : "Device";
        csvContent += `${csvQuote(row.zk_id)},${csvQuote(row.studentName)},${csvQuote(row.standard)},${csvQuote(row.inTime)},${csvQuote(row.outTime)},${csvQuote(row.status)},${csvQuote(source)}\n`;
    });

    const date = document.getElementById("attendance-date").value;
    const filename = `Daily_Attendance_${date}.csv`;

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
                fallbackDailyCSV(csvContent, filename);
            });
    } else {
        fallbackDailyCSV(csvContent, filename);
    }
}

function fallbackDailyCSV(csvContent, filename) {
    const encodedUri = encodeURI("data:text/csv;charset=utf-8," + csvContent);
    const link = document.createElement("a");
    link.setAttribute("href", encodedUri);
    link.setAttribute("download", filename);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
}

/**
 * A real .xlsx, built server-side by openpyxl and handed to the same native
 * save dialog the CSV and PDF exports already use.
 */
async function downloadDailyExcel() {
    const date = document.getElementById("attendance-date").value;
    const standard = document.getElementById("attendance-standard").value || "All";
    if (!date) {
        window.showToast(tr("att.needDate", "Pick a date first."), "warning");
        return;
    }

    const button = document.getElementById("btn-export-daily-xlsx");
    // Reads the label off the button rather than a constant, so restoring it
    // puts back whichever language is on screen.
    const originalLabel = button ? button.textContent : "";
    if (button) {
        button.disabled = true;
        button.textContent = tr("att.building", "Building…");
    }

    try {
        const resp = await window.apiFetch(
            `/api/reports/daily-xlsx?date=${encodeURIComponent(date)}&standard=${encodeURIComponent(standard)}`);
        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(describeApiError(detail)
                || tr("att.xlsxFailed", "Could not build the Excel file."), "warning");
            return;
        }
        const data = await resp.json();
        window.saveBase64File(data.content_base64, data.filename,
            "Excel Workbook", "*.xlsx",
            "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    } catch (e) {
        console.error("Daily xlsx export failed", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
    } finally {
        if (button) { button.disabled = false; button.textContent = originalLabel; }
    }
}

function downloadDailyPDF() {
    const data = window.currentAttendanceData;
    if (!data || data.length === 0) {
        window.showToast(tr("att.noDataToDownload", "No data to download."), "warning");
        return;
    }

    const { jsPDF } = window.jspdf;
    const doc = new jsPDF();
    const date = document.getElementById("attendance-date").value;
    const statusFilter = document.getElementById("attendance-status").value;
    const standardFilter = document.getElementById("attendance-standard").value;

    doc.setFontSize(18);
    doc.text(instituteName, 14, 20);
    doc.setFontSize(14);
    doc.text("Daily Attendance Report", 14, 28);

    doc.setFontSize(11);
    doc.text(`Date: ${date}`, 14, 36);
    doc.text(`Status Filter: ${statusFilter} | Standard: ${standardFilter}`, 14, 42);

    const tableColumn = ["ZK ID", "Student Name", "Standard", "In Time", "Out Time", "Status", "Source"];
    const tableRows = [];

    data.forEach(row => {
        tableRows.push([
            row.zk_id,
            row.studentName,
            row.standard,
            row.inTime,
            row.outTime,
            row.status,
            row.isManual ? "Manual" : "Device"
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

    const filename = `Daily_Attendance_${date}.pdf`;

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
