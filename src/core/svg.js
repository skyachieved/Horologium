/*
 * Safety check for SVG artwork that gets injected inline into the widget.
 * PURE string inspection; it does not parse XML. It is intentionally conservative: anything that
 * could run code or fetch remote content is rejected rather than "cleaned".
 *
 * Bundled characters are reviewed in PRs, but the same check runs on every character at load time
 * so a careless contribution (or, later, a user-installed character) cannot execute script.
 */

/** Returns a list of human-readable problems. Empty = safe to inline. */
export function checkSvgSafety(text) {
  const problems = [];
  if (typeof text !== 'string' || text.trim() === '') return ['file is empty'];

  const body = text.replace(/<!--[\s\S]*?-->/g, '').replace(/<\?xml[\s\S]*?\?>/i, '').replace(/<!DOCTYPE[\s\S]*?>/i, '').trimStart();
  if (!/^<svg[\s>]/i.test(body)) problems.push('must start with an <svg> element');
  if (!/<svg[^>]*\sviewBox\s*=/i.test(body)) problems.push('root <svg> needs a viewBox so it can scale');

  if (/<script[\s>]/i.test(body)) problems.push('<script> is not allowed');
  if (/<foreignObject[\s>]/i.test(body)) problems.push('<foreignObject> is not allowed');
  if (/<iframe[\s>]|<embed[\s>]|<object[\s>]/i.test(body)) problems.push('embedded content is not allowed');
  if (/\son[a-z]+\s*=/i.test(body)) problems.push('event-handler attributes (onclick, onload, ...) are not allowed');
  if (/javascript\s*:/i.test(body)) problems.push('javascript: URLs are not allowed');
  if (/(?:xlink:)?href\s*=\s*["']\s*(?:https?:|\/\/|data:text\/html)/i.test(body)) problems.push('external or HTML data URLs are not allowed');
  if (/url\(\s*["']?\s*(?:https?:|\/\/)/i.test(body)) problems.push('external url(...) references are not allowed');
  if (/@import/i.test(body)) problems.push('@import is not allowed');
  return problems;
}
