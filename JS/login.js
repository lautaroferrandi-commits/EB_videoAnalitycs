const USER_OK = "EB_team";
const PASS_OK = "12345";
const TOKEN_KEY = "va_auth";

const form = document.getElementById("loginForm");
const user = document.getElementById("user");
const pass = document.getElementById("pass");
const btn = document.getElementById("loginBtn");
const msg = document.getElementById("msg");

// Si ya está logueado, ir directo al dashboard
if (localStorage.getItem(TOKEN_KEY) === "1") {
  window.location.href = "./dashboard.html";
}

form.addEventListener("submit", (e) => {
  e.preventDefault();
  msg.className = "msg";
  msg.textContent = "";

  btn.disabled = true;
  btn.textContent = "Checking…";

  const u = (user.value || "").trim();
  const p = pass.value;

  if (u === USER_OK && p === PASS_OK) {
    localStorage.setItem(TOKEN_KEY, "1");
    msg.className = "msg ok";
    msg.textContent = "✅ Login correcto. Redirigiendo…";
    setTimeout(() => (window.location.href = "./dashboard.html"), 350);
    return;
  }

  msg.className = "msg error";
  msg.textContent = "❌ Credenciales incorrectas.";
  btn.disabled = false;
  btn.textContent = "Login";
});
