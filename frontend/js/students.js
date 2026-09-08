// i18n.js is loaded before this file on every page that uses it, but each lookup
// carries its English fallback so a stale cached copy after an upgrade cannot
// leave the page full of raw key names.
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

/**
 * Status wording for the screen.
 *
 * Exports keep the English word regardless of the interface language: jsPDF has
 * no Devanagari font and no complex-script shaping, so a Marathi status in a PDF
 * comes out as boxes. Every status cell therefore carries the English value in
 * `data-status-en`, and the PDF builder reads that attribute instead of the
 * visible text.
 */
function displayStatus(status) {
    return typeof window.tStatus === "function" ? window.tStatus(status) : status;
}

document.addEventListener("DOMContentLoaded", () => {
    loadStudents();
    wireRosterImportExport();
    wireClassTools();
    loadClassCounts();

    // Auto-fill gmail.com helper (only triggers on blur, not every keystroke)
    const autoFillGmail = function() {
        if (this.value.endsWith("@")) {
            this.value += "gmail.com";
        }
    };
    document.getElementById("parent_email").addEventListener("change", autoFillGmail);
    document.getElementById("edit_parent_email").addEventListener("change", autoFillGmail);

    document.getElementById("addStudentForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = document.getElementById("student_name").value;
        const zk_id = document.getElementById("zk_id").value;
        const parent_email = document.getElementById("parent_email").value;
        const standard = document.getElementById("standard").value;

        // Front-end numeric check for ZK ID
        if (!/^\d+$/.test(zk_id)) {
            window.showToast(tr("students.zkNumeric", "ZKTeco ID must be numeric only."), "error");
            return;
        }

        // Front-end duplicate checks
        const existingStudents = window.cachedStudents || [];

        const nameCount = existingStudents.filter(s => s.name.trim().toLowerCase() === name.trim().toLowerCase()).length;
        const emailCount = existingStudents.filter(s => s.parent_email.trim().toLowerCase() === parent_email.trim().toLowerCase()).length;

        if (nameCount >= 2) {
            window.showToast(tr("students.nameTwice", "Cannot save. That name is already used twice."), "warning");
            return;
        }

        if (emailCount >= 2) {
            window.showToast(tr("students.emailTwice", "Cannot save. That email is already used twice."), "warning");
            return;
        }

        try {
            const resp = await window.apiFetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, zk_id, parent_email, standard })
            });

            if (resp.ok) {
                window.showToast(tr("students.added", "Student added successfully!"), "success");
                document.getElementById("addStudentForm").reset();
                loadStudents();
                loadClassCounts();
            } else {
                const data = await resp.json();
                window.showToast(tr("students.failedPrefix", "Failed") + ": " +
                    (window.describeApiError(data.detail) || tr("students.unknownError", "Unknown error")), "error");
            }
        } catch (err) {
            console.error(err);
            window.showToast(tr("students.networkAdd", "Network error while adding student."), "error");
        }
    });

    document.getElementById("editStudentForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const id = document.getElementById("edit_student_id").value;
        const name = document.getElementById("edit_student_name").value;
        const zk_id = document.getElementById("edit_zk_id").value;
        const parent_email = document.getElementById("edit_parent_email").value;
        const standard = document.getElementById("edit_standard").value;

        // Front-end numeric check for ZK ID
        if (!/^\d+$/.test(zk_id)) {
            window.showToast(tr("students.zkNumeric", "ZKTeco ID must be numeric only."), "error");
            return;
        }

        // Front-end duplicate checks excluding the student being edited
        const existingStudents = window.cachedStudents || [];

        const nameCount = existingStudents.filter(s => s.id != id && s.name.trim().toLowerCase() === name.trim().toLowerCase()).length;
        const emailCount = existingStudents.filter(s => s.id != id && s.parent_email.trim().toLowerCase() === parent_email.trim().toLowerCase()).length;

        if (nameCount >= 2) {
            window.showToast(tr("students.nameTwice", "Cannot save. That name is already used twice."), "warning");
            return;
        }

        if (emailCount >= 2) {
            window.showToast(tr("students.emailTwice", "Cannot save. That email is already used twice."), "warning");
            return;
        }

        if (!window.confirmTwice(
            tr("students.confirmUpdate", "Are you sure you want to update this student's details?"),
            tr("students.confirmUpdateAgain", "Please confirm again to save these student details."))) {
            return;
        }

        try {
            const resp = await window.apiFetch(`/api/students/${id}`, {
                method: 'PUT',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, zk_id, parent_email, standard })
            });

            if (resp.ok) {
                window.showToast(tr("students.updated", "Student updated successfully!"), "success");
                closeEditStudentModal();
                loadStudents();
                loadClassCounts();
            } else {
                const data = await resp.json();
                window.showToast(tr("students.failedPrefix", "Failed") + ": " +
                    (window.describeApiError(data.detail) || tr("students.unknownError", "Unknown error")), "error");
            }
        } catch (err) {
            console.error(err);
            window.showToast(tr("students.networkUpdate", "Network error while updating student."), "error");
        }
    });
});

