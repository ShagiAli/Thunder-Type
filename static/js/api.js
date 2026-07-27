// Thin wrapper around the backend JSON API.

export async function loadProfile(name) {
  const res = await fetch(`/api/profile?name=${encodeURIComponent(name)}`);
  if (!res.ok) throw new Error(`Failed to load profile: ${res.status}`);
  return res.json();
}

export async function loadUsers() {
  const res = await fetch("/api/users");
  if (!res.ok) throw new Error(`Failed to load users: ${res.status}`);
  return res.json();
}

export async function saveProfile(profile) {
  const res = await fetch("/api/profile", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(profile),
  });
  if (!res.ok) throw new Error(`Failed to save profile: ${res.status}`);
  return res.json();
}

export async function loadTexts() {
  const res = await fetch("/api/texts");
  if (!res.ok) throw new Error(`Failed to load texts: ${res.status}`);
  return res.json();
}
