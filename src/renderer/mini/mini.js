/* The mini player's control strip. Labels arrive as query parameters (the main process knows the language). */
const params = new URLSearchParams(location.search);
const $ = (id) => document.getElementById(id);

$('expand').title = params.get('expand') ?? 'Expand';
$('expand').setAttribute('aria-label', $('expand').title);
$('close').title = params.get('close') ?? 'Close';
$('close').setAttribute('aria-label', $('close').title);
$('expand').addEventListener('click', () => window.miniBridge.expand());
$('close').addEventListener('click', () => window.miniBridge.close());
window.miniBridge.onTitle((title) => { $('title').textContent = title; });