// ── Roster import / export ───────────────────────────────────────────────────
// The single-row form above is fine for one late enrolment. A whole class is a
// CSV, and it is validated row by row so one bad email does not cost the other
// 200 rows.

function wireRosterImportExport() {
    const fileInput = document.getElementById("import-file");
    const drop = document.getElementById("import-drop");
    const template = document.getElementById("btn-download-template");
    const exportBtn = document.getElementById("btn-export-students");
    if (!fileInput || !drop) return;

    drop.addEventListener("click", () => fileInput.click());

    fileInput.addEventListener("change", () => {
        if (fileInput.files && fileInput.files.length) {
            importRoster(fileInput.files[0]);
        }
    });

    // Dragging a file onto the page navigates away by default, so both handlers
    // have to preventDefault — dragover as well as drop.
    ["dragenter", "dragover"].forEach(name => {
        drop.addEventListener(name, (event) => {
            event.preventDefault();
            drop.classList.add("dragover");
        });
    });
    ["dragleave", "dragend"].forEach(name => {
        drop.addEventListener(name, () => drop.classList.remove("dragover"));
    });
    drop.addEventListener("drop", (event) => {
        event.preventDefault();
        drop.classList.remove("dragover");
        const file = event.dataTransfer && event.dataTransfer.files && event.dataTransfer.files[0];
        if (file) importRoster(file);
    });

    if (template) {
        template.addEventListener("click", () => downloadRosterFile(
            '/api/students/import-template', template, tr("students.building", "Building…")));
    }
    if (exportBtn) {
        exportBtn.addEventListener("click", () => downloadRosterFile(
            '/api/students/export', exportBtn, tr("students.exporting", "Exporting…")));
    }
}

async function downloadRosterFile(url, button, busyLabel) {
    const original = button.textContent;
    button.disabled = true;
    button.textContent = busyLabel;
    try {
        const resp = await window.apiFetch(url);
        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("students.buildFileFailed", "Could not build the file."), "error");
            return;
        }
        const data = await resp.json();
        if (data.count === 0) {
            window.showToast(tr("students.noExport", "No students to export yet."), "warning");
            return;
        }
        window.saveBase64File(data.content_base64, data.filename,
            "Comma Separated Values", "*.csv", "text/csv");
    } catch (e) {
        console.error("Roster file download failed", e);
        window.showToast(tr("students.serverUnreachable", "Could not reach the server."), "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

async function importRoster(file) {
    const drop = document.getElementById("import-drop");
    const label = document.getElementById("import-drop-label");
    const originalLabel = label.textContent;

    if (!/\.csv$/i.test(file.name)) {
        window.showToast(tr("students.csvOnly",
            "Choose a .csv file. Save an Excel sheet as \"CSV UTF-8\" first."), "warning");
        return;
    }

    label.textContent = trf("students.importing", { file: file.name }, `Importing ${file.name}…`);
    drop.style.pointerEvents = "none";

    try {
        const body = new FormData();
        body.append("file", file);
        const resp = await window.apiFetch('/api/students/bulk-import', { method: "POST", body });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("students.importFailed", "Import failed."), "error");
            return;
        }

        const report = await resp.json();
        renderImportReport(report);

        if (report.added > 0) {
            window.showToast(trf("students.importedN", { n: report.added },
                `Imported ${report.added} students.`), "success");
            loadStudents();
            loadClassCounts();
        } else if (report.total === 0) {
            window.showToast(tr("students.noDataRows", "The file had no data rows."), "warning");
        } else {
            window.showToast(tr("students.nothingImported",
                "Nothing was imported — see the results below."), "warning");
        }
    } catch (e) {
        console.error("Roster import failed", e);
        window.showToast(tr("students.serverUnreachable", "Could not reach the server."), "error");
    } finally {
        label.textContent = originalLabel;
        drop.style.pointerEvents = "";
        // Reset so re-selecting the same file after a fix still fires `change`.
        document.getElementById("import-file").value = "";
    }
}

