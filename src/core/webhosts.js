/*
 * Navigation allow-listing for the sandboxed web music views (YouTube, Spotify, Melon).
 * PURE. A view may only navigate to https hosts its manifest lists in `navAllow`; anything else is
 * handed to the user's real browser instead. Patterns: "example.com" (exactly that host) or
 * "*.example.com" (any subdomain of it, not the bare domain; list both when you need both).
 */

/** Does `hostname` match one allow-list pattern? */
export function hostMatches(hostname, pattern) {
  const host = String(hostname).toLowerCase().replace(/\.$/, '');
  const p = String(pattern).toLowerCase();
  if (p.startsWith('*.')) {
    const base = p.slice(2);
    return host.endsWith(`.${base}`) && host.length > base.length + 1;
  }
  return host === p;
}

/**
 * May a web view navigate to `url`? https only, no embedded credentials, and the host must match.
 * (`new URL` resolves the real host, so tricks like https://youtube.com@evil.com/ are judged by evil.com.)
 */
export function isNavigationAllowed(url, navAllow) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return false;
  }
  if (parsed.protocol !== 'https:') return false;
  if (parsed.username || parsed.password) return false;
  return navAllow.some((pattern) => hostMatches(parsed.hostname, pattern));
}

/** Is it safe to hand this URL to the system browser? https only. */
export function isExternalOpenAllowed(url) {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && !parsed.username && !parsed.password;
  } catch {
    return false;
  }
}
