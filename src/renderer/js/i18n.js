/*
 * Minimal i18n runtime. Strings come from the locale extensions (extensions/locales/<code>.json),
 * flat key -> string with {name} placeholders. A missing key falls back to English, then to the key.
 * Plurals: `key.one` / `key.other` (English only distinguishes "one"; Korean uses `.other` always).
 */
let strings = {};
let fallback = {};
let lang = 'en';

export function setLocale(code, locales) {
  lang = locales[code] ? code : 'en';
  strings = locales[lang]?.strings ?? {};
  fallback = locales.en?.strings ?? {};
  document.documentElement.lang = lang;
}

export const language = () => lang;

export function t(key, vars) {
  const template = strings[key] ?? fallback[key] ?? key;
  return vars ? template.replace(/\{(\w+)\}/g, (match, name) => (name in vars ? String(vars[name]) : match)) : template;
}

/** Plural-aware lookup: tn('hydration.cups', 3) -> "3 cups". */
export function tn(key, n, vars) {
  const form = lang === 'en' && n === 1 ? `${key}.one` : `${key}.other`;
  const exists = form in strings || form in fallback;
  return t(exists ? form : key, { n, ...vars });
}

export function formatClock(ms) {
  return new Intl.DateTimeFormat(lang, { hour: 'numeric', minute: '2-digit' }).format(ms);
}

export function formatNumber(n, digits = 0) {
  return new Intl.NumberFormat(lang, { maximumFractionDigits: digits, minimumFractionDigits: digits }).format(n);
}
