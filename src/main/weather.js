/*
 * Network side of weather: Open-Meteo geocoding + current conditions, and an opt-in IP lookup.
 * Parsing lives in src/core/weather.js (pure, tested). Every call has a timeout and returns
 * { ok: true, ... } or { ok: false, error } so the UI can fall back to a manual climate choice.
 */
import { net } from 'electron';
import { parseGeocoding, parseForecast, parseIpLocation } from '../core/weather.js';

const TIMEOUT_MS = 8000;

// Electron's net.fetch uses Chromium's network stack: dual-stack (IPv4/IPv6) fallback, system proxy
// settings and the OS certificate store all work, which plain Node fetch does not guarantee.
async function getJson(url) {
  const res = await net.fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS), headers: { accept: 'application/json' } });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  return res.json();
}

const fail = (err) => ({ ok: false, error: err?.name === 'TimeoutError' ? 'timeout' : 'network', detail: String(err?.message ?? err) });

export async function searchCities(query) {
  const q = String(query ?? '').trim();
  if (q.length < 2) return { ok: true, results: [] };
  try {
    const url = `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(q)}&count=6&language=en&format=json`;
    return { ok: true, results: parseGeocoding(await getJson(url)) };
  } catch (err) {
    return fail(err);
  }
}

export async function fetchCurrent(latitude, longitude) {
  if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return { ok: false, error: 'bad-input' };
  try {
    const url = `https://api.open-meteo.com/v1/forecast?latitude=${latitude}&longitude=${longitude}&current=temperature_2m,relative_humidity_2m&timezone=auto`;
    const weather = parseForecast(await getJson(url));
    return weather ? { ok: true, weather: { ...weather, fetchedAt: Date.now() } } : { ok: false, error: 'bad-response' };
  } catch (err) {
    return fail(err);
  }
}

/** Opt-in: one request to ipwho.is, which sees the user's IP address (disclosed in the UI). */
export async function approximateLocation() {
  try {
    const loc = parseIpLocation(await getJson('https://ipwho.is/?fields=success,city,region,country,latitude,longitude'));
    return loc ? { ok: true, location: loc } : { ok: false, error: 'bad-response' };
  } catch (err) {
    return fail(err);
  }
}
