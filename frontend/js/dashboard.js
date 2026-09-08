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

// Attendance statuses come off the API in English ("Left Early") and are shown
// in the interface language. Nothing on this page is exported, so unlike the
// Students and Attendance tables there is no English copy to preserve for PDF.
function displayStatus(status) {
    return typeof window.tStatus === "function" ? window.tStatus(status) : status;
}

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

// Read from /api/settings on load so the retry controls describe what the
// backend will actually do, instead of the hardcoded "24 h" of 1.9.
let retryWindowHours = 24;
let retryAllAllowed = false;

async function loadInstituteSettings() {
    try {
        const resp = await window.apiFetch('/api/settings');
        if (resp.ok) {
            const data = await resp.json();
            const instituteName = data.institute_name || "Biometric Attendance";
            const heading = trf("dash.titleFor", { institute: instituteName },
                `${instituteName} Dashboard`);

            // Writes the inner span, not h1.firstChild — the first child node is
            // the whitespace before it, so writing that would leave the span's
            // own text in place and print the title twice.
            const titleText = document.getElementById("dashboard-title-text");
            if (titleText) titleText.textContent = heading;
            document.title = heading;

            retryWindowHours = data.email_retry_window_hours || 24;
            retryAllAllowed = !!data.admin_retry_all_allowed;
        }
    } catch (e) {
        console.error("Failed to load institute settings", e);
    }
}

/**
 * Warn while the account is still on the shipped admin/admin password.
 * Dismissal is per-session, which is deliberate: it stops nagging during this
 * sitting but returns after the next sign-in until the password is changed.
 */
function setupPasswordNotice() {
    const banner = document.getElementById("password-notice");
    if (!banner) return;

    if (sessionStorage.getItem("must_change_password") === "true") {
        banner.classList.add("show");
    }

    const close = document.getElementById("password-notice-close");
    if (close) {
        close.addEventListener("click", () => {
            banner.classList.remove("show");
            sessionStorage.removeItem("must_change_password");
        });
    }
}

document.addEventListener("DOMContentLoaded", loadDashboard);

async function loadDashboard() {
    try {
        setupPasswordNotice();

        // Load the institute name and the retry policy before the first render so
        // the heading and the retry controls are correct from the outset.
        await loadInstituteSettings();

        // Set date picker to today
        const today = new Date().toISOString().split("T")[0];
        document.getElementById("attendance-date").value = today;

        // Initial load
        loadAttendance(today);
        checkDeviceStatus();

        // --- Auto-update every 10 seconds ---
        // Student count is fetched inside loadAttendance() on every cycle so
        // adding/removing students mid-day keeps the absent count accurate.
        setInterval(() => {
            const selectedDate = document.getElementById("attendance-date").value;
            const todayStr = new Date().toISOString().split("T")[0];
            
            // Auto-update global counts
            updateFailedEmailsCount();

            // Only auto-update if we are looking at today's records
            if (selectedDate === todayStr) {
                console.log("Auto-refreshing dashboard logs...");
                loadAttendance(selectedDate);
                checkDeviceStatus();
            }
        }, 10000); 

        // Initial fetch for global failed emails
        updateFailedEmailsCount();

    } catch (e) {
        console.error("Error loading dashboard", e);
    }
}