function renderImportReport(report) {
    const wrapper = document.getElementById("import-result");
    const chips = document.getElementById("import-chips");
    const body = document.getElementById("import-log-body");

    chips.innerHTML = `
        <span class="import-chip added">${tr("students.chipAdded", "Added")}: ${report.added}</span>
        <span class="import-chip skipped">${tr("students.chipSkipped", "Skipped")}: ${report.skipped}</span>
        <span class="import-chip failed">${tr("students.chipErrors", "Errors")}: ${report.failed}</span>
        <span class="import-chip">${tr("students.chipRows", "Rows read")}: ${report.total}</span>
    `;

    const rows = report.results || [];
    if (rows.length === 0) {
        body.innerHTML = `<tr><td colspan="5" style="text-align:center; color: var(--text-muted);">${tr("students.noDataRows", "The file had no data rows.")}</td></tr>`;
    } else {
        // Problems first: with a 200-row roster the three failures are the only
        // lines anyone needs to look at.
        const rank = { error: 0, skipped: 1, added: 2 };
        const sorted = rows.slice().sort((a, b) =>
            (rank[a.status] ?? 3) - (rank[b.status] ?? 3) || a.line - b.line);

        const colour = { added: "var(--success)", skipped: "var(--warning)", error: "var(--danger)" };
        // The API's status word is a machine value; only its label is translated.
        const statusLabel = {
            added: tr("students.resAdded", "added"),
            skipped: tr("students.resSkipped", "skipped"),
            error: tr("students.resError", "error")
        };
        const blank = `<span style="color: var(--text-muted);">${tr("students.blank", "(blank)")}</span>`;
        body.innerHTML = sorted.map(r => `
            <tr>
                <td>${escapeHtml(String(r.line))}</td>
                <td>${escapeHtml(r.name) || blank}</td>
                <td>${escapeHtml(r.zk_id) || '<span style="color: var(--text-muted);">—</span>'}</td>
                <td style="color: ${colour[r.status] || 'inherit'}; font-weight: 600; text-transform: capitalize;">${escapeHtml(statusLabel[r.status] || r.status)}</td>
                <td>${escapeHtml(r.message)}</td>
            </tr>
        `).join("");
    }

    wrapper.style.display = "block";
}

// ── Class tools ──────────────────────────────────────────────────────────────
// Promotion, class-to-class moves and clearing a finished batch. All three used
// to be one-student-at-a-time jobs.

function wireClassTools() {
    const refresh = document.getElementById("btn-refresh-counts");
    const preview = document.getElementById("btn-preview-promotion");
    const move = document.getElementById("btn-move-class");
    const clear = document.getElementById("btn-clear-class");
    const graduateAction = document.getElementById("graduate-action");

    if (refresh) refresh.addEventListener("click", () => loadClassCounts(true));
    if (preview) preview.addEventListener("click", previewPromotion);
    if (move) move.addEventListener("click", moveClass);
    if (clear) clear.addEventListener("click", clearClass);

    // Changing what happens to the final class rewrites the last line of the
    // preview, so re-render it from the plan already fetched rather than making
    // the admin press Preview again.
    if (graduateAction) {
        graduateAction.addEventListener("change", () => {
            if (window.cachedPromotionPlan) renderPromotionPlan(window.cachedPromotionPlan);
        });
    }
}

async function loadClassCounts(announce = false) {
    const box = document.getElementById("class-counts");
    if (!box) return;

    try {
        const resp = await window.apiFetch('/api/students/by-standard');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        const rows = data.standards || [];
        window.cachedClassCounts = rows;

        if (rows.length === 0) {
            box.innerHTML = `<span style="font-size:13px; color: var(--text-muted);">${tr("students.none", "No students enrolled.")}</span>`;
            return;
        }

        box.innerHTML = rows.map(r => {
            const archived = r.archived > 0
                ? ` <span class="count-value" style="color: var(--text-muted);">+${r.archived}</span>`
                : "";
            const title = r.archived > 0
                ? ` title="${escapeAttr(r.archived + " " + tr("students.archived", "Archived"))}"`
                : "";
            return `<span class="count-chip${r.archived > 0 && r.active === 0 ? ' archived' : ''}"${title}>` +
                `<strong>${escapeHtml(r.standard)}</strong>` +
                `<span class="count-value">${r.active}</span>${archived}</span>`;
        }).join("");

        if (announce) window.showToast(tr("classTools.countsRefreshed", "Class sizes updated."), "success");
    } catch (e) {
        console.error("Class counts failed", e);
        box.innerHTML = `<span style="font-size:13px; color: var(--danger);">${tr("classTools.countsFailed", "Could not read the class sizes.")}</span>`;
    }
}

/** Head count of one class, from the cached chips — used only in confirm text. */
function cachedCountFor(standard, key = "active") {
    const rows = window.cachedClassCounts || [];
    const match = rows.find(r => r.standard === standard);
    return match ? match[key] : 0;
}

async function previewPromotion() {
    const box = document.getElementById("promotion-plan");
    const button = document.getElementById("btn-preview-promotion");
    if (!box) return;

    box.style.display = "block";
    box.innerHTML = `<span style="color: var(--text-muted);">${tr("classTools.loadingPlan", "Working out the plan…")}</span>`;
    button.disabled = true;

    try {
        const resp = await window.apiFetch('/api/students/promotion-plan');
        if (!resp.ok) throw new Error(`HTTP ${resp.status}`);
        const data = await resp.json();
        window.cachedPromotionPlan = data;
        renderPromotionPlan(data);
    } catch (e) {
        console.error("Promotion plan failed", e);
        box.innerHTML = `<span style="color: var(--danger);">${tr("classTools.planFailed", "Could not build the promotion plan.")}</span>`;
    } finally {
        button.disabled = false;
    }
}

