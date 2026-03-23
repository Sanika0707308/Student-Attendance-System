function login(event) {
    if (event) event.preventDefault();

    const u = document.getElementById("username").value;
    const p = document.getElementById("password").value;
    const error = document.getElementById("error");

    if (u === "admin" && p === "admin") {
        // Set session flag so other pages can check auth
        sessionStorage.setItem("authenticated", "true");
        window.location.href = "dashboard.html";
    } else {
        error.innerText = "Invalid username or password";
    }
}
