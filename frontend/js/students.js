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

function validateParentEmail(email) {
    if (!email || typeof email !== "string") {
        return { valid: false, error: tr("students.emailRequired", "Parent email is required.") };
    }
    const trimmed = email.trim();
    const pattern = /^[a-zA-Z0-9._%+-]+@[a-zA-Z0-9-]+(\.[a-zA-Z0-9-]+)*\.[a-zA-Z]{2,}$/;
    if (!pattern.test(trimmed)) {
        return { valid: false, error: tr("students.emailFormatError", "Invalid email address format. Example: abc@gmail.com") };
    }
    const domain = trimmed.split('@')[1].toLowerCase();
    const typoDomains = ["gamail.com", "gamil.com", "gmai.com", "gmal.com", "gmaill.com", "yaho.com", "yaho.co.in", "hotmial.com", "outlok.com"];
    if (typoDomains.includes(domain)) {
        return { valid: false, error: trf("students.emailTypoDomain", { domain }, `Invalid email domain "${domain}". Please check for typos (e.g. gmail.com).`) };
    }
    return { valid: true, email: trimmed.toLowerCase() };
}

document.addEventListener("DOMContentLoaded", () => {
    loadStudents();
    wireRosterImportExport();

    window.addEventListener("click", (e) => {
        if (e.target === document.getElementById("delete-student-modal")) closeDeleteStudentModal();
        if (e.target === document.getElementById("bulk-delete-modal")) closeBulkDeleteModal();
        if (e.target === document.getElementById("edit-student-modal")) closeEditStudentModal();
        if (e.target === document.getElementById("attendance-modal")) closeAttendanceModal();
    });

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

        const name = (document.getElementById("student_name").value || "").trim();
        const zk_id = (document.getElementById("zk_id").value || "").trim();
        const rawEmail = document.getElementById("parent_email").value || "";
        const standard = document.getElementById("standard").value;

        if (!name) {
            window.showToast(tr("students.nameRequired", "Student name is required."), "error");
            return;
        }

        // Front-end numeric check for ZK ID
        if (!/^\d+$/.test(zk_id)) {
            window.showToast(tr("students.zkNumeric", "ZKTeco ID must be numeric only."), "error");
            return;
        }

        // Email validation
        const emailCheck = validateParentEmail(rawEmail);
        if (!emailCheck.valid) {
            window.showToast(emailCheck.error, "error");
            return;
        }
        const parent_email = emailCheck.email;

        // Front-end duplicate checks
        const existingStudents = window.cachedStudents || [];
        const normName = name.toLowerCase();

        // 1. ZK ID must remain unique across all students
        const duplicateZk = existingStudents.find(s => String(s.zk_id).trim() === zk_id);
        if (duplicateZk) {
            window.showToast(tr("students.zkAlreadyRegistered", "Student with this ZKTeco ID already registered."), "error");
            return;
        }

        // 2. Do not allow two students to have the same Name + same Parent Email combination
        const duplicateNameEmail = existingStudents.find(s =>
            (s.name || "").trim().toLowerCase() === normName &&
            (s.parent_email || "").trim().toLowerCase() === parent_email
        );
        if (duplicateNameEmail) {
            window.showToast(tr("students.duplicateNameEmail", "A student with this Name and Parent Email already exists."), "error");
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
        const name = (document.getElementById("edit_student_name").value || "").trim();
        const zk_id = (document.getElementById("edit_zk_id").value || "").trim();
        const rawEmail = document.getElementById("edit_parent_email").value || "";
        const standard = document.getElementById("edit_standard").value;

        if (!name) {
            window.showToast(tr("students.nameRequired", "Student name is required."), "error");
            return;
        }

        // Front-end numeric check for ZK ID
        if (!/^\d+$/.test(zk_id)) {
            window.showToast(tr("students.zkNumeric", "ZKTeco ID must be numeric only."), "error");
            return;
        }

        // Email validation
        const emailCheck = validateParentEmail(rawEmail);
        if (!emailCheck.valid) {
            window.showToast(emailCheck.error, "error");
            return;
        }
        const parent_email = emailCheck.email;

        // Front-end duplicate checks excluding the student being edited
        const existingStudents = window.cachedStudents || [];
        const normName = name.toLowerCase();

        // 1. ZK ID must remain unique across all students
        const duplicateZk = existingStudents.find(s => s.id != id && String(s.zk_id).trim() === zk_id);
        if (duplicateZk) {
            window.showToast(tr("students.zkAlreadyRegistered", "ZKTeco ID already in use."), "error");
            return;
        }

        // 2. Do not allow two students to have the same Name + same Parent Email combination
        const duplicateNameEmail = existingStudents.find(s =>
            s.id != id &&
            (s.name || "").trim().toLowerCase() === normName &&
            (s.parent_email || "").trim().toLowerCase() === parent_email
        );
        if (duplicateNameEmail) {
            window.showToast(tr("students.duplicateNameEmail", "A student with this Name and Parent Email already exists."), "error");
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

// ── Roster ───────────────────────────────────────────────────────────────────

function getSelectedStandard() {
    const raw = (document.getElementById("filter-standard")?.value || "All").trim();
    const lower = raw.toLowerCase();
    if (!raw || lower === "all" || lower === "all standards" || raw === "सर्व") {
        return "All";
    }
    return raw;
}

function getVisibleStudentCheckboxes() {
    const tbody = document.getElementById("student-table-body");
    if (!tbody) return [];
    const rows = Array.from(tbody.querySelectorAll("tr"));
    const checkboxes = [];
    rows.forEach(r => {
        if (r.id === "no-matching-students-row") return;
        if (r.style.display === "none") return;
        const cb = r.querySelector(".student-select-cb");
        if (cb) checkboxes.push(cb);
    });
    return checkboxes;
}

function updateBulkSelectionUI() {
    const visibleCbs = getVisibleStudentCheckboxes();
    const checkedCount = visibleCbs.filter(cb => cb.checked).length;
    const totalVisible = visibleCbs.length;

    const countLabel = document.getElementById("selected-students-count");
    if (countLabel) {
        countLabel.textContent = `(${checkedCount} selected)`;
    }

    const selectAllCb = document.getElementById("select-all-checkbox");
    const tableSelectAllCb = document.getElementById("table-select-all");
    const isAllChecked = totalVisible > 0 && checkedCount === totalVisible;
    const isIndeterminate = checkedCount > 0 && checkedCount < totalVisible;

    if (selectAllCb) {
        selectAllCb.checked = isAllChecked;
        selectAllCb.indeterminate = isIndeterminate;
    }
    if (tableSelectAllCb) {
        tableSelectAllCb.checked = isAllChecked;
        tableSelectAllCb.indeterminate = isIndeterminate;
    }

    const btnDeleteSelected = document.getElementById("btn-delete-selected");
    if (btnDeleteSelected) {
        btnDeleteSelected.disabled = checkedCount === 0;
        btnDeleteSelected.style.opacity = checkedCount > 0 ? "1" : "0.5";
        btnDeleteSelected.style.cursor = checkedCount > 0 ? "pointer" : "not-allowed";
    }
}

function onStudentCheckboxChange() {
    updateBulkSelectionUI();
}

function toggleSelectAll(checked) {
    const currentStd = getSelectedStandard();
    if (currentStd === "All") {
        window.showToast("Please select a specific standard/class first to use bulk selection.", "warning");
        const selectAllCb = document.getElementById("select-all-checkbox");
        const tableSelectAllCb = document.getElementById("table-select-all");
        if (selectAllCb) selectAllCb.checked = false;
        if (tableSelectAllCb) tableSelectAllCb.checked = false;
        return;
    }

    const visibleCbs = getVisibleStudentCheckboxes();
    visibleCbs.forEach(cb => {
        cb.checked = !!checked;
    });
    updateBulkSelectionUI();
}

function onStandardFilterChange() {
    // When changing standard filter, clear selections to avoid cross-standard accidental delete
    const allCbs = document.querySelectorAll(".student-select-cb");
    allCbs.forEach(cb => cb.checked = false);
    const selectAllCb = document.getElementById("select-all-checkbox");
    const tableSelectAllCb = document.getElementById("table-select-all");
    if (selectAllCb) {
        selectAllCb.checked = false;
        selectAllCb.indeterminate = false;
    }
    if (tableSelectAllCb) {
        tableSelectAllCb.checked = false;
        tableSelectAllCb.indeterminate = false;
    }

    filterStudents();
    updateBulkSelectionUI();
}

window.toggleSelectAll = toggleSelectAll;
window.onStudentCheckboxChange = onStudentCheckboxChange;
window.onStandardFilterChange = onStandardFilterChange;

async function loadStudents() {
    try {
        const resp = await window.apiFetch('/api/students');
        const students = await resp.json();
        window.cachedStudents = students;

        const tbody = document.getElementById("student-table-body");
        tbody.innerHTML = "";

        if (students.length === 0) {
            tbody.innerHTML = `<tr><td colspan='7' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>`;
        } else {
            const attendanceLabel = "Attendance";
            const editLabel = "Edit";
            const deleteLabel = "Delete";

            students.forEach(s => {
                const tr_ = document.createElement("tr");
                tr_.dataset.name = s.name || "";
                tr_.dataset.zkid = String(s.zk_id != null ? s.zk_id : "");
                tr_.setAttribute('data-name', s.name || '');
                tr_.setAttribute('data-zkid', String(s.zk_id != null ? s.zk_id : ''));

                tr_.innerHTML = `
                    <td style="text-align: center;">
                        <input type="checkbox" class="student-select-cb" data-id="${s.id}" data-standard="${escapeAttr(s.standard || '')}" data-name="${escapeAttr(s.name || '')}" style="cursor: pointer; accent-color: var(--primary); width: 16px; height: 16px;">
                    </td>
                    <td>${escapeHtml(String(s.id))}</td>
                    <td>${escapeHtml(s.name)}</td>
                    <td>${escapeHtml(s.standard || '')}</td>
                    <td>${escapeHtml(s.zk_id)}</td>
                    <td>${escapeHtml(s.parent_email)}</td>
                    <td style="display: flex; gap: 5px; align-items: center; white-space: nowrap; flex-wrap: nowrap;">
                        <button class="btn-add btn-attendance-modal" data-id="${s.id}" style="padding: 5px 10px; font-size: 12px; margin: 0;">${escapeHtml(attendanceLabel)}</button>
                        <button class="btn-edit-modal" data-id="${s.id}" style="background-color: var(--warning); border: none; color: white; padding: 5px 10px; border-radius: 4px; cursor: pointer; font-size: 12px; margin: 0;">${escapeHtml(editLabel)}</button>
                        <button class="btn-delete btn-delete-student" data-id="${s.id}" style="padding: 5px 10px; font-size: 12px; margin: 0;">${escapeHtml(deleteLabel)}</button>
                    </td>
                `;

                // Attach event listeners safely
                tr_.querySelector('.student-select-cb').addEventListener('change', onStudentCheckboxChange);
                tr_.querySelector('.btn-attendance-modal').addEventListener('click', () => {
                    openAttendanceModal(s.id, s.name, s.zk_id);
                });
                tr_.querySelector('.btn-edit-modal').addEventListener('click', () => {
                    openEditStudentModal(s.id, s.name, s.zk_id, s.parent_email, s.standard);
                });
                tr_.querySelector('.btn-delete-student').addEventListener('click', () => {
                    openDeleteStudentModal(s);
                });

                tbody.appendChild(tr_);
            });
        }
        // Apply filter in case text is already typed
        filterStudents();
        updateBulkSelectionUI();
    } catch (e) {
        console.error("Error fetching students:", e);
        const tbody = document.getElementById("student-table-body");
        if (tbody) {
            tbody.innerHTML = `<tr><td colspan='7' style='text-align:center; color: var(--danger);'>${tr("students.serverUnreachable", "Could not reach the server.")}</td></tr>`;
        }
    }
}

async function openDeleteStudentModal(student) {
    if (!student) return;
    const modal = document.getElementById("delete-student-modal");
    if (!modal) return;

    document.getElementById("delete_student_id").value = student.id;
    document.getElementById("delete-student-name").textContent = student.name || "-";
    document.getElementById("delete-student-standard").textContent = student.standard || "-";
    document.getElementById("delete-student-zk-id").textContent = student.zk_id != null ? student.zk_id : "-";
    document.getElementById("delete-student-email").textContent = student.parent_email || "-";

    const cb = document.getElementById("delete-confirm-checkbox");
    if (cb) cb.checked = false;

    const btn = document.getElementById("btn-confirm-delete");
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
        btn.textContent = "Delete";
    }

    modal.style.display = "block";
}

function closeDeleteStudentModal() {
    const modal = document.getElementById("delete-student-modal");
    if (modal) modal.style.display = "none";
    const cb = document.getElementById("delete-confirm-checkbox");
    if (cb) cb.checked = false;
    const btn = document.getElementById("btn-confirm-delete");
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
    }
}

function onDeleteCheckboxChange() {
    const cb = document.getElementById("delete-confirm-checkbox");
    const btn = document.getElementById("btn-confirm-delete");
    if (cb && btn) {
        btn.disabled = !cb.checked;
        btn.style.opacity = cb.checked ? "1" : "0.5";
        btn.style.cursor = cb.checked ? "pointer" : "not-allowed";
    }
}

async function executeDeleteStudent() {
    const cb = document.getElementById("delete-confirm-checkbox");
    if (!cb || !cb.checked) return;

    const id = document.getElementById("delete_student_id").value;
    if (!id) return;

    const btn = document.getElementById("btn-confirm-delete");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Deleting...";
    }

    try {
        const resp = await window.apiFetch(`/api/students/${id}`, { method: 'DELETE' });
        if (resp.ok) {
            window.showToast("Student deleted successfully.", "success");
            closeDeleteStudentModal();
            await loadStudents();
            if (typeof loadClassCounts === "function") loadClassCounts();
        } else {
            const data = await resp.json().catch(() => ({}));
            window.showToast("Failed to delete student." +
                (data.detail ? `: ${data.detail}` : ""), "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Error deleting student.", "error");
    } finally {
        if (btn) {
            btn.textContent = "Delete";
            if (cb && !cb.checked) {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
            }
        }
    }
}

function openBulkDeleteModal() {
    const currentStd = getSelectedStandard();
    if (currentStd === "All") {
        window.showToast("Please select a specific standard/class first.", "warning");
        return;
    }

    const visibleCbs = getVisibleStudentCheckboxes();
    const selectedIds = visibleCbs.filter(cb => cb.checked).map(cb => parseInt(cb.dataset.id, 10));

    if (selectedIds.length === 0) {
        window.showToast("Please select at least one student to delete.", "warning");
        return;
    }

    const modal = document.getElementById("bulk-delete-modal");
    if (!modal) return;

    document.getElementById("bulk-delete-count").textContent = selectedIds.length;
    document.getElementById("bulk-delete-standard").textContent = currentStd;

    const cb = document.getElementById("bulk-delete-confirm-checkbox");
    if (cb) cb.checked = false;

    const btn = document.getElementById("btn-confirm-bulk-delete");
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
        btn.textContent = "Delete";
    }

    modal.style.display = "block";
}

function closeBulkDeleteModal() {
    const modal = document.getElementById("bulk-delete-modal");
    if (modal) modal.style.display = "none";
    const cb = document.getElementById("bulk-delete-confirm-checkbox");
    if (cb) cb.checked = false;
    const btn = document.getElementById("btn-confirm-bulk-delete");
    if (btn) {
        btn.disabled = true;
        btn.style.opacity = "0.5";
        btn.style.cursor = "not-allowed";
    }
}

function onBulkDeleteCheckboxChange() {
    const cb = document.getElementById("bulk-delete-confirm-checkbox");
    const btn = document.getElementById("btn-confirm-bulk-delete");
    if (cb && btn) {
        btn.disabled = !cb.checked;
        btn.style.opacity = cb.checked ? "1" : "0.5";
        btn.style.cursor = cb.checked ? "pointer" : "not-allowed";
    }
}

async function executeBulkDelete() {
    const cb = document.getElementById("bulk-delete-confirm-checkbox");
    if (!cb || !cb.checked) return;

    const currentStd = getSelectedStandard();
    const visibleCbs = getVisibleStudentCheckboxes();
    const selectedIds = visibleCbs.filter(cb => cb.checked).map(cb => parseInt(cb.dataset.id, 10));

    if (selectedIds.length === 0) {
        closeBulkDeleteModal();
        return;
    }

    const btn = document.getElementById("btn-confirm-bulk-delete");
    if (btn) {
        btn.disabled = true;
        btn.textContent = "Deleting...";
    }

    try {
        const resp = await window.apiFetch("/api/students/bulk-deactivate", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                student_ids: selectedIds,
                standard: currentStd !== "All" ? currentStd : null
            })
        });

        if (resp.ok) {
            const data = await resp.json().catch(() => ({}));
            window.showToast(data.message || `Deleted ${selectedIds.length} student(s) successfully.`, "success");
            closeBulkDeleteModal();
            await loadStudents();
            if (typeof loadClassCounts === "function") loadClassCounts();
        } else {
            const data = await resp.json().catch(() => ({}));
            window.showToast("Failed to delete students." + (data.detail ? `: ${data.detail}` : ""), "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Error deleting students.", "error");
    } finally {
        if (btn) {
            btn.textContent = "Delete";
            if (cb && !cb.checked) {
                btn.disabled = true;
                btn.style.opacity = "0.5";
                btn.style.cursor = "not-allowed";
            }
        }
    }
}