function renderPromotionPlan(data) {
    const box = document.getElementById("promotion-plan");
    const plan = data.plan || [];

    if (plan.length < 2) {
        box.innerHTML = `<span style="color: var(--danger);">${tr("classTools.needTwoClasses", "Add at least two classes in Settings before promoting.")}</span>`;
        return;
    }

    const action = document.getElementById("graduate-action").value || "archive";
    const graduateConsequence = {
        archive: tr("classTools.graduatingArchive", "will be archived (records kept)"),
        delete: tr("classTools.graduatingDelete", "will be deleted permanently, with all attendance"),
        keep: tr("classTools.graduatingKeep", "stay where they are")
    }[action];

    const items = plan.map(step => {
        const count = step.students;
        if (step.graduating) {
            if (count === 0) {
                return `<li class="plan-empty">${escapeHtml(step.from_standard)} — ${tr("classTools.noStudents", "No students in this class.")}</li>`;
            }
            return `<li class="plan-graduating">${escapeHtml(step.from_standard)} · ${count} ` +
                `${tr("classTools.students", "students")} ${tr("classTools.willGraduate", "graduating")} — ${escapeHtml(graduateConsequence)}</li>`;
        }
        if (count === 0) {
            return `<li class="plan-empty">${escapeHtml(step.from_standard)} → ${escapeHtml(step.to_standard)} — ${tr("classTools.noStudents", "No students in this class.")}</li>`;
        }
        return `<li>${escapeHtml(step.from_standard)} → ${escapeHtml(step.to_standard)} · ${count} ${tr("classTools.students", "students")}</li>`;
    }).join("");

    const nobody = (data.total_moving || 0) === 0 && (data.total_graduating || 0) === 0;

    box.innerHTML = `
        <h5>${tr("classTools.planTitle", "What will happen")}</h5>
        <ul>${items}</ul>
        ${nobody
            ? `<span class="plan-empty">${tr("classTools.nothingToDo", "Nothing to promote — no students are enrolled.")}</span>`
            : `<label class="tool-label" for="promote-confirm">${tr("classTools.typePromote", "Type PROMOTE to confirm")}</label>
               <input type="text" id="promote-confirm" class="input-field" autocomplete="off" spellcheck="false">
               <button type="button" class="btn btn-danger" id="btn-confirm-promotion" style="margin-top: 10px;">${tr("classTools.promoteConfirmBtn", "Promote All Classes")}</button>`}
    `;

    const confirmBtn = document.getElementById("btn-confirm-promotion");
    if (confirmBtn) confirmBtn.addEventListener("click", confirmPromotion);
}

