// Deep snapshot of the projects page: waits for render, traverses shadow DOM.
const { chromium } = require('playwright-core');

(async () => {
  const browser = await chromium.connectOverCDP('http://localhost:9222');
  let page;
  for (const ctx of browser.contexts())
    for (const p of ctx.pages())
      if (p.url().includes('/projects')) page = p;
  if (!page) { console.log('NO_PROJECTS_PAGE'); await browser.close(); return; }

  await page.bringToFront().catch(() => {});
  await page.waitForLoadState('networkidle', { timeout: 30000 }).catch(() => {});
  await page.waitForTimeout(2000);

  const data = await page.evaluate(() => {
    // Deep text + interactive elements, descending into shadow roots.
    const texts = [];
    const interactive = [];
    const seen = new Set();
    function walk(root) {
      const els = root.querySelectorAll('*');
      for (const el of els) {
        if (el.shadowRoot) walk(el.shadowRoot);
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute && el.getAttribute('role');
        const isInteractive =
          ['button', 'a', 'input', 'select', 'textarea'].includes(tag) ||
          ['button', 'menuitem', 'tab', 'link', 'option', 'checkbox'].includes(role) ||
          (el.getAttribute && el.getAttribute('onclick')) ||
          el.classList.contains('clickable');
        if (isInteractive) {
          const label = (el.innerText || el.value || el.getAttribute('aria-label') || el.getAttribute('title') || '').trim().slice(0, 80);
          const key = tag + '|' + (role || '') + '|' + label;
          if (!seen.has(key)) { seen.add(key); interactive.push({ tag, role: role || '', label }); }
        }
      }
    }
    walk(document);
    const bodyText = document.body ? document.body.innerText.trim() : '';
    return {
      url: location.href,
      title: document.title,
      bodyTextLen: bodyText.length,
      bodyText: bodyText.slice(0, 3000),
      interactiveCount: interactive.length,
      interactive: interactive.slice(0, 80),
    };
  });
  console.log(JSON.stringify(data, null, 2));
  await browser.close();
})().catch((e) => { console.error('ERR', e.message); process.exit(1); });
