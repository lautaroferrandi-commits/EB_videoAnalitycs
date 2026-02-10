const TOKEN_KEY = "va_auth";

function requireAuth() {
  if (localStorage.getItem(TOKEN_KEY) !== "1") {
    window.location.href = "./index.html";
  }
}

function logout() {
  localStorage.removeItem(TOKEN_KEY);
  window.location.href = "./index.html";
}