async function confirmPromotion() {
    const input = document.getElementById("promote-confirm");
    const button = document.getElementById("btn-confirm-promotion");
    const typed = (input.value || "").trim();

    // The phrase is checked here and again on the server. This copy only exists
    // to keep a mis-click from becoming a round trip.
    if (typed !== "PROMOTE") {
        window.showToast(tr("classTools.promoteConfirm", "Type PROMOTE (in capitals) to run this promotion."), "warning");
        input.focus();
        return;
    }

    if (!window.confirmTwice(
        tr("classTools.promoteConfirmAgain", "The promotion plan is ready. Do you want to continue?"),
        tr("classTools.promoteFinalConfirm", "Please confirm again to promote all classes."))) return;

    const action = document.getElementById("graduate-action").value || "archive";
    const original = button.textContent;
    button.disabled = true;
    button.textContent = tr("students.building", "Building…");

    try {
        const resp = await window.apiFetch('/api/students/promote', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ graduate_action: action, confirm: "PROMOTE" })
        });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("classTools.promoteFailed", "Could not run the promotion."), "error");
            return;
        }

        const result = await resp.json();
        let message = trf("classTools.promoted", { moved: result.promoted },
            `Promotion complete. ${result.promoted} students moved.`);
        if (result.graduate_action === "archive" && result.graduated > 0) {
            message += " " + trf("classTools.promotedArchived", { n: result.graduated }, `${result.graduated} archived.`);
        } else if (result.graduate_action === "delete" && result.graduated > 0) {
            message += " " + trf("classTools.promotedDeleted", { n: result.graduated }, `${result.graduated} deleted.`);
        }
        window.showToast(message, "success");

        // The plan is spent: its head counts describe a roster that no longer
        // exists, and leaving the confirm box on screen invites a second run.
        window.cachedPromotionPlan = null;
        document.getElementById("promotion-plan").style.display = "none";
        loadStudents();
        loadClassCounts();
    } catch (e) {
        console.error("Promotion failed", e);
        window.showToast(tr("students.serverUnreachable", "Could not reach the server."), "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

async function moveClass() {
    const from = document.getElementById("move-from").value;
    const to = document.getElementById("move-to").value;
    const button = document.getElementById("btn-move-class");

    if (!from || !to) {
        window.showToast(tr("classTools.moveNeedBoth", "Choose both a source and a destination class."), "warning");
        return;
    }
    if (from === to) {
        window.showToast(tr("classTools.moveSame", "Those are the same class — nothing to move."), "warning");
        return;
    }

    const count = cachedCountFor(from);
    if (count === 0) {
        window.showToast(trf("classTools.moveNobody", { from },
            `There are no active students in ${from}.`), "warning");
        return;
    }

    if (!window.confirmTwice(
        trf("classTools.moveConfirm", { n: count, from, to },
            `Move ${count} students from ${from} to ${to}?`),
        tr("classTools.moveConfirmAgain", "Please confirm again to move these students."))) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = tr("students.building", "Building…");

    try {
        const resp = await window.apiFetch('/api/students/change-standard', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ from_standard: from, to_standard: to })
        });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("classTools.moveFailed", "Could not move that class."), "error");
            return;
        }

        const result = await resp.json();
        window.showToast(trf("classTools.moved", { n: result.moved, to },
            `Moved ${result.moved} students to ${to}.`), "success");
        loadStudents();
        loadClassCounts();
    } catch (e) {
        console.error("Class move failed", e);
        window.showToast(tr("students.serverUnreachable", "Could not reach the server."), "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

async function clearClass() {
    const select = document.getElementById("clear-class");
    const confirmInput = document.getElementById("clear-confirm");
    const button = document.getElementById("btn-clear-class");
    const cls = select.value;

    if (!cls) {
        window.showToast(tr("classTools.clearNeedClass", "Choose the class you want to clear."), "warning");
        return;
    }
    // The typed name is what the server checks too. Asking for it here keeps a
    // stray click on a red button from deleting a class.
    if ((confirmInput.value || "").trim() !== cls) {
        window.showToast(tr("classTools.clearMismatch", "Type the class name exactly as shown to confirm."), "warning");
        confirmInput.focus();
        return;
    }

    const total = cachedCountFor(cls, "total");
    if (total === 0) {
        window.showToast(trf("classTools.clearNobody", { cls }, `There are no students in ${cls}.`), "warning");
        return;
    }

    if (!window.confirmTwice(
        trf("classTools.clearConfirm", { n: total, cls },
            `Permanently delete ${total} students in ${cls}, along with every attendance record they have?\n\nThis cannot be undone.`),
        tr("classTools.clearConfirmAgain", "Please confirm again to permanently delete this class."))) return;

    const original = button.textContent;
    button.disabled = true;
    button.textContent = tr("students.building", "Building…");

    try {
        const resp = await window.apiFetch('/api/students/bulk-delete', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ standard: cls, confirm: cls, include_archived: true })
        });

        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("classTools.clearFailed", "Could not clear that class."), "error");
            return;
        }

        const result = await resp.json();
        window.showToast(trf("classTools.cleared",
            { students: result.students_deleted, records: result.attendance_deleted },
            `Deleted ${result.students_deleted} students and ${result.attendance_deleted} attendance records.`), "success");
        confirmInput.value = "";
        loadStudents();
        loadClassCounts();
    } catch (e) {
        console.error("Class clear failed", e);
        window.showToast(tr("students.serverUnreachable", "Could not reach the server."), "error");
    } finally {
        button.disabled = false;
        button.textContent = original;
    }
}

// ── Roster ───────────────────────────────────────────────────────────────────

