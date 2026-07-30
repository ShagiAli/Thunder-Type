// Thin wrapper around the backend JSON API.

async function postJson(url, body) {
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.error || `Request failed: ${res.status}`);
    err.status = res.status;
    throw err;
  }
  return data;
}

/**
 * Signs in as `name`. If the name has never been used, creates a fresh
 * account with `password`. If the name exists, `password` must match —
 * throws an error with `.status === 401` if it doesn't.
 */
export async function authenticate(name, password) {
  return postJson("/api/auth", { player_name: name, password });
}

/**
 * Saves stats for `name`. Requires the correct password — throws with
 * `.status === 401` if it doesn't match.
 */
export async function saveStats(name, password, stats) {
  return postJson("/api/save", { player_name: name, password, ...stats });
}

export async function loadTexts() {
  const res = await fetch("/api/texts");
  if (!res.ok) throw new Error(`Failed to load texts: ${res.status}`);
  return res.json();
}

/** Fetches every user's stats (a leaderboard, sorted by best WPM). Requires the admin password. */
export async function adminListUsers(adminPassword) {
  return postJson("/api/admin/users", { admin_password: adminPassword });
}

/** Permanently deletes a user's account. Requires the admin password. */
export async function adminDeleteUser(adminPassword, playerName) {
  return postJson("/api/admin/delete-user", { admin_password: adminPassword, player_name: playerName });
}

/** Sets a new password for a user without touching their stats. Requires the admin password. */
export async function adminResetPassword(adminPassword, playerName, newPassword) {
  return postJson("/api/admin/reset-password", {
    admin_password: adminPassword,
    player_name: playerName,
    new_password: newPassword,
  });
}
