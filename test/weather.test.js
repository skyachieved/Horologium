import { test } from 'node:test';
import assert from 'node:assert/strict';
import { parseGeocoding, parseForecast, parseIpLocation, isWeatherFresh, WEATHER_MAX_AGE_MS } from '../src/core/weather.js';
import { climateAddOnMl } from '../src/core/hydration.js';

// Trimmed copies of real responses (fetched 2026-10-15).
const GEOCODING = {
  results: [
    { id: 1835848, name: 'Seoul', latitude: 37.566, longitude: 126.9784, country: 'South Korea', admin1: 'Seoul', country_code: 'KR' },
    { id: 6730280, name: 'Séouléo', latitude: 10.85006, longitude: 14.10217, country: 'Cameroon', admin1: 'Far North' },
    { id: 1, name: 'Broken', latitude: 'north', longitude: 3 },
  ],
};
const FORECAST = { current: { time: '2026-10-15T15:30', interval: 900, temperature_2m: 19.4, relative_humidity_2m: 64 } };
const IP = { success: true, country: 'South Korea', region: 'Seoul', city: 'Seoul', latitude: 37.5661369, longitude: 126.9783785 };

test('geocoding results are normalized, de-duplicated in the label, and bad rows dropped', () => {
  const r = parseGeocoding(GEOCODING);
  assert.equal(r.length, 2);
  assert.deepEqual(r[0], { name: 'Seoul', label: 'Seoul, South Korea', latitude: 37.566, longitude: 126.9784 });
  assert.equal(r[1].label, 'Séouléo, Far North, Cameroon');
});

test('geocoding tolerates empty or malformed payloads', () => {
  for (const bad of [null, undefined, {}, { results: 'x' }, { results: [] }]) assert.deepEqual(parseGeocoding(bad), []);
});

test('forecast gives temperature and humidity that feed the climate band', () => {
  const w = parseForecast(FORECAST);
  assert.deepEqual(w, { tempC: 19.4, humidityPct: 64 });
  assert.equal(climateAddOnMl(w), 0);
  assert.equal(climateAddOnMl(parseForecast({ current: { temperature_2m: 33, relative_humidity_2m: 50 } })), 500);
});

test('forecast without a temperature is rejected; missing humidity is allowed', () => {
  assert.equal(parseForecast({ current: { relative_humidity_2m: 50 } }), null);
  assert.equal(parseForecast(null), null);
  assert.deepEqual(parseForecast({ current: { temperature_2m: 20 } }), { tempC: 20, humidityPct: null });
});

test('IP location is opt-in data that must contain coordinates and a place name', () => {
  assert.deepEqual(parseIpLocation(IP), { name: 'Seoul', label: 'Seoul, South Korea', latitude: 37.5661369, longitude: 126.9783785 });
  assert.equal(parseIpLocation({ success: false }), null);
  assert.equal(parseIpLocation({ success: true, latitude: 1, longitude: 2 }), null);
  assert.equal(parseIpLocation({ success: true, latitude: 1, longitude: 2, region: 'Gyeonggi' }).name, 'Gyeonggi');
});

test('weather freshness uses a one hour window', () => {
  const now = 10 * WEATHER_MAX_AGE_MS;
  assert.equal(isWeatherFresh({ fetchedAt: now - 1000 }, now), true);
  assert.equal(isWeatherFresh({ fetchedAt: now - WEATHER_MAX_AGE_MS }, now), false);
  assert.equal(isWeatherFresh(null, now), false);
});
