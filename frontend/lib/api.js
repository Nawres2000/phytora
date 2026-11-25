export const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:5000/api';

export async function api(path, { json, ...opts } = {}) {
  const res = await fetch(API + path, {
    credentials: 'include',
    ...opts,
    headers: json ? { 'Content-Type': 'application/json' } : undefined,
    body: json ? JSON.stringify(json) : opts.body,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw Object.assign(new Error(data.error || 'Une erreur est survenue. Réessayez.'), { data });
  return data;
}
