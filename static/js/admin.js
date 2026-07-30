import { adminDeleteUser, adminListUsers, adminResetPassword } from "./api.js";

const els = {
  loginCard: document.getElementById("adminLoginCard"),
  loginForm: document.getElementById("adminLoginForm"),
  passwordInput: document.getElementById("adminPasswordInput"),
  adminError: document.getElementById("adminError"),
  tableCard: document.getElementById("adminTableCard"),
  tableBody: document.getElementById("adminTableBody"),
  search: document.getElementById("adminSearch"),
  empty: document.getElementById("adminEmpty"),
  status: document.getElementById("adminStatus"),
  btnRefresh: document.getElementById("btnRefresh"),
  btnLogout: document.getElementById("btnLogout"),
};

let adminPassword = ""; // kept in memory only — re-login required on refresh, intentionally stricter than the game's sign-in
let allUsers = [];

function bindEvents() {
  els.loginForm.addEventListener("submit", onLogin);
  els.btnRefresh.addEventListener("click", () => loadUsers());
  els.btnLogout.addEventListener("click", logout);
  els.search.addEventListener("input", renderTable);
}

const BOOTSTRAP_KEY = "thunderType.adminBootstrap";

async function onLogin(event) {
  event.preventDefault();
  const password = els.passwordInput.value;
  if (!password) return;

  const submitBtn = els.loginForm.querySelector("button[type=submit]");
  submitBtn.disabled = true;
  submitBtn.textContent = "Checking...";
  els.adminError.hidden = true;

  const ok = await enterAdmin(password);

  submitBtn.disabled = false;
  submitBtn.textContent = "Log in";
  if (ok) els.passwordInput.value = "";
}

/** Returns true on success. Shows the login error banner and returns false on failure. */
async function enterAdmin(password) {
  try {
    // There's no separate "check password" endpoint — a successful
    // /api/admin/users call IS the auth check.
    allUsers = await adminListUsers(password);
    adminPassword = password;
    els.loginCard.hidden = true;
    els.tableCard.hidden = false;
    els.btnRefresh.hidden = false;
    els.btnLogout.hidden = false;
    renderTable();
    return true;
  } catch (err) {
    if (err.status === 503) {
      els.adminError.textContent = "Admin access isn't set up on this server yet (ADMIN_PASSWORD isn't configured).";
    } else if (err.status === 401) {
      els.adminError.textContent = "Incorrect admin password.";
    } else {
      els.adminError.textContent = `Couldn't reach the server: ${err.message}`;
    }
    els.adminError.hidden = false;
    return false;
  }
}

/** Consumes the one-time handoff from the main sign-in page's Admin option, if present. */
async function tryBootstrapLogin() {
  let bootstrapPassword;
  try {
    bootstrapPassword = sessionStorage.getItem(BOOTSTRAP_KEY);
    sessionStorage.removeItem(BOOTSTRAP_KEY); // one-time use, regardless of outcome
  } catch (err) {
    return; // storage blocked — just show the normal login form
  }
  if (bootstrapPassword) {
    await enterAdmin(bootstrapPassword);
  }
}

function logout() {
  adminPassword = "";
  allUsers = [];
  els.loginCard.hidden = false;
  els.tableCard.hidden = true;
  els.btnRefresh.hidden = true;
  els.btnLogout.hidden = true;
  els.status.textContent = "";
}

async function loadUsers() {
  try {
    allUsers = await adminListUsers(adminPassword);
    renderTable();
    els.status.textContent = `Refreshed at ${new Date().toLocaleTimeString()}.`;
  } catch (err) {
    if (err.status === 401) {
      // Password was valid a moment ago but isn't now (e.g. ADMIN_PASSWORD
      // changed on the server) — send back to the login screen cleanly.
      els.status.textContent = "Your admin session is no longer valid. Please log in again.";
      logout();
    } else {
      els.status.textContent = `Couldn't refresh: ${err.message}`;
    }
  }
}

function renderTable() {
  const filter = els.search.value.trim().toLowerCase();
  const rows = filter
    ? allUsers.filter((u) => u.player_name.toLowerCase().includes(filter))
    : allUsers;

  els.empty.hidden = rows.length > 0;
  els.tableBody.replaceChildren();

  rows.forEach((user) => {
    const rank = allUsers.indexOf(user) + 1; // rank reflects true leaderboard position, not filtered index
    const tr = document.createElement("tr");

    const rankCell = document.createElement("td");
    rankCell.className = "rank" + (rank <= 3 ? " top" : "");
    rankCell.textContent = `#${rank}`;
    tr.appendChild(rankCell);

    const nameCell = document.createElement("td");
    nameCell.className = "name-cell";
    nameCell.textContent = user.player_name;
    tr.appendChild(nameCell);

    tr.appendChild(cell(`${user.best_wpm.toFixed(1)}`));
    tr.appendChild(cell(`${user.best_accuracy.toFixed(1)}%`));
    tr.appendChild(cell(`${user.max_combo}`));
    tr.appendChild(cell(`${user.rounds_finished}`));
    tr.appendChild(cell(`${user.current_level} / 10`));

    const actionsCell = document.createElement("td");
    actionsCell.className = "actions-cell";

    const resetBtn = document.createElement("button");
    resetBtn.className = "btn-ghost";
    resetBtn.type = "button";
    resetBtn.textContent = "Reset password";
    resetBtn.addEventListener("click", () => onResetPassword(user.player_name));
    actionsCell.appendChild(resetBtn);

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-danger";
    deleteBtn.type = "button";
    deleteBtn.textContent = "Delete";
    deleteBtn.addEventListener("click", () => onDeleteUser(user.player_name));
    actionsCell.appendChild(deleteBtn);

    tr.appendChild(actionsCell);
    els.tableBody.appendChild(tr);
  });
}

function cell(text) {
  const td = document.createElement("td");
  td.textContent = text;
  return td;
}

async function onDeleteUser(name) {
  const confirmed = window.confirm(`Permanently delete "${name}"'s account and all their stats? This can't be undone.`);
  if (!confirmed) return;

  try {
    await adminDeleteUser(adminPassword, name);
    els.status.textContent = `Deleted "${name}".`;
    await loadUsers();
  } catch (err) {
    els.status.textContent = `Couldn't delete "${name}": ${err.message}`;
  }
}

async function onResetPassword(name) {
  const newPassword = window.prompt(`New password for "${name}":`);
  if (!newPassword) return; // cancelled or left blank

  try {
    await adminResetPassword(adminPassword, name, newPassword);
    els.status.textContent = `Password reset for "${name}". Let them know their new password.`;
  } catch (err) {
    els.status.textContent = `Couldn't reset password for "${name}": ${err.message}`;
  }
}

bindEvents();
tryBootstrapLogin();