async function loadAttendance(dateStr = null) {
    try {
        const today = new Date().toISOString().split("T")[0];
        const targetDate = dateStr || today;

        let url = `/api/attendance?date=${targetDate}&limit=10000`;

        const [resp, studentsResp, holidaysResp] = await Promise.all([
            window.apiFetch(url),
            window.apiFetch('/api/students'),
            window.apiFetch('/api/holidays')
        ]);
        const logs = await resp.json();
        const students = await studentsResp.json();
        const holidays = await holidaysResp.json();

        // Find standard(s) on holiday today
        const holidaysToday = holidays.filter(h => h.date === targetDate);
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

        // Filter students to exclude those on holiday
        let activeStudents = students.filter(s => s.is_active !== false);
        if (isGlobalHoliday) {
            activeStudents = [];
        } else if (holidayStandards.size > 0) {
            activeStudents = activeStudents.filter(s => !holidayStandards.has(s.standard || "11th"));
        }

        // Filter logs to exclude those on holiday
        let activeLogs = logs;
        if (isGlobalHoliday) {
            activeLogs = [];
        } else if (holidayStandards.size > 0) {
            activeLogs = logs.filter(l => !holidayStandards.has(l.standard || "11th"));
        }

        // Always keep total count fresh
        document.getElementById("total").innerText = activeStudents.length;

        const tbodyEl = document.querySelector('#attendance-table tbody');
        tbodyEl.innerHTML = "";

        if (activeLogs.length === 0) {
            tbodyEl.innerHTML = `<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>${escapeHtml(
                tr("dash.noRecordsForDate", "No attendance records found for this date."))}</td></tr>`;
        } else {
            // Group activeLogs by student to pair IN/OUT times
            const studentLogs = {};
            let failedCount = 0;
            
            activeLogs.forEach(log => {
                const key = log.student_name;
                if (!studentLogs[key]) {
                    studentLogs[key] = [];
                }
                studentLogs[key].push(log);
            });

            // Render each student's record
            Object.keys(studentLogs).forEach(studentName => {
                const punches = studentLogs[studentName];
                // Sort by punch_time ascending
                punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

                const firstPunch = punches[0];
                const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;

                const dateObj = new Date(firstPunch.punch_time);
                
                // Use the last status as the effective status
                const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;

                let inTime = '--';
                let outTime = '--';
                
                if (punches.length === 1) {
                    if (effectiveStatus === 'Left' || effectiveStatus === 'Left Early') {
                        outTime = dateObj.toLocaleTimeString();
                    } else {
                        inTime = dateObj.toLocaleTimeString();
                    }
                } else {
                    inTime = dateObj.toLocaleTimeString();
                    outTime = new Date(lastPunch.punch_time).toLocaleTimeString();
                }
                const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
                let badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(displayStatus(effectiveStatus))}</span>`;

                // Same badge as the Attendance page: an administrator's correction
                // must never be mistaken for something the device recorded.
                if (punches.some(p => p.is_manual)) {
                    badgeHtml += `<span class="manual-badge" title="${escapeAttr(
                        tr("dash.manualTitle", "Added or edited by an administrator"))}">${escapeHtml(
                        tr("common.manual", "Manual"))}</span>`;
                }
                
                // Track failures
                if (firstPunch.email_sent === false || (lastPunch && lastPunch.email_sent === false)) {
                    failedCount++;
                }

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

                // row, not `tr` — `tr` is the translation helper at the top of
                // this file, and a const of that name here would shadow it.
                const row = document.createElement("tr");
                row.innerHTML = `
                    <td>${dateObj.toLocaleDateString()}</td>
                    <td>${escapeHtml(studentName)}</td>
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
            });
        }

        // Count unique present students (any non-Absent status)
        const uniqueStudentsPunched = new Set(
            activeLogs.filter(l => l.status !== 'Absent')
                .map(l => l.student_zk_id)
        ).size;

        document.getElementById("present").innerText = uniqueStudentsPunched;

        const totalElems = activeStudents.length;
        document.getElementById("absent").innerText = Math.max(0, totalElems - uniqueStudentsPunched);

    } catch (e) {
        console.error("Error loading attendance logs", e);
    }
}


async function checkDeviceStatus() {
    try {
        const resp = await window.apiFetch('/api/settings/device-status');
        const data = await resp.json();
        const dot = document.getElementById("status-dot");
        const text = document.getElementById("status-text");

        if (data.online) {
            dot.className = "status-dot online";
            text.innerText = tr("dash.deviceOnline", "Device Online");
            text.style.color = "var(--success)";
        } else {
            dot.className = "status-dot offline";
            text.innerText = tr("dash.deviceOffline", "Device Offline");
            text.style.color = "var(--danger)";
        }
    } catch (e) {
        console.error("Error checking device status", e);
    }
}

function showDateRecords() {
    const selectedDate = document.getElementById("attendance-date").value;
    loadAttendance(selectedDate);
}

async function updateFailedEmailsCount() {
    try {
        const resp = await window.apiFetch('/api/attendance/failed-emails/count');
        const data = await resp.json();
        const count = data.count || 0;

        document.getElementById("emails-failed").innerText = count;
        const retryAllBtn = document.getElementById("btn-retry-all-emails");
        if (count > 0) {
            document.getElementById("btn-retry-emails").style.display = "block";
            document.getElementById("view-failed-emails").style.display = "block";
        } else {
            document.getElementById("btn-retry-emails").style.display = "none";
            document.getElementById("view-failed-emails").style.display = "none";
        }
        // The bulk button is independent of `count`: that count is windowed, so
        // there can be nothing recent to retry while older failures still exist.
        if (retryAllBtn) {
            retryAllBtn.style.display = retryAllAllowed ? "block" : "none";
        }
    } catch (e) {
        console.error("Error fetching failed emails count", e);
    }
}

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// escapeHtml() leaves quotes alone, which is fine inside a text node but would
// let an SMTP failure reason containing a quote break out of a title attribute.
function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