async function loadStudents() {
    const showArchived = document.getElementById("show-archived");
    const includeArchived = !!(showArchived && showArchived.checked);

    try {
        const resp = await window.apiFetch(
            `/api/students${includeArchived ? '?include_archived=true' : ''}`);
        const students = await resp.json();
        window.cachedStudents = students;

        const tbody = document.getElementById("student-table-body");
        tbody.innerHTML = "";

        if (students.length === 0) {
            tbody.innerHTML = `<tr><td colspan='6' style='text-align:center; color: var(--text-muted);'>${tr("students.none", "No students enrolled.")}</td></tr>`;
        } else {
            const attendanceLabel = tr("students.attendanceBtn", "Attendance");
            const editLabel = tr("students.editBtn", "Edit");
            const deleteLabel = tr("students.deleteBtn", "Delete");
            const restoreLabel = tr("students.restore", "Restore");
            const archivedLabel = tr("students.archived", "Archived");

            students.forEach(s => {
                const archived = s.is_active === false;
                const tr_ = document.createElement("tr");
                if (archived) tr_.className = "is-archived";

                // The archived badge goes in the name cell, not the standard
                // cell — filterStudents() compares that one against the class
                // filter as exact text.
                const restoreBtn = archived
                    ? `<button class="btn-restore-student" data-id="${s.id}" style="background-color: var(--success); border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; margin: 0;">${escapeHtml(restoreLabel)}</button>`
                    : "";

                tr_.innerHTML = `
                    <td>${escapeHtml(String(s.id))}</td>
                    <td>${escapeHtml(s.name)}${archived ? `<span class="archived-badge">${escapeHtml(archivedLabel)}</span>` : ""}</td>
                    <td>${escapeHtml(s.standard || '')}</td>
                    <td>${escapeHtml(s.zk_id)}</td>
                    <td>${escapeHtml(s.parent_email)}</td>
                    <td style="display: flex; gap: 5px; align-items: center; white-space: nowrap; flex-wrap: nowrap;">
                        <button class="btn-add btn-attendance-modal" data-id="${s.id}" style="padding: 5px 10px; font-size: 12px; margin: 0;">${escapeHtml(attendanceLabel)}</button>
                        <button class="btn-edit-modal" data-id="${s.id}" style="background-color: var(--warning); border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; margin: 0;">${escapeHtml(editLabel)}</button>
                        ${restoreBtn}
                        <button class="btn-delete btn-delete-student" data-id="${s.id}" style="padding: 5px 10px; font-size: 12px; margin: 0;">${escapeHtml(deleteLabel)}</button>
                    </td>
                `;

                // Attach event listeners safely (no inline JS string injection)
                tr_.querySelector('.btn-attendance-modal').addEventListener('click', () => {
                    openAttendanceModal(s.id, s.name, s.zk_id);
                });
                tr_.querySelector('.btn-edit-modal').addEventListener('click', () => {
                    openEditStudentModal(s.id, s.name, s.zk_id, s.parent_email, s.standard);
                });
                tr_.querySelector('.btn-delete-student').addEventListener('click', () => {
                    deleteStudent(s.id);
                });
                const restore = tr_.querySelector('.btn-restore-student');
                if (restore) restore.addEventListener('click', () => restoreStudent(s.id));

                tbody.appendChild(tr_);
            });
        }
        // Apply filter in case text is already typed
        filterStudents();
    } catch (e) {
        console.error("Error fetching students:", e);
        const tbody = document.getElementById("student-table-body");
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan='6' style='text-align:center; color: var(--danger);'>${tr("students.serverUnreachable", "Could not reach the server.")}</td></tr>`;
        }
    }
}

async function deleteStudent(id) {
    // First, check how many attendance records this student has
    let recordCount = 0;
    try {
        const countResp = await window.apiFetch(`/api/attendance?student_id=${id}&limit=100000`);
        if (countResp.ok) {
            const records = await countResp.json();
            recordCount = records.length;
        }
    } catch (e) {
        // If count check fails, proceed with basic confirmation
    }

    let confirmMsg = tr("students.confirmDelete", "Are you sure you want to delete this student?");
    if (recordCount > 0) {
        confirmMsg = trf("students.confirmDeleteRecords", { count: recordCount },
            `⚠️ This student has ${recordCount} attendance records that will also be permanently deleted.\n\nAre you sure you want to proceed?`);
    }

    if (!window.confirmTwice(confirmMsg,
        tr("students.confirmDeleteAgain", "Please confirm again to permanently delete this student and related records."))) return;

    try {
        const resp = await window.apiFetch(`/api/students/${id}`, { method: 'DELETE' });
        if (resp.ok) {
            window.showToast(tr("students.deleted", "Student deleted successfully."), "success");
            loadStudents();
            loadClassCounts();
        } else {
            window.showToast(tr("students.deleteFailed", "Failed to delete student."), "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast(tr("students.deleteError", "Error deleting student."), "error");
    }
}

/** Bring one archived student back — a leaver repeating the year, usually. */
async function restoreStudent(id) {
    if (!window.confirmTwice(
        tr("students.confirmRestore", "Restore this student to the active roster?"),
        tr("students.confirmRestoreAgain", "Please confirm again to restore this student."))) return;

    try {
        const resp = await window.apiFetch(`/api/students/${id}/restore`, { method: 'POST' });
        if (!resp.ok) {
            const detail = await resp.json().then(d => d.detail).catch(() => null);
            window.showToast(window.describeApiError(detail) ||
                tr("students.restoreFailed", "Could not restore that student."), "error");
            return;
        }
        window.showToast(tr("students.restored", "Student restored to the active roster."), "success");
        loadStudents();
        loadClassCounts();
    } catch (e) {
        console.error("Restore failed", e);
        window.showToast(tr("students.serverUnreachable", "Could not reach the server."), "error");
    }
}

function filterStudents() {
    const term = document.getElementById("search-id").value.toLowerCase();
    const standardFilter = document.getElementById("filter-standard").value;
    const rows = document.getElementById("student-table-body").getElementsByTagName("tr");

    for (let i = 0; i < rows.length; i++) {
        const zkIdCol = rows[i].getElementsByTagName("td")[3];
        const standardCol = rows[i].getElementsByTagName("td")[2];
        if (zkIdCol && standardCol) {
            const zkIdText = zkIdCol.textContent || zkIdCol.innerText;
            const standardText = standardCol.textContent || standardCol.innerText;

            const matchSearch = zkIdText.toLowerCase().includes(term);
            const matchStandard = (standardFilter === "All" || standardText === standardFilter);

            if (matchSearch && matchStandard) {
                rows[i].style.display = "";
            } else {
                rows[i].style.display = "none";
            }
        }
    }
}

function openAttendanceModal(studentId, studentName, studentZkId) {
    document.getElementById("attendance-modal").style.display = "block";
    document.getElementById("modal-student-name").textContent =
        trf("students.attendanceOf", { name: studentName }, `Attendance: ${studentName}`);

    const zkEl = document.getElementById("modal-student-zk-id");
    zkEl.textContent = trf("students.zkIdLabel", { id: studentZkId }, `ZK ID: ${studentZkId}`);
    zkEl.dataset.name = studentName;
    zkEl.dataset.zkid = studentZkId;

    document.getElementById("modal-student-id").value = studentId;

    const now = new Date();
    const monthStr = now.getFullYear() + "-" + String(now.getMonth() + 1).padStart(2, '0');
    document.getElementById("modal-month").value = monthStr;

    loadStudentMonthlyAttendance();
}

function closeAttendanceModal() {
    document.getElementById("attendance-modal").style.display = "none";
}

async function openEditStudentModal(id, name, zk_id, parent_email, standard) {
    document.getElementById("edit-student-modal").style.display = "block";
    document.getElementById("edit_student_id").value = id;
    document.getElementById("edit_student_name").value = name;
    document.getElementById("edit_zk_id").value = zk_id;
    document.getElementById("edit_parent_email").value = parent_email;

    // The class list is loaded from Settings, so re-fill this one select with the
    // student's own value marked. Going through populateStandardSelects (rather
    // than setting .value) means a 12th student is never silently reset to 11th
    // when the list is still in flight, and it costs no extra request — the
    // standards promise is cached.
    const stdSelect = document.getElementById("edit_standard");
    stdSelect.dataset.selected = standard || "";
    await window.populateStandardSelects(stdSelect.parentElement);
}

function closeEditStudentModal() {
    document.getElementById("edit-student-modal").style.display = "none";
    document.getElementById("editStudentForm").reset();
}

function downloadStudentMonthlyReport() {
    const zkIdEl = document.getElementById("modal-student-zk-id");
    const studentName = zkIdEl.dataset.name || "Unknown";
    const studentZkId = zkIdEl.dataset.zkid || "Unknown";
    const month = document.getElementById("modal-month").value;

    const tbodyEl = document.getElementById("modal-attendance-body");
    const rows = tbodyEl.getElementsByTagName("tr");

    // A placeholder row (loading / empty / error) has no data cells, so the
    // presence of four <td>s is a surer test than matching its wording — which
    // is translated now and would not match an English string.
    const hasData = Array.from(rows).some(r => r.getElementsByTagName("td").length === 4);
    if (!hasData) {
        window.showToast(tr("students.noData", "No data to download"), "warning");
        return;
    }

    // The PDF libraries are bundled with the app. If they are missing the page was
    // served incompletely — say so instead of failing with a generic message.
    if (!window.jspdf || !window.jspdf.jsPDF) {
        console.error("jsPDF not loaded — check js/jspdf.umd.min.js is being served.");
        window.showToast(tr("students.pdfLibMissing",
            "PDF library did not load. Please restart the app and try again."), "error");
        return;
    }

    try {
        const { jsPDF } = window.jspdf;
        const doc = new jsPDF();

        if (typeof doc.autoTable !== "function") {
            console.error("jsPDF AutoTable plugin not loaded — check js/jspdf.plugin.autotable.min.js.");
            window.showToast(tr("students.pdfPluginMissing",
                "PDF table plugin did not load. Please restart the app and try again."), "error");
            return;
        }

        // Everything below stays English on purpose: jsPDF ships Helvetica only
        // and does no Devanagari shaping, so Marathi text would render as boxes.
        doc.setFontSize(18);
        doc.text("Student Attendance Report", 14, 22);

        doc.setFontSize(12);
        doc.setTextColor(100);
        doc.text(`Student Name: ${studentName}`, 14, 32);
        doc.text(`ZK ID: ${studentZkId}`, 14, 40);
        doc.text(`Month: ${month}`, 14, 48);

        const tableColumn = ["Date", "IN Time", "OUT Time", "Status"];
        const tableRows = [];

        for (let i = 0; i < rows.length; i++) {
            const cols = rows[i].getElementsByTagName("td");
            if (cols.length === 4) {
                const date = cols[0].innerText;
                const inTime = cols[1].innerText;
                const outTime = cols[2].innerText;
                // The English status, written by loadStudentMonthlyAttendance,
                // rather than the badge the reader sees.
                const status = cols[3].dataset.statusEn || cols[3].innerText;
                tableRows.push([date, inTime, outTime, status]);
            }
        }

        doc.autoTable({
            head: [tableColumn],
            body: tableRows,
            startY: 55,
            theme: 'striped',
            styles: { fontSize: 10, cellPadding: 3 },
            headStyles: { fillColor: [59, 130, 246] }, // Primary blue color
        });

        // Strip characters Windows rejects in filenames — student names are free text.
        const safeName = String(studentName).replace(/[\\/:*?"<>|]/g, "_").trim() || "Unknown";
        const filename = `Attendance_${safeName}_${month}.pdf`;

        // pywebview blocks browser-initiated downloads (ALLOW_DOWNLOADS defaults to
        // False), so doc.save() silently does nothing inside the desktop window.
        // Route through the native save dialog exposed by JSAPI.save_file, exactly
        // as reports.js and attendance.js already do. doc.save() stays as the
        // fallback for when the UI is opened in a real browser.
        if (window.pywebview && window.pywebview.api && window.pywebview.api.save_file) {
            const dataUri = doc.output('datauristring');
            const base64String = dataUri.substring(dataUri.indexOf(',') + 1);
            window.pywebview.api.save_file(base64String, filename, "PDF Document", "*.pdf")
                .then(res => {
                    if (res.status === "success") {
                        window.showToast(tr("students.pdfSaved", "PDF saved successfully to:") + "\n" + res.path, "success");
                    } else if (res.status === "error") {
                        window.showToast(tr("students.pdfSaveFailed", "Failed to save PDF:") + " " + res.error, "error");
                    }
                })
                .catch(err => {
                    console.error("Save PDF API error:", err);
                    doc.save(filename);
                });
        } else {
            doc.save(filename);
        }
    } catch (e) {
        console.error("PDF generation failed:", e);
        window.showToast(tr("students.pdfFailed", "Failed to generate PDF"), "error");
    }
}

async function loadStudentMonthlyAttendance() {
    const studentId = document.getElementById("modal-student-id").value;
    const month = document.getElementById("modal-month").value;
    const tbodyEl = document.getElementById("modal-attendance-body");

    tbodyEl.innerHTML = `<tr><td colspan='4' style='text-align:center;'>${tr("common.loading", "Loading...")}</td></tr>`;

    if (!month) return;

    try {
        const resp = await window.apiFetch(`/api/attendance?student_id=${studentId}&month=${month}&limit=1000`);
        if (!resp.ok) {
           tbodyEl.innerHTML = `<tr><td colspan='4' style='text-align:center; color: var(--danger);'>${tr("students.loadFailed", "Failed to load attendance.")}</td></tr>`;
           document.getElementById("btn-download-report").style.display = "none";
           return;
        }

        let logs = await resp.json();

        // --- STRICT FRONTEND FILTERING (Fallback) ---
        // This ensures that even if the backend hasn't been safely restarted,
        // the user only sees the exact selected student and the exact month.
        const targetYear = parseInt(month.split('-')[0], 10);
        const targetMonth = parseInt(month.split('-')[1], 10);
        const modalZkId = document.getElementById("modal-student-zk-id").dataset.zkid;

        logs = logs.filter(log => {
            if (log.student_zk_id && String(log.student_zk_id) !== String(modalZkId)) {
                return false;
            }
            const d = new Date(log.punch_time);
            return d.getFullYear() === targetYear && (d.getMonth() + 1) === targetMonth;
        });

        tbodyEl.innerHTML = "";

        if (logs.length === 0) {
            tbodyEl.innerHTML = `<tr><td colspan='4' style='text-align:center; color: var(--text-muted);'>${tr("students.noneThisMonth", "No attendance records found for this month.")}</td></tr>`;
            document.getElementById("btn-download-report").style.display = "none";
            return;
        }

        document.getElementById("btn-download-report").style.display = "block";

        const dailyLogs = {};
        logs.forEach(log => {
            const dateObj = new Date(log.punch_time);
            const dateStr = dateObj.toLocaleDateString();
            if (!dailyLogs[dateStr]) dailyLogs[dateStr] = [];
            dailyLogs[dateStr].push(log);
        });

        const sortedDates = Object.keys(dailyLogs).sort((a,b) => new Date(a) - new Date(b));

        sortedDates.forEach(dateStr => {
            const punches = dailyLogs[dateStr];
            punches.sort((a, b) => new Date(a.punch_time) - new Date(b.punch_time));

            const firstPunch = punches[0];
            const lastPunch = punches.length > 1 ? punches[punches.length - 1] : null;

            const inTime = new Date(firstPunch.punch_time).toLocaleTimeString();
            const outTime = lastPunch ? new Date(lastPunch.punch_time).toLocaleTimeString() : '--';
            const effectiveStatus = lastPunch ? lastPunch.status : firstPunch.status;

            const statusClass = effectiveStatus.toLowerCase().replace(/\s+/g, "-");
            const badgeHtml = `<span class="status-badge status-${escapeHtml(statusClass)}">${escapeHtml(displayStatus(effectiveStatus))}</span>`;

            const tr_ = document.createElement("tr");
            tr_.innerHTML = `
                <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${escapeHtml(dateStr)}</td>
                <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${inTime}</td>
                <td style="padding: 10px; border-bottom: 1px solid var(--border-color);">${outTime}</td>
                <td style="padding: 10px; border-bottom: 1px solid var(--border-color);" data-status-en="${escapeAttr(effectiveStatus)}">${badgeHtml}</td>
            `;
            tbodyEl.appendChild(tr_);
        });

    } catch(e) {
        console.error(e);
        tbodyEl.innerHTML = `<tr><td colspan='4' style='text-align:center; color: var(--danger);'>${tr("students.loadError", "Error loading attendance.")}</td></tr>`;
    }
}

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}

// createTextNode leaves quotes alone, which is safe between tags but not inside
// an attribute value. Class names come from Settings and are free text, so the
// attribute form escapes both quote characters as well.
function escapeAttr(str) {
    return escapeHtml(str).replace(/"/g, "&quot;").replace(/'/g, "&#39;");
}