window.openBulkDeleteModal = openBulkDeleteModal;
window.closeBulkDeleteModal = closeBulkDeleteModal;
window.onBulkDeleteCheckboxChange = onBulkDeleteCheckboxChange;
window.executeBulkDelete = executeBulkDelete;

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
    const nameInput = document.getElementById("search-name");
    const idInput = document.getElementById("search-id");
    const nameTerm = (nameInput ? nameInput.value : "").trim().toLowerCase();
    const zkTerm = (idInput ? idInput.value : "").trim().toLowerCase();
    const rawStandardFilter = (document.getElementById("filter-standard")?.value || "All").trim();
    
    // Check if standard filter means "no filter / all standards"
    const lowerStd = rawStandardFilter.toLowerCase();
    const isAllStandards = !rawStandardFilter || lowerStd === "all" || lowerStd === "all standards" || rawStandardFilter === "सर्व";

    const tbody = document.getElementById("student-table-body");
    if (!tbody) return;
    const rows = tbody.getElementsByTagName("tr");

    // Split search name into words so "Sanika Patil" matches "Sanika Patil", "Sanika  Patil", "Patil Sanika", etc.
    const nameWords = nameTerm.split(/\s+/).filter(Boolean);

    let visibleCount = 0;
    let studentRowsExist = false;
    let noMatchRow = document.getElementById("no-matching-students-row");

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i];
        if (row.id === "no-matching-students-row") continue;
        const tds = row.getElementsByTagName("td");
        if (tds.length < 5) continue;

        studentRowsExist = true;
        const rawName = row.dataset.name !== undefined ? row.dataset.name : (row.getAttribute("data-name") || tds[1].textContent || tds[1].innerText || "");
        const rawZk = row.dataset.zkid !== undefined ? row.dataset.zkid : (row.getAttribute("data-zkid") || tds[3].textContent || tds[3].innerText || "");
        const rawStd = tds[2].textContent || tds[2].innerText || "";

        const nameText = rawName.trim().toLowerCase();
        const zkIdText = rawZk.trim().toLowerCase();
        const standardText = rawStd.trim().toLowerCase();

        // Match name: every typed word must be present in the student's name
        const matchName = nameWords.length === 0 || nameWords.every(word => nameText.includes(word));
        // Match ZK ID
        const matchZk = !zkTerm || zkIdText.includes(zkTerm);
        // Match standard
        const matchStandard = isAllStandards || (standardText === lowerStd);

        if (matchName && matchZk && matchStandard) {
            row.style.display = "";
            visibleCount++;
        } else {
            row.style.display = "none";
        }
    }

    if (studentRowsExist) {
        if (visibleCount === 0) {
            if (!noMatchRow) {
                noMatchRow = document.createElement("tr");
                noMatchRow.id = "no-matching-students-row";
                noMatchRow.innerHTML = `<td colspan="7" style="text-align:center; color: var(--text-muted);">No students match the search criteria.</td>`;
                tbody.appendChild(noMatchRow);
            } else {
                noMatchRow.style.display = "";
            }
        } else if (noMatchRow) {
            noMatchRow.style.display = "none";
        }
    }
    updateBulkSelectionUI();
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
