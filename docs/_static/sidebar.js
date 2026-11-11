/* Sidebar: make "Contributing" collapsible. Its many sections start folded
   away (open on the Contributing page itself); a small toggle shows them. */
document.addEventListener('DOMContentLoaded', () => {
  for (const li of document.querySelectorAll('.sphinxsidebar li.toctree-l1')) {
    const link = li.querySelector(':scope > a');
    const sub = li.querySelector(':scope > ul');
    if (!link || !sub || link.textContent.trim() !== 'Contributing') continue;

    const open = li.classList.contains('current');
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'toc-toggle';
    toggle.setAttribute('aria-label', 'Show or hide the Contributing sections');
    toggle.setAttribute('aria-expanded', String(open));
    toggle.textContent = '▸';
    sub.hidden = !open;
    toggle.addEventListener('click', () => {
      sub.hidden = !sub.hidden;
      toggle.setAttribute('aria-expanded', String(!sub.hidden));
    });
    link.after(toggle);
  }
});