// Background retry mechanism
async function retryEmails() {
    // The window is configurable in Settings, so quote the real number rather
    // than the "24 h" that 1.9 hardcoded here.
    const windowLabel = retryWindowHours === 1
        ? tr("dash.windowHour", "1 hour")
        : trf("dash.windowHours", { count: retryWindowHours }, `${retryWindowHours} hours`);
    if (!confirm(trf("dash.confirmRetry", { window: windowLabel },
        `Retry sending failed emails from the last ${windowLabel}? This will process in the background.`))) return;

    const btn = document.getElementById("btn-retry-emails");
    const idleLabel = tr("dash.retrySending", "Retry Sending");
    btn.disabled = true;
    btn.innerText = tr("dash.retrying", "Retrying...");

    try {
        const resp = await window.apiFetch('/api/attendance/retry-emails', { method: 'POST' });
        const data = await resp.json();

        if (resp.ok) {
            // data.message is composed by the backend and stays as sent; only the
            // count suffix this page adds is translated.
            window.showToast(data.message + " " + trf("dash.countRecords",
                { count: data.count }, `(${data.count} records)`), "success");
            // Soft refresh logic to view progress
            setTimeout(() => {
                showDateRecords();
                updateFailedEmailsCount(); // Update the global count after retry
                btn.disabled = false;
                btn.innerText = idleLabel;
            }, 3000);
        } else {
            window.showToast(window.describeApiError(data && data.detail)
                || tr("dash.retryFailed", "Failed to retry emails"), "error");
            btn.disabled = false;
            btn.innerText = idleLabel;
        }
    } catch (e) {
        console.error("Error retrying emails", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
        btn.disabled = false;
        btn.innerText = idleLabel;
    }
}

/**
 * Retries every failed notification regardless of age. Gated behind the
 * "Allow Retry All Failed in bulk" setting, which is off by default — a
 * misconfigured SMTP account should not be able to fire off a hundred emails
 * from one click.
 */
async function retryAllEmails() {
    if (!confirm(tr("dash.confirmRetryAll",
        "Retry EVERY failed email, including old ones? Parents may receive notifications for past dates."))) return;

    const btn = document.getElementById("btn-retry-all-emails");
    btn.disabled = true;
    btn.innerText = tr("dash.retrying", "Retrying...");

    const reset = () => {
        btn.disabled = false;
        btn.innerText = tr("dash.retryAll", "Retry All (any age)");
    };

    try {
        const resp = await window.apiFetch('/api/attendance/retry-all-failed', { method: 'POST' });
        const data = await resp.json();

        if (resp.ok) {
            window.showToast(data.message + " " + trf("dash.countRecords",
                { count: data.count }, `(${data.count} records)`), "success");
            setTimeout(() => {
                showDateRecords();
                updateFailedEmailsCount();
                reset();
            }, 3000);
        } else {
            window.showToast(window.describeApiError(data && data.detail)
                || tr("dash.retryFailed", "Failed to retry emails"), "error");
            // A 403 means the setting was switched off since this page loaded,
            // so hide the control instead of leaving a button that can only fail.
            if (resp.status === 403) { btn.style.display = "none"; }
            reset();
        }
    } catch (e) {
        console.error("Error retrying all emails", e);
        window.showToast(tr("common.serverError", "Error connecting to server"), "error");
        reset();
    }
}

async function viewFailedEmails() {
    const modal = document.getElementById("failedEmailsModal");
    const tbody = document.getElementById("failed-emails-body");
    tbody.innerHTML = `<tr><td colspan='4' style='text-align:center;'>${escapeHtml(
        tr("common.loading", "Loading..."))}</td></tr>`;
    modal.classList.add("show");

    try {
        const resp = await window.apiFetch('/api/attendance/failed-emails');
        const logs = await resp.json();

        tbody.innerHTML = "";
        if (logs.length === 0) {
            tbody.innerHTML = `<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>${escapeHtml(
                tr("dash.noFailed", "No failed emails found."))}</td></tr>`;
        } else {
            const failedBadge = escapeHtml(tr("dash.failedBadge", "Failed"));
            logs.forEach(log => {
                const tr_ = document.createElement("tr");
                tr_.style.borderBottom = "1px solid var(--border-color)";
                const reason = log.email_failure_reason || tr("dash.unknownFailure", "Unknown failure");
                tr_.innerHTML = `
                    <td style="padding:12px;">${escapeHtml(log.student_name)}</td>
                    <td style="padding:12px;">${new Date(log.punch_time).toLocaleString()}</td>
                    <td style="padding:12px;"><span class="status-badge status-absent">${failedBadge}</span></td>
                    <td style="padding:12px; color:var(--danger); font-size:12px; max-width:250px; word-wrap:break-word;">${escapeHtml(reason)}</td>
                `;
                tbody.appendChild(tr_);
            });
        }
    } catch (e) {
        console.error("Error fetching failed emails list", e);
        tbody.innerHTML = `<tr><td colspan='4' style='text-align:center; color: var(--danger);'>${escapeHtml(
            tr("dash.failedLoadError", "Error loading list."))}</td></tr>`;
    }
}

function closeFailedEmailsModal() {
    document.getElementById("failedEmailsModal").classList.remove("show");
}
