document.addEventListener("DOMContentLoaded", () => {
    loadStudents();

    document.getElementById("addStudentForm").addEventListener("submit", async (e) => {
        e.preventDefault();

        const name = document.getElementById("student_name").value;
        const zk_id = document.getElementById("zk_id").value;
        const parent_email = document.getElementById("parent_email").value;

        try {
            const resp = await fetch('/api/students', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ name, zk_id, parent_email })
            });

            if (resp.ok) {
                window.showToast("Student added successfully!", "success");
                document.getElementById("addStudentForm").reset();
                loadStudents();
            } else {
                const data = await resp.json();
                window.showToast("Failed: " + (data.detail || "Unknown error"), "error");
            }
        } catch (err) {
            console.error(err);
            window.showToast("Network error while adding student.", "error");
        }
    });
});

async function loadStudents() {
    try {
        const resp = await fetch('/api/students');
        const students = await resp.json();

        const tbody = document.getElementById("student-table-body");
        tbody.innerHTML = "";

        if (students.length === 0) {
            tbody.innerHTML = "<tr><td colspan='5' style='text-align:center; color: var(--text-muted);'>No students enrolled.</td></tr>";
        } else {
            students.forEach(s => {
                const tr = document.createElement("tr");
                tr.innerHTML = `
                    <td>${escapeHtml(String(s.id))}</td>
                    <td>${escapeHtml(s.name)}</td>
                    <td>${escapeHtml(s.zk_id)}</td>
                    <td>${escapeHtml(s.parent_email)}</td>
                    <td><button onclick="deleteStudent(${s.id})" class="btn-delete">Delete</button></td>
                `;
                tbody.appendChild(tr);
            });
        }
    } catch (e) {
        console.error("Error fetching students:", e);
    }
}

async function deleteStudent(id) {
    if (!confirm("Are you sure you want to delete this student?")) return;
    try {
        const resp = await fetch(`/api/students/${id}`, { method: 'DELETE' });
        if (resp.ok) {
            window.showToast("Student deleted successfully.", "success");
            loadStudents();
        } else {
            window.showToast("Failed to delete student.", "error");
        }
    } catch (e) {
        console.error(e);
        window.showToast("Error deleting student.", "error");
    }
}

// HTML escaping utility to prevent XSS
function escapeHtml(str) {
    if (!str) return '';
    const div = document.createElement('div');
    div.appendChild(document.createTextNode(str));
    return div.innerHTML;
}
