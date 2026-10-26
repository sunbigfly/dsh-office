/* The update page (index.html): a file of its own, not inline in the page (the pages' Content-Security-Policy).
   The Update and Check for updates buttons open it with ?from_version=…&current_platform=…, the platform as in
   updater/current.json (windows, macos, linux, web), or macos_store (the Mac App Store edition, which never reads
   that file: VO.updateUrl): the page then shows only what its data-for names for that one. Without a platform it
   stays as written: every system ("all"). */
const platform = new URLSearchParams(location.search).get('current_platform');
if (['windows', 'macos', 'macos_store', 'linux', 'web'].includes(platform)) {
  for (const el of document.querySelectorAll('[data-for]')) el.hidden = !el.dataset.for.split(' ').includes(platform);
}
