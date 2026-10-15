/*
 * Parsers for the three free, key-less web services the app talks to. PURE: they take the parsed
 * JSON and return a small normalized object or null. The network calls live in src/main/weather.js.
 *
 *   Open-Meteo geocoding   https://geocoding-api.open-meteo.com/v1/search?name=...
 *   Open-Meteo forecast    https://api.open-meteo.com/v1/forecast?latitude=..&longitude=..&current=temperature_2m,relative_humidity_2m
 *   ipwho.is (opt-in)      https://ipwho.is/?fields=success,city,region,country,latitude,longitude
 * Open-Meteo data is CC-BY 4.0: attribution is shown in Settings > About.
 */

const isNum = (v) => typeof v === 'number' && Number.isFinite(v);

/** -> [{ name, label, latitude, longitude }] (label adds region/country for the picker). */
export function parseGeocoding(json) {
  const results = Array.isArray(json?.results) ? json.results : [];
  return results
    .filter((r) => typeof r?.name === 'string' && isNum(r.latitude) && isNum(r.longitude))
    .map((r) => ({
      name: r.name,
      label: [r.name, r.admin1, r.country].filter((p, i, a) => p && a.indexOf(p) === i).join(', '),
      latitude: r.latitude,
      longitude: r.longitude,
    }));
}

/** -> { tempC, humidityPct } or null if the payload does not carry current conditions. */
export function parseForecast(json) {
  const cur = json?.current;
  if (!isNum(cur?.temperature_2m)) return null;
  return { tempC: cur.temperature_2m, humidityPct: isNum(cur.relative_humidity_2m) ? cur.relative_humidity_2m : null };
}

/** -> { name, label, latitude, longitude } or null. */
export function parseIpLocation(json) {
  if (!json || json.success === false || !isNum(json.latitude) || !isNum(json.longitude)) return null;
  const name = typeof json.city === 'string' && json.city ? json.city : typeof json.region === 'string' ? json.region : null;
  if (!name) return null;
  return {
    name,
    label: [name, json.region, json.country].filter((p, i, a) => p && a.indexOf(p) === i).join(', '),
    latitude: json.latitude,
    longitude: json.longitude,
  };
}

export const WEATHER_MAX_AGE_MS = 60 * 60 * 1000;

/** Is cached weather still fresh enough to skip a refresh? */
export function isWeatherFresh(weather, now) {
  return Boolean(weather && isNum(weather.fetchedAt) && now - weather.fetchedAt < WEATHER_MAX_AGE_MS);
}
