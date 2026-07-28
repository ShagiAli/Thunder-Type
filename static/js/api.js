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

export async function loadUsers() {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
  return res.json();
}

export async function loadTexts() {
  const res = await fetch("/api/texts");
  if (!res.ok) throw new Error(`Failed to load texts: ${res.status}`);
  return res.json();
}
