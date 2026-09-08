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

        // Don't pull the table out from under someone who is mid-correction.
        const modal = document.getElementById("record-modal");
        if (modal && modal.classList.contains("show")) return;

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

    const btnAdd = document.getElementById("btn-add-record");
    if (btnAdd) btnAdd.addEventListener("click", () => openAddRecord());

    // One delegated listener instead of an inline handler per button.
    const tbody = document.getElementById("attendance-table-body");
    if (tbody) {
        tbody.addEventListener("click", (event) => {
            const button = event.target.closest("button[data-action]");
            if (!button) return;
            const id = parseInt(button.dataset.id, 10);
            if (!id) return;
            if (button.dataset.action === "edit") openEditRecord(id);
            else if (button.dataset.action === "delete") deleteRecord(id);
        });
    }

    // Close the modal on backdrop click and on Escape.
    const modal = document.getElementById("record-modal");
    if (modal) {
        modal.addEventListener("click", (event) => {
            if (event.target === modal) closeRecordModal();
        });
    }
    document.addEventListener("keydown", (event) => {
        if (event.key === "Escape") closeRecordModal();
    });
});

async function loadAttendance() {
    const selectedDate = document.getElementById("attendance-date").value;
    const selectedStatus = document.getElementById("attendance-status") ? document.getElementById("attendance-status").value : "All";
    const selectedStandard = document.getElementById("attendance-standard") ? document.getElementById("attendance-standard").value : "All";

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
        window._punchIndex = {};

        if (activeLogs.length === 0) {
            tbodyEl.innerHTML = `<tr><td colspan='6' style='text-align:center; color: var(--text-muted);'>${escapeHtml(
                tr("dash.noRecordsForDate", "No attendance records found for this date."))}</td></tr>`;
            return;
        }

        // Group activeLogs by student to pair IN/OUT times
        const studentLogs = {};
        activeLogs.forEach(log => {
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

            // Use the last status as the effective status
            const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;
            const standard = firstPunch.standard || "11th";

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

            if (selectedStatus !== "All" && effectiveStatus !== selectedStatus) {
                return;
            }
            if (selectedStandard !== "All" && standard !== selectedStandard) {
                return;
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

            // Each punch is a separate database row, so it gets its own pair of
            // buttons — otherwise there is no way to fix a wrong OUT time while
            // leaving a correct IN alone. The label is translated here because it
            // is also what the edit modal shows next to the student's name.
            const editable = [];
            if (inPunch) editable.push({ label: outPunch ? tr("dash.inShort", "In") : '', punch: inPunch });
            if (outPunch) editable.push({ label: inPunch ? tr("dash.outShort", "Out") : '', punch: outPunch });

            const actionButtons = editable.map(entry => {
                window._punchIndex[entry.punch.id] = {
                    studentName: studentName,
                    label: entry.label,
                    punchTime: entry.punch.punch_time,
                    status: entry.punch.status
                };
                const suffix = entry.label ? ` ${entry.label}` : '';
                const when = new Date(entry.punch.punch_time).toLocaleTimeString();
                const shown = displayStatus(entry.punch.status);
                const editTitle = escapeAttr(trf("att.editRowTitle", { status: shown, time: when },
                    `Edit this ${shown} record (${when})`));
                const deleteTitle = escapeAttr(trf("att.deleteRowTitle", { status: shown, time: when },
                    `Delete this ${shown} record (${when})`));
                return `
                    <button class="btn-row" data-action="edit" data-id="${entry.punch.id}"
                        title="${editTitle}">&#9998;${escapeHtml(suffix)}</button>
                    <button class="btn-row danger" data-action="delete" data-id="${entry.punch.id}"
                        title="${deleteTitle}">&#128465;</button>
                `;
            }).join("");

            // row, not `tr` — `tr` is the translation helper at the top of this
            // file, and a const of that name here would shadow it.
            const row = document.createElement("tr");
            row.innerHTML = `
                <td>${escapeHtml(studentName)}</td>
                <td>${escapeHtml(standard)}</td>
                <td>${inTime}</td>
                <td>${outTime}</td>
                <td>
                    <div style="display: flex; flex-direction: column; align-items: flex-start;">
                        ${badgeHtml}
                        ${emailStatusHtml}
                    </div>
                </td>
                <td><div class="row-actions" style="flex-wrap: wrap;">${actionButtons}</div></td>
            `;
            tbodyEl.appendChild(row);

            window.currentAttendanceData.push({
                studentName: studentName,
                standard: standard,
                inTime: inTime,
                outTime: outTime,
                // The English original, not displayStatus() — the CSV and PDF
                // exports read this field and must stay English.
                status: effectiveStatus,
                zk_id: firstPunch.student_zk_id,
                isManual: isManual,
                inId: inPunch ? inPunch.id : null,
                outId: outPunch ? outPunch.id : null
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

// ── Add / correct a record ───────────────────────────────────────────────────

async function loadStudentsForRecord() {
    if (_studentsForRecordLoaded) return;
    const select = document.getElementById("record-student");
    if (!select) return;
    try {
        const resp = await window.apiFetch('/api/students/?limit=100000');
        const students = await resp.json();
        students.sort((a, b) => a.name.localeCompare(b.name));
        if (students.length === 0) {
            select.innerHTML = `<option value="">${escapeHtml(
                tr("att.noStudentsYet", "No students registered yet"))}</option>`;
            return;
        }
        select.innerHTML = students
            .map(s => {
                const label = trf("att.studentOption",
                    { name: s.name, standard: s.standard || '11th', zk_id: s.zk_id },
                    `${s.name} — ${s.standard || '11th'} (ID ${s.zk_id})`);
                return `<option value="${s.id}">${escapeHtml(label)}</option>`;
            })
            .join("");
        _studentsForRecordLoaded = true;
    } catch (e) {
        console.error("Failed to load students for the record modal", e);
        select.innerHTML = `<option value="">${escapeHtml(
            tr("att.studentsLoadFailed", "Could not load students"))}</option>`;
    }
}

function openAddRecord() {
    const modal = document.getElementById("record-modal");
    if (!modal) return;

    document.getElementById("record-modal-title").textContent =
        tr("att.modalAdd", "Add Attendance Record");
    document.getElementById("record-modal-hint").innerHTML =
        tr("att.modalHint",
            "Use this for a punch the device missed, or to correct a wrong entry. " +
            "Records added here are marked <strong>Manual</strong> so they stay traceable.");
    document.getElementById("record-id").value = "";
    document.getElementById("record-student-row").style.display = "";
    document.getElementById("record-student-fixed-row").style.display = "none";
    document.getElementById("record-student").required = true;

    // Default to the date being viewed and the current wall-clock time — the
    // common case is "someone was here just now and the reader didn't catch it".
    const viewedDate = document.getElementById("attendance-date").value;
    document.getElementById("record-date").value = viewedDate || new Date().toISOString().split("T")[0];
    const now = new Date();
    document.getElementById("record-time").value =
        `${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;

    document.getElementById("record-status").value = "Present";
    document.getElementById("record-notify").checked = false;
    document.getElementById("record-save-btn").textContent = tr("att.saveRecord", "Save Record");

    modal.classList.add("show");
    loadStudentsForRecord();
}

function openEditRecord(id) {
    const entry = window._punchIndex[id];
    if (!entry) return;

    const modal = document.getElementById("record-modal");
    if (!modal) return;

    document.getElementById("record-modal-title").textContent =
        tr("att.correctTitle", "Correct Attendance Record");
    document.getElementById("record-modal-hint").textContent =
        tr("att.correctHint",
            "Change the time or the status of this record. The correction is tagged Manual.");
    document.getElementById("record-id").value = String(id);

    // The student cannot move to a different record — only the punch itself is
    // editable, so show the name as text rather than an inert dropdown.
    document.getElementById("record-student-row").style.display = "none";
    document.getElementById("record-student").required = false;
    document.getElementById("record-student-fixed-row").style.display = "";
    document.getElementById("record-student-fixed").textContent = entry.label
        ? trf("att.punchOf", { name: entry.studentName, label: entry.label },
            `${entry.studentName} (${entry.label} punch)`)
        : entry.studentName;

    // punch_time arrives as a naive local ISO string ("2026-08-24T09:15:00");
    // splitting it avoids the timezone shift that Date -> toISOString would add.
    const [datePart, timePart] = String(entry.punchTime).split("T");
    document.getElementById("record-date").value = datePart || "";
    document.getElementById("record-time").value = (timePart || "00:00").slice(0, 5);
    document.getElementById("record-status").value = entry.status;
    document.getElementById("record-notify").checked = false;
    document.getElementById("record-save-btn").textContent = tr("att.saveChanges", "Save Changes");

    modal.classList.add("show");
}

function closeRecordModal() {
    const modal = document.getElementById("record-modal");
    if (modal) modal.classList.remove("show");
}

async function saveRecord(event) {
    if (event) event.preventDefault();

    const id = document.getElementById("record-id").value;
    const date = document.getElementById("record-date").value;
    const time = document.getElementById("record-time").value;
    const status = document.getElementById("record-status").value;
    const notify = document.getElementById("record-notify").checked;
    const saveBtn = document.getElementById("record-save-btn");

    if (!date || !time) {
        window.showToast(tr("att.needDateTime", "Pick both a date and a time."), "warning");
        return;
    }

    if (id && !window.confirmTwice(
        tr("att.confirmUpdate", "Are you sure you want to modify this attendance record?"),
        tr("att.confirmUpdateAgain", "Please confirm again to save this attendance change."))) return;

    // Naive local timestamp, matching how device punches are stored.
    const punchTime = `${date}T${time}:00`;

    const originalLabel = saveBtn.textContent;
    saveBtn.disabled = true;
    saveBtn.textContent = tr("common.saving", "Saving...");

    try {
        let resp;
        if (id) {
            resp = await window.apiFetch(`/api/attendance/${id}`, {
                method: "PUT",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({ punch_time: punchTime, status: status, notify_parent: notify })
            });
        } else {
            const studentId = document.getElementById("record-student").value;
            if (!studentId) {
                window.showToast(tr("att.needStudent", "Select a student first."), "warning");
                return;
            }
            resp = await window.apiFetch('/api/attendance/manual', {
                method: "POST",
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    student_id: parseInt(studentId, 10),
                    punch_time: punchTime,
                    status: status,
                    notify_parent: notify
                })
            });
        }

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(describeApiError(detail)
                || tr("att.saveFailed", "Could not save the record."), "error");
            return;
        }

        closeRecordModal();
        window.showToast(
            id ? tr("att.corrected", "Record corrected.")
               : (notify ? tr("att.addedNotify", "Record added — parent will be emailed.")
                         : tr("att.added", "Record added.")),
            "success"
        );

        // The record may fall outside the date currently being viewed; jump to
        // it so the admin sees what they just saved instead of an unchanged table.
        const dateInput = document.getElementById("attendance-date");
        if (dateInput.value !== date) dateInput.value = date;
        loadAttendance();
    } catch (e) {
        console.error("Failed to save the attendance record", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
    } finally {
        saveBtn.disabled = false;
        saveBtn.textContent = originalLabel;
    }
}

async function deleteRecord(id) {
    const entry = window._punchIndex[id];
    const who = entry ? entry.studentName : tr("att.thisStudent", "this student");
    const which = entry && entry.label ? ` ${entry.label}` : "";
    const rawWhen = entry ? new Date(entry.punchTime).toLocaleString() : "";
    const when = rawWhen ? trf("att.atTime", { time: rawWhen }, ` at ${rawWhen}`) : "";
    const status = entry ? displayStatus(entry.status) : '';

    if (!window.confirmTwice(
        trf("att.confirmDelete", { which, status, who, when },
            `Delete the${which} "${status}" record for ${who}${when}?\n\nThis cannot be undone.`),
        tr("att.confirmDeleteAgain", "Please confirm again to permanently delete this attendance record."))) {
        return;
    }

    try {
        const resp = await window.apiFetch(`/api/attendance/${id}`, { method: "DELETE" });
        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(describeApiError(detail)
                || tr("att.deleteFailed", "Could not delete the record."), "error");
            return;
        }
        window.showToast(tr("att.deleted", "Record deleted."), "success");
        loadAttendance();
    } catch (e) {
        console.error("Failed to delete the attendance record", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
    }
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
