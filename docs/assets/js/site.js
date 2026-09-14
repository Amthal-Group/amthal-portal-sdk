/* =========================================================================
   Amthal Portal SDK — documentation site behaviour.

   Everything here is progressive enhancement. The pages are complete,
   readable and navigable with this file absent, blocked or broken, so every
   feature is installed inside its own try/catch: one failing must never take
   the others down with it.

   Names shared with assets/css/site.css and the page shell (_tools/build.py).
   Both sides depend on them, so neither renames one alone:

     .nav-toggle[aria-expanded]     drawer trigger               (shell)
     .sidebar[data-sidebar]         the drawer                   (shell)
       .is-open                     drawer is open               (set here)
     [data-sidebar-backdrop]        scrim behind the drawer      (injected)
     html.is-nav-open               page behind is scroll-locked (set here)
     [data-toc] a, .sidebar__sections a
       .is-active                   the section being read       (set here)
     pre.code                       code block                   (shell)
       .has-copy, .copy-btn         copy affordance              (injected)
     h2[id] / h3[id] > .heading-anchor                           (injected)
     [data-search-open]             search trigger               (shell)
     .search-dialog, .search-dialog__panel, .search-result, mark (injected)
     .platform-tabs                 anchor row upgraded to tabs  (shell)
       .platform-panel              generated tab panel          (injected)

   No build step and no dependencies. The only network request is a lazy,
   same-origin fetch of assets/search-index.json on first search. Every path
   stays relative: the site is served under a path prefix.
   ========================================================================= */

(() => {
  'use strict';

  const root = document.documentElement;

  /* Lets the stylesheet hide JS-only affordances — the search trigger is a dead
     control without this file — via html:not(.js). Set before anything can throw. */
  root.classList.add('js');

  // ---------------------------------------------------------------- helpers

  const $ = (selector, context = document) => context.querySelector(selector);
  const $$ = (selector, context = document) => [...context.querySelectorAll(selector)];

  const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), ' +
                    'select:not([disabled]), textarea:not([disabled]), ' +
                    '[tabindex]:not([tabindex="-1"])';

  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const scrollBehavior = () => (reduceMotion.matches ? 'auto' : 'smooth');

  /** No box at all: display:none, or sitting inside a hidden tab panel. */
  const isVisible = (el) => !!el?.getClientRects().length;

  const focusablesIn = (el) => $$(FOCUSABLE, el).filter(isVisible);

  /** Keeps Tab inside `ring`, an array of elements in tab order. */
  const trapTab = (event, ring) => {
    if (event.key !== 'Tab' || !ring.length) return;
    const at = ring.indexOf(document.activeElement);
    const first = ring[0];
    const last = ring[ring.length - 1];

    if (at === -1) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && at === 0) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && at === ring.length - 1) {
      event.preventDefault();
      first.focus();
    }
  };

  const isTypingTarget = (el) =>
    !!el && (el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' ||
             el.tagName === 'SELECT' || el.isContentEditable === true);

  /* localStorage throws outright in private mode and under some enterprise
     policies — a remembered preference must never break a page. */
  const store = {
    get(key) { try { return localStorage.getItem(key); } catch { return null; } },
    set(key, value) { try { localStorage.setItem(key, value); } catch { /* not available */ } }
  };

  /* Shared by the drawer and the search dialog: either may be open and the page
     behind must not scroll. Counted, so closing one does not unlock the page
     while the other is still up. */
  const scrollLock = (() => {
    let depth = 0;
    let htmlOverflow = '';
    let bodyOverflow = '';
    return {
      on() {
        if (depth++ > 0) return;
        htmlOverflow = root.style.overflow;
        bodyOverflow = document.body.style.overflow;
        root.style.overflow = 'hidden';
        document.body.style.overflow = 'hidden';
      },
      off() {
        if (depth === 0 || --depth > 0) return;
        root.style.overflow = htmlOverflow;
        document.body.style.overflow = bodyOverflow;
      }
    };
  })();

  /** One polite live region, shared by the copy buttons and the search results. */
  const announce = (() => {
    let region = null;
    return (message) => {
      if (!region) {
        region = document.createElement('p');
        region.className = 'visually-hidden';
        region.setAttribute('role', 'status');
        region.setAttribute('aria-live', 'polite');
        document.body.appendChild(region);
      }
      // Cleared first, so repeating the same message is still announced.
      region.textContent = '';
      setTimeout(() => { region.textContent = message; }, 40);
    };
  })();

  /** Scrolls `el` into view inside its own scrolling ancestor — never the page. */
  const scrollWithinRail = (el) => {
    let box = el.parentElement;
    while (box && box !== document.body) {
      const overflowY = getComputedStyle(box).overflowY;
      if ((overflowY === 'auto' || overflowY === 'scroll') &&
          box.scrollHeight > box.clientHeight + 1) break;
      box = box.parentElement;
    }
    if (!box || box === document.body) return;

    const boxRect = box.getBoundingClientRect();
    const rect = el.getBoundingClientRect();
    const pad = 24;
    let delta = 0;
    if (rect.top < boxRect.top + pad) delta = rect.top - boxRect.top - pad;
    else if (rect.bottom > boxRect.bottom - pad) delta = rect.bottom - boxRect.bottom + pad;
    if (!delta) return;

    // scrollTop on the rail itself: scrollIntoView would drag the page with it.
    box.scrollTo?.({ top: box.scrollTop + delta, behavior: scrollBehavior() }) ??
      (box.scrollTop += delta);
  };

  /** True when `href`'s path is this very page, so its #fragment is local. */
  const isSamePage = (href) => {
    try {
      const url = new URL(href, location.href);
      return url.origin === location.origin && url.pathname === location.pathname;
    } catch { return false; }
  };

  const hashId = (href) => {
    const at = (href ?? '').indexOf('#');
    if (at < 0) return '';
    const raw = href.slice(at + 1);
    try { return decodeURIComponent(raw); } catch { return raw; }
  };

  /** Boxes moved (a tab switched), so anything measuring them must re-measure. */
  const layoutChanged = () => document.dispatchEvent(new CustomEvent('docs:layoutchange'));

  const feature = (name, install) => {
    try { install(); }
    catch (error) { console?.warn?.(`[docs] ${name} disabled:`, error); }
  };

  // ------------------------------------------------- fallback presentation

  /* Structural styling for the elements this file injects, so they are usable
     even if the stylesheet knows them by другой name. Every rule is wrapped in
     :where() — zero specificity — so any authored rule in site.css wins
     outright, and every colour comes from the site's own design tokens. */
  const installFallbackStyles = () => {
    const style = document.createElement('style');
    style.setAttribute('data-site-js-fallback', '');
    style.textContent = `
:where([data-sidebar-backdrop]){position:fixed;inset:0;z-index:40;
  background:color-mix(in srgb,var(--navy,#121e4c) 62%,transparent);}

:where(pre.code.has-copy){position:relative;}
/* currentColor keeps the button legible on the code block's dark navy surface
   without naming a colour that is not a design token. */
:where(.copy-btn){position:absolute;top:.5rem;inset-inline-end:.5rem;z-index:2;
  font:inherit;font-size:.75rem;font-weight:600;line-height:1;letter-spacing:.02em;
  padding:.4rem .6rem;border-radius:8px;cursor:pointer;color:currentColor;
  border:1px solid color-mix(in srgb,currentColor 40%,transparent);
  background:color-mix(in srgb,currentColor 14%,transparent);opacity:.72;}
:where(.copy-btn:hover),:where(.copy-btn:focus-visible),:where(.copy-btn.is-copied){opacity:1;}

:where(.heading-anchor){margin-inline-start:.35em;font-weight:400;text-decoration:none;
  color:var(--accent-text,#00598a);opacity:.35;}
:where(h2:hover) :where(.heading-anchor),:where(h3:hover) :where(.heading-anchor),
:where(.heading-anchor:hover),:where(.heading-anchor:focus-visible){opacity:1;}

:where(.platform-panel[hidden]){display:none;}

:where(.search-dialog){position:fixed;inset:0;z-index:60;display:flex;
  align-items:flex-start;justify-content:center;padding:8vh 1rem 1rem;}
:where(.search-dialog__scrim){position:absolute;inset:0;
  background:color-mix(in srgb,var(--navy,#121e4c) 62%,transparent);}
:where(.search-dialog__panel){position:relative;display:flex;flex-direction:column;
  width:min(640px,100%);max-height:80vh;overflow:hidden;
  background:var(--ground,#fff);color:var(--ink,#181818);
  border:1px solid var(--rule,#e3e8f0);border-radius:var(--radius,12px);
  box-shadow:var(--shadow-lift,0 16px 40px rgba(0,0,0,.35));}
:where(.search-dialog__field){display:flex;align-items:center;gap:.6rem;
  padding:.8rem 1rem;border-bottom:1px solid var(--rule,#e3e8f0);}
:where(.search-dialog__input){flex:1 1 auto;min-width:0;font:inherit;font-size:1.05rem;
  color:inherit;background:transparent;border:0;outline:none;padding:.15rem 0;}
:where(.search-dialog__close){font:inherit;font-size:.78rem;font-weight:600;cursor:pointer;
  padding:.3rem .55rem;border-radius:6px;color:var(--ink-muted,#666);
  border:1px solid var(--rule-strong,#cbd4e3);background:transparent;}
:where(.search-dialog__results){margin:0;padding:.4rem;list-style:none;overflow-y:auto;}
:where(.search-result){display:block;padding:.55rem .7rem;color:inherit;text-decoration:none;
  border-radius:var(--radius-sm,8px);}
:where(.search-result.is-active){background:var(--accent-wash,#e9f3fa);}
:where(.search-result__heading){display:block;font-weight:600;}
:where(.search-result__meta){display:block;font-size:.75rem;color:var(--ink-muted,#666);}
:where(.search-result__excerpt){display:block;font-size:.86rem;line-height:1.5;
  color:var(--ink-muted,#666);}
:where(.search-result mark){background:color-mix(in srgb,var(--accent,#0a7ab8) 25%,transparent);
  color:inherit;border-radius:3px;padding:0 .1em;}
:where(.search-dialog__note){margin:0;padding:1.1rem 1.15rem;font-size:.9rem;
  color:var(--ink-muted,#666);}
:where(.search-dialog__foot){margin:0;padding:.55rem 1rem;font-size:.75rem;
  color:var(--ink-muted,#666);border-top:1px solid var(--rule,#e3e8f0);}`;
    document.head.appendChild(style);
  };

  // ------------------------------------------------------- 1. mobile drawer

  const desktop = window.matchMedia('(min-width: 1000px)');

  const mobileNav = () => {
    const toggle = $('.nav-toggle');
    const sidebar = $('[data-sidebar]') ?? $('.sidebar');
    if (!toggle || !sidebar) return;

    const backdrop = document.createElement('div');
    backdrop.className = 'sidebar-backdrop';
    backdrop.setAttribute('data-sidebar-backdrop', '');
    backdrop.hidden = true;
    backdrop.style.display = 'none';
    document.body.appendChild(backdrop);

    let open = false;
    const openLabel = toggle.getAttribute('aria-label') ?? 'Open navigation';

    const setOpen = (next, returnFocus) => {
      if (next === open) return;
      open = next;

      sidebar.classList.toggle('is-open', open);
      root.classList.toggle('is-nav-open', open);
      toggle.setAttribute('aria-expanded', String(open));
      toggle.setAttribute('aria-label', open ? 'Close navigation' : openLabel);

      backdrop.hidden = !open;
      backdrop.classList.toggle('is-visible', open);
      /* Inline display as well as [hidden]: a stylesheet rule giving the scrim a
         display value would otherwise keep it painted over the page. */
      backdrop.style.display = open ? '' : 'none';

      if (open) {
        scrollLock.on();
        focusablesIn(sidebar)[0]?.focus();
      } else {
        scrollLock.off();
        if (returnFocus) toggle.focus();
      }
    };

    toggle.addEventListener('click', (event) => {
      event.preventDefault();
      setOpen(!open, false);
    });

    backdrop.addEventListener('click', () => setOpen(false, true));

    // Following a link navigates or jumps — either way the drawer is finished.
    sidebar.addEventListener('click', (event) => {
      if (event.target.closest?.('a[href]')) setOpen(false, false);
    });

    document.addEventListener('keydown', (event) => {
      if (!open) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        setOpen(false, true);
        return;
      }
      // The toggle doubles as the close button, so it belongs inside the ring.
      trapTab(event, [toggle, ...focusablesIn(sidebar)]);
    });

    // Rotating to landscape must not leave a drawer stranded over the page.
    const onBreakpoint = (event) => { if (event.matches) setOpen(false, false); };
    desktop.addEventListener?.('change', onBreakpoint) ?? desktop.addListener?.(onBreakpoint);
  };

  // ---------------------------------------------------- 2. section tracking

  const scrollSpy = () => {
    if (!('IntersectionObserver' in window)) return;

    const main = $('main.content') ?? $('#main');
    if (!main) return;

    const rails = [$('[data-toc]'), $('.sidebar__sections')].filter(Boolean);
    if (!rails.length) return;

    // One entry per heading the rails link to, in document order.
    const byId = new Map();
    for (const rail of rails) {
      for (const link of $$('a[href^="#"]', rail)) {
        const id = hashId(link.getAttribute('href'));
        const target = id && document.getElementById(id);
        if (!target || !main.contains(target)) continue;
        if (!byId.has(id)) byId.set(id, { id, el: target, links: [] });
        byId.get(id).links.push(link);
      }
    }

    const entries = [...byId.values()].sort((a, b) =>
      (a.el.compareDocumentPosition(b.el) & Node.DOCUMENT_POSITION_FOLLOWING) ? -1 : 1);
    if (entries.length < 2) return;
    entries.forEach((entry, index) => { entry.index = index; });

    const inBand = new Set();
    let atEnd = false;
    let current = null;
    const TRIGGER = 120;   // px below the sticky header — "the line being read"

    const setActive = (entry) => {
      if (entry === current) return;
      for (const link of current?.links ?? []) {
        link.classList.remove('is-active');
        link.removeAttribute('aria-current');
      }
      current = entry ?? null;
      for (const link of current?.links ?? []) {
        link.classList.add('is-active');
        link.setAttribute('aria-current', 'true');
        scrollWithinRail(link);
      }
    };

    const evaluate = () => {
      const shown = entries.filter((entry) => isVisible(entry.el));
      if (!shown.length) { setActive(null); return; }

      // Top of the page: the first section wins even though its heading may sit
      // below the trigger line, under the hero.
      if (window.scrollY <= 8) { setActive(shown[0]); return; }

      // Bottom of the page: the last section wins even though its heading may
      // never cross the trigger line — there is no scrolling left to push it there.
      if (atEnd) { setActive(shown[shown.length - 1]); return; }

      let topmost = null;
      for (const entry of shown) {
        if (inBand.has(entry) && (!topmost || entry.index < topmost.index)) topmost = entry;
      }
      if (topmost) { setActive(topmost); return; }

      // Nothing in the band — a long section: the last heading already passed.
      let passed = null;
      for (const entry of shown) {
        if (entry.el.getBoundingClientRect().top <= TRIGGER) passed = entry;
      }
      setActive(passed ?? shown[0]);
    };

    let scheduled = false;
    const schedule = () => {
      if (scheduled) return;
      scheduled = true;
      requestAnimationFrame(() => { scheduled = false; evaluate(); });
    };

    const headings = new IntersectionObserver((records) => {
      for (const record of records) {
        const entry = byId.get(record.target.id);
        if (!entry) continue;
        if (record.isIntersecting) inBand.add(entry); else inBand.delete(entry);
      }
      schedule();
    }, { rootMargin: '-96px 0px -62% 0px', threshold: 0 });

    for (const entry of entries) headings.observe(entry.el);

    /* The end-of-content sentinel is what makes the bottom rule work without a
       scroll handler: it flips once the end of the article clears the fold, and
       nothing below it needs another observer event. */
    const sentinel = document.createElement('div');
    sentinel.setAttribute('aria-hidden', 'true');
    sentinel.style.cssText = 'height:1px;margin-top:-1px;pointer-events:none;';
    main.appendChild(sentinel);

    new IntersectionObserver((records) => {
      atEnd = records[records.length - 1].isIntersecting;
      schedule();
    }, { rootMargin: '0px 0px -80px 0px', threshold: 0 }).observe(sentinel);

    window.addEventListener('resize', schedule, { passive: true });
    document.addEventListener('docs:layoutchange', schedule);
    schedule();
  };

  // -------------------------------------------------------- 3. copy buttons

  /* navigator.clipboard exists only in a secure context, and these pages get
     read over plain http from a laptop or a LAN host — so execCommand is the
     normal path there, not a legacy afterthought. */
  const copyText = async (text) => {
    if (window.isSecureContext && navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return true;
      } catch { /* denied — fall through */ }
    }
    return legacyCopy(text);
  };

  const legacyCopy = (text) => {
    const area = document.createElement('textarea');
    area.value = text;
    area.setAttribute('readonly', '');
    area.setAttribute('aria-hidden', 'true');
    area.style.cssText = 'position:fixed;top:0;left:-9999px;opacity:0;';
    document.body.appendChild(area);

    const selection = document.getSelection();
    const previous = selection?.rangeCount ? selection.getRangeAt(0) : null;

    let ok = false;
    try {
      area.select();
      area.setSelectionRange(0, area.value.length);
      ok = document.execCommand('copy');
    } catch { ok = false; }

    area.remove();
    if (previous && selection) { selection.removeAllRanges(); selection.addRange(previous); }
    return ok;
  };

  const copyButtons = () => {
    const manualKey = /Mac|iPhone|iPad/.test(navigator.platform ?? '') ? '⌘C' : 'Ctrl+C';

    for (const pre of $$('pre.code')) {
      if (pre.dataset.copyReady) continue;
      pre.dataset.copyReady = '1';

      /* Captured before the button joins the DOM — the button's own label would
         otherwise become part of the block's text. */
      const source = (pre.querySelector('code') ?? pre).textContent;
      if (!source?.trim()) continue;

      const label = pre.previousElementSibling;
      const what = label?.classList.contains('code-label')
        ? `the ${label.textContent.trim()} snippet`
        : 'this code block';

      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'copy-btn';
      button.textContent = 'Copy';
      button.setAttribute('aria-label', `Copy ${what} to the clipboard`);

      let restore;
      button.addEventListener('click', async () => {
        const ok = await copyText(source);
        button.textContent = ok ? 'Copied' : `Press ${manualKey}`;
        button.classList.toggle('is-copied', ok);
        announce(ok
          ? `Copied ${what} to the clipboard`
          : 'Copying failed — select the code and copy it manually');

        clearTimeout(restore);
        restore = setTimeout(() => {
          button.textContent = 'Copy';
          button.classList.remove('is-copied');
        }, 1500);
      });

      pre.classList.add('has-copy');
      pre.appendChild(button);
    }
  };

  // ------------------------------------------------------ 4. heading anchors

  const headingAnchors = () => {
    const main = $('main.content') ?? $('#main');
    if (!main) return;

    for (const heading of $$('h2[id], h3[id]', main)) {
      if (heading.querySelector('.heading-anchor')) continue;
      // Some headings are the body of a card link, and an <a> inside an <a> is invalid.
      if (heading.closest('a')) continue;

      let text = (heading.textContent ?? '').replace(/\s+/g, ' ').trim();
      if (text.length > 70) text = `${text.slice(0, 70).trim()}…`;

      const anchor = document.createElement('a');
      anchor.className = 'heading-anchor';
      anchor.href = `#${heading.id}`;
      anchor.setAttribute('aria-label', `Permalink to “${text}”`);

      const glyph = document.createElement('span');
      glyph.setAttribute('aria-hidden', 'true');
      glyph.textContent = '#';
      anchor.appendChild(glyph);

      // Putting the URL on the clipboard is a courtesy: never let it delay,
      // block or cancel the jump the reader actually asked for.
      anchor.addEventListener('click', () => {
        if (!window.isSecureContext || !navigator.clipboard?.writeText) return;
        const url = `${location.href.split('#')[0]}#${heading.id}`;
        navigator.clipboard.writeText(url)
          .then(() => announce('Link to this section copied'), () => { /* ignore */ });
      });

      heading.appendChild(anchor);
    }
  };

  // -------------------------------------------------------------- 5. search

  const search = () => {
    const triggers = $$('[data-search-open]');
    if (!triggers.length) return;

    // Relative, because the site is served under a path prefix. The generator stamps a
    // content version onto the script tag so a CDN cannot serve last deploy's index
    // against this deploy's anchors.
    const INDEX_URL = document.currentScript?.dataset.searchIndex
      || document.querySelector('script[data-search-index]')?.dataset.searchIndex
      || 'assets/search-index.json';
    const MAX_RESULTS = 24;
    const currentPage = location.pathname.split('/').pop() || 'index.html';

    let records = null;
    let pending = null;
    let unavailable = false;

    let ui = null;
    let open = false;
    let results = [];
    let activeIndex = -1;
    let lastFocused = null;

    const loadIndex = () => {
      pending ??= fetch(INDEX_URL, { credentials: 'same-origin' })
        .then((response) => {
          if (!response.ok) throw new Error(`HTTP ${response.status}`);
          return response.json();
        })
        .then((data) => { records = Array.isArray(data) ? data : []; return records; });
      return pending;
    };

    /* A file:// origin refuses the fetch outright. Rather than leave a dialog
       that can never find anything, the whole feature stands down. */
    const standDown = () => {
      unavailable = true;
      closeDialog(true);
      for (const trigger of triggers) trigger.hidden = true;
    };

    const build = () => {
      const dialog = document.createElement('div');
      dialog.className = 'search-dialog';
      dialog.hidden = true;
      dialog.style.display = 'none';

      const scrim = document.createElement('div');
      scrim.className = 'search-dialog__scrim';

      const panel = document.createElement('div');
      panel.className = 'search-dialog__panel';
      panel.setAttribute('role', 'dialog');
      panel.setAttribute('aria-modal', 'true');
      panel.setAttribute('aria-labelledby', 'search-dialog-title');

      const title = document.createElement('h2');
      title.className = 'visually-hidden';
      title.id = 'search-dialog-title';
      title.textContent = 'Search the documentation';

      const field = document.createElement('div');
      field.className = 'search-dialog__field';

      const icon = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
      icon.setAttribute('viewBox', '0 0 20 20');
      icon.setAttribute('width', '18');
      icon.setAttribute('height', '18');
      icon.setAttribute('aria-hidden', 'true');
      icon.setAttribute('fill', 'none');
      icon.setAttribute('stroke', 'currentColor');
      icon.setAttribute('stroke-width', '2');
      icon.setAttribute('stroke-linecap', 'round');
      icon.innerHTML = '<circle cx="9" cy="9" r="6"></circle><path d="M13.5 13.5 17.5 17.5"></path>';

      const input = document.createElement('input');
      input.type = 'search';
      input.className = 'search-dialog__input';
      input.id = 'search-dialog-input';
      input.placeholder = 'Search the documentation…';
      input.setAttribute('aria-label', 'Search the documentation');
      input.setAttribute('autocomplete', 'off');
      input.setAttribute('autocapitalize', 'off');
      input.setAttribute('autocorrect', 'off');
      input.setAttribute('spellcheck', 'false');
      input.setAttribute('role', 'combobox');
      input.setAttribute('aria-expanded', 'false');
      input.setAttribute('aria-controls', 'search-dialog-results');
      input.setAttribute('aria-autocomplete', 'list');

      const close = document.createElement('button');
      close.type = 'button';
      close.className = 'search-dialog__close';
      close.textContent = 'Esc';
      close.setAttribute('aria-label', 'Close search');

      const list = document.createElement('div');
      list.className = 'search-dialog__results';
      list.id = 'search-dialog-results';
      list.setAttribute('role', 'listbox');
      list.setAttribute('aria-label', 'Search results');

      const note = document.createElement('p');
      note.className = 'search-dialog__note';

      const foot = document.createElement('p');
      foot.className = 'search-dialog__foot';
      foot.setAttribute('aria-hidden', 'true');
      foot.textContent = '↑↓ to move · ↵ to open · Esc to close';

      field.append(icon, input, close);
      panel.append(title, field, note, list, foot);
      dialog.append(scrim, panel);
      document.body.appendChild(dialog);

      scrim.addEventListener('click', () => closeDialog());
      close.addEventListener('click', () => closeDialog());
      input.addEventListener('input', () => runQuery(input.value));
      dialog.addEventListener('keydown', onDialogKey);
      list.addEventListener('mousemove', (event) => {
        const item = event.target.closest?.('.search-result');
        const index = item ? results.indexOf(item) : -1;
        if (index > -1 && index !== activeIndex) setActiveResult(index, false);
      });

      ui = { dialog, input, list, note, close };
    };

    const openDialog = () => {
      if (unavailable) return;
      if (!ui) build();
      if (open) { ui.input.focus(); ui.input.select(); return; }

      lastFocused = document.activeElement;
      open = true;
      ui.dialog.hidden = false;
      ui.dialog.style.display = '';
      ui.dialog.classList.add('is-open');
      scrollLock.on();
      ui.input.focus();
      ui.input.select();

      if (records) {
        runQuery(ui.input.value);
        return;
      }
      // First open, and only ever once: the index is never fetched on page load.
      showNote('Loading the search index…');
      loadIndex().then(
        () => { if (open) runQuery(ui.input.value); },
        () => standDown()
      );
    };

    function closeDialog(silent) {
      if (!ui || !open) return;
      open = false;
      ui.dialog.classList.remove('is-open');
      ui.dialog.hidden = true;
      ui.dialog.style.display = 'none';
      scrollLock.off();
      if (!silent) lastFocused?.focus?.();
      lastFocused = null;
    }

    const showNote = (message) => {
      ui.note.textContent = message;
      ui.note.hidden = false;
      ui.note.style.display = '';
      ui.list.replaceChildren();
      results = [];
      activeIndex = -1;
      ui.input.setAttribute('aria-expanded', 'false');
      ui.input.removeAttribute('aria-activedescendant');
    };

    const hideNote = () => {
      ui.note.hidden = true;
      ui.note.style.display = 'none';
    };

    // ---- ranking

    const termsOf = (query) =>
      query.toLowerCase().split(/[^a-z0-9._@/+-]+/i).filter(Boolean);

    /** 3 = whole word, 2 = starts a word, 1 = anywhere, 0 = absent. */
    const matchKind = (haystack, term) => {
      let best = 0;
      let at = haystack.indexOf(term);
      let guard = 0;
      while (at > -1 && guard++ < 12) {
        const before = at === 0 ? '' : haystack.charAt(at - 1);
        const after = haystack.charAt(at + term.length);
        const startsWord = !before || !/[a-z0-9]/i.test(before);
        const endsWord = !after || !/[a-z0-9]/i.test(after);
        const kind = startsWord && endsWord ? 3 : startsWord ? 2 : 1;
        if (kind > best) best = kind;
        if (best === 3) break;
        at = haystack.indexOf(term, at + term.length);
      }
      return best;
    };

    const scoreRecord = (record, words, phrase) => {
      const heading = (record.h ?? '').toLowerCase();
      const body = (record.t ?? '').toLowerCase();
      let total = 0;

      for (const word of words) {
        const inHeading = matchKind(heading, word);
        const inBody = matchKind(body, word);
        if (!inHeading && !inBody) return 0;          // every term must appear somewhere
        total += [0, 26, 42, 60][inHeading];          // a heading hit beats a body hit
        total += [0, 4, 8, 12][inBody];
      }

      if (heading.includes(phrase)) total += 40;      // the query as a phrase in the heading
      if (heading.startsWith(phrase)) total += 20;
      if (record.l === 2) total += 10;                // an h2 outranks an h3
      if (record.p === currentPage) total += 25;      // the page being read outranks the rest
      return total;
    };

    const runQuery = (raw) => {
      if (!ui || !records) return;
      const query = (raw ?? '').trim();

      if (!query) {
        showNote(`Type to search ${records.length} sections across the documentation.`);
        return;
      }

      const words = termsOf(query);
      if (!words.length) { showNote('Type to search the documentation.'); return; }
      const phrase = query.toLowerCase();

      const hits = records
        .map((record) => ({ record, score: scoreRecord(record, words, phrase) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, MAX_RESULTS);

      if (!hits.length) {
        showNote(`No matches for “${query}”.`);
        announce(`No results for ${query}`);
        return;
      }

      hideNote();
      results = hits.map((hit, index) => renderResult(hit.record, words, index));
      ui.list.replaceChildren(...results);
      ui.input.setAttribute('aria-expanded', 'true');
      setActiveResult(0, false);
      announce(`${hits.length} ${hits.length === 1 ? 'result' : 'results'} for ${query}`);
    };

    const renderResult = (record, words, index) => {
      const link = document.createElement('a');
      link.className = 'search-result';
      link.id = `search-result-${index}`;
      link.href = record.id ? `${record.p}#${record.id}` : record.p;
      link.tabIndex = -1;
      link.setAttribute('role', 'option');
      link.setAttribute('aria-selected', 'false');

      const heading = document.createElement('span');
      heading.className = 'search-result__heading';
      paintMatches(heading, record.h ?? '', words);

      const meta = document.createElement('span');
      meta.className = 'search-result__meta';
      meta.textContent = (record.pt ?? record.p) +
        (record.p === currentPage ? ' · this page' : '');

      const excerptEl = document.createElement('span');
      excerptEl.className = 'search-result__excerpt';
      paintMatches(excerptEl, excerptAround(record.t ?? '', words), words);

      link.append(heading, meta, excerptEl);
      link.addEventListener('click', () => closeDialog(true));
      return link;
    };

    const excerptAround = (text, words, width = 170) => {
      const lower = text.toLowerCase();
      let at = -1;
      for (const word of words) {
        const found = lower.indexOf(word);
        if (found > -1 && (at < 0 || found < at)) at = found;
      }
      if (at < 0) at = 0;

      let start = Math.max(0, at - 55);
      if (start > 0) {
        const space = text.indexOf(' ', start);
        if (space > -1 && space < start + 25) start = space + 1;
      }
      const end = Math.min(text.length, start + width);
      return (start > 0 ? '…' : '') + text.slice(start, end).trim() +
             (end < text.length ? '…' : '');
    };

    /* Matches are wrapped by building <mark> elements around text nodes: the
       query is user input and must never reach innerHTML. */
    const paintMatches = (container, text, words) => {
      const lower = text.toLowerCase();
      const spans = [];
      for (const word of words) {
        let at = lower.indexOf(word);
        let guard = 0;
        while (at > -1 && guard++ < 40) {
          spans.push([at, at + word.length]);
          at = lower.indexOf(word, at + word.length);
        }
      }

      if (!spans.length) { container.textContent = text; return; }
      spans.sort((a, b) => a[0] - b[0]);

      const merged = [spans[0]];
      for (const span of spans.slice(1)) {
        const last = merged[merged.length - 1];
        if (span[0] <= last[1]) last[1] = Math.max(last[1], span[1]);
        else merged.push(span);
      }

      let cursor = 0;
      for (const [from, to] of merged) {
        if (from > cursor) container.append(text.slice(cursor, from));
        const mark = document.createElement('mark');
        mark.textContent = text.slice(from, to);
        container.append(mark);
        cursor = to;
      }
      if (cursor < text.length) container.append(text.slice(cursor));
    };

    const setActiveResult = (index, jump = true) => {
      if (!results.length) return;
      if (index < 0) index = results.length - 1;
      if (index >= results.length) index = 0;

      const previous = results[activeIndex];
      if (previous) {
        previous.classList.remove('is-active');
        previous.setAttribute('aria-selected', 'false');
      }
      activeIndex = index;
      const item = results[activeIndex];
      item.classList.add('is-active');
      item.setAttribute('aria-selected', 'true');
      ui.input.setAttribute('aria-activedescendant', item.id);
      if (jump) scrollWithinRail(item);
    };

    function onDialogKey(event) {
      switch (event.key) {
        case 'Escape':
          event.preventDefault();
          closeDialog();
          break;
        case 'ArrowDown':
          event.preventDefault();
          setActiveResult(activeIndex + 1);
          break;
        case 'ArrowUp':
          event.preventDefault();
          setActiveResult(activeIndex - 1);
          break;
        case 'Home':
          if (results.length) { event.preventDefault(); setActiveResult(0); }
          break;
        case 'End':
          if (results.length) { event.preventDefault(); setActiveResult(results.length - 1); }
          break;
        case 'Enter':
          if (results[activeIndex]) { event.preventDefault(); results[activeIndex].click(); }
          break;
        case 'Tab':
          trapTab(event, [ui.input, ui.close]);
          break;
      }
    }

    for (const trigger of triggers) {
      trigger.addEventListener('click', (event) => {
        event.preventDefault();
        openDialog();
      });
    }

    document.addEventListener('keydown', (event) => {
      if (unavailable || event.defaultPrevented) return;

      if ((event.metaKey || event.ctrlKey) && (event.key === 'k' || event.key === 'K')) {
        event.preventDefault();
        openDialog();
        return;
      }
      // "/" is a shortcut only while the reader is not typing into something.
      if (event.key === '/' && !open && !event.metaKey && !event.ctrlKey && !event.altKey &&
          !isTypingTarget(event.target)) {
        event.preventDefault();
        openDialog();
      }
    });
  };

  // ------------------------------------------------------- 6. platform tabs

  const PLATFORM_KEY = 'amthal-docs.platform';
  const tabGroups = [];

  /** Same platform, different labels per page ("Expo" / "Expo sheet") — key on both. */
  const platformKey = (link) => {
    const probe = `${link.textContent ?? ''} ${link.getAttribute('href') ?? ''}`.toLowerCase();
    if (/react[\s-]?native|(^|[^a-z])rn([^a-z]|$)/.test(probe)) return 'react-native';
    if (/expo/.test(probe)) return 'expo';
    if (/android|kotlin/.test(probe)) return 'android';
    if (/ios|swift|apple/.test(probe)) return 'ios';
    return (link.textContent ?? '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-') || 'tab';
  };

  const selectTab = (group, index, { focus = false, save = true } = {}) => {
    if (index < 0 || index >= group.tabs.length) return;
    group.index = index;

    group.tabs.forEach((tab, i) => {
      const on = i === index;
      tab.setAttribute('aria-selected', String(on));
      /* aria-current as well as aria-selected: the stylesheet marks the chosen
         platform with .platform-tabs a[aria-current="true"]. */
      if (on) tab.setAttribute('aria-current', 'true'); else tab.removeAttribute('aria-current');
      tab.tabIndex = on ? 0 : -1;
      tab.classList.toggle('is-active', on);

      const panel = group.panels[i];
      panel.hidden = !on;
      // Inline display too, so a .platform-panel display rule cannot defeat [hidden].
      panel.style.display = on ? '' : 'none';
    });

    if (focus) group.tabs[index].focus();
    if (save) store.set(PLATFORM_KEY, group.keys[index]);
    layoutChanged();
  };

  /** One choice speaks for the whole site: apply it to every tab set on the page. */
  const applyPlatform = (key, origin) => {
    for (const group of tabGroups) {
      if (group === origin) continue;
      const index = group.keys.indexOf(key);
      if (index > -1 && index !== group.index) selectTab(group, index, { save: false });
    }
  };

  const upgradeTabs = (list) => {
    const tabs = $$('a[href^="#"]', list);
    if (tabs.length < 2) return;

    const targets = tabs.map((tab) => document.getElementById(hashId(tab.getAttribute('href'))));

    /* Anything that does not fit the pattern is left exactly as it is: a row of
       anchors pointing at sibling headings, which is also the no-JS behaviour. */
    if (targets.some((target) => !target || !/^H[2-4]$/.test(target.tagName))) return;

    const parent = targets[0].parentNode;
    if (targets.some((target) => target.parentNode !== parent)) return;

    const level = Number(targets[0].tagName.charAt(1));
    if (targets.some((target) => Number(target.tagName.charAt(1)) !== level)) return;

    if (!(targets[0].compareDocumentPosition(list) & Node.DOCUMENT_POSITION_PRECEDING)) return;
    for (let i = 1; i < targets.length; i++) {
      if (!(targets[i - 1].compareDocumentPosition(targets[i]) & Node.DOCUMENT_POSITION_FOLLOWING)) return;
    }

    const stops = new Set(targets);
    const panels = targets.map((heading) => {
      /* A panel runs from its heading to the next tab target, or to the next
         heading at the same level or higher — whichever comes first. */
      const nodes = [heading];
      let node = heading.nextSibling;
      while (node) {
        if (node.nodeType === Node.ELEMENT_NODE) {
          if (stops.has(node)) break;
          const match = /^H([1-6])$/.exec(node.tagName);
          if (match && Number(match[1]) <= level) break;
        }
        nodes.push(node);
        node = node.nextSibling;
      }

      const panel = document.createElement('div');
      panel.className = 'platform-panel';
      panel.id = `panel-${heading.id}`;
      panel.tabIndex = 0;
      panel.setAttribute('role', 'tabpanel');
      panel.setAttribute('aria-labelledby', `tab-${heading.id}`);
      parent.insertBefore(panel, heading);
      panel.append(...nodes);
      return panel;
    });

    list.setAttribute('role', 'tablist');
    for (const child of list.children) {
      if (child.tagName === 'LI') child.setAttribute('role', 'none');
    }

    const keys = tabs.map(platformKey);
    const group = { list, tabs, panels, keys, index: -1 };

    tabs.forEach((tab, index) => {
      tab.setAttribute('role', 'tab');
      tab.id = `tab-${targets[index].id}`;
      tab.setAttribute('aria-controls', panels[index].id);
      tab.tabIndex = -1;
      tab.addEventListener('click', (event) => {
        event.preventDefault();
        selectTab(group, index, { focus: true });
        applyPlatform(keys[index], group);
      });
    });

    list.addEventListener('keydown', (event) => {
      const step = { ArrowRight: 1, ArrowDown: 1, ArrowLeft: -1, ArrowUp: -1 }[event.key];
      let next = null;
      if (step) next = (group.index + step + tabs.length) % tabs.length;
      else if (event.key === 'Home') next = 0;
      else if (event.key === 'End') next = tabs.length - 1;
      if (next === null) return;

      event.preventDefault();
      selectTab(group, next, { focus: true });
      applyPlatform(keys[next], group);
    });

    tabGroups.push(group);

    // A link into one of these panels outranks the remembered platform.
    const linked = hashId(location.hash);
    const target = linked && document.getElementById(linked);
    const hashIndex = target ? panels.findIndex((panel) => panel.contains(target)) : -1;
    const storedIndex = keys.indexOf(store.get(PLATFORM_KEY));

    selectTab(group, hashIndex > -1 ? hashIndex : Math.max(storedIndex, 0), { save: false });
  };

  /** Opens the tab panel holding `id`, so a deep link never lands on hidden content. */
  const revealAnchor = (id) => {
    const el = id ? document.getElementById(id) : null;
    const panel = el?.closest('.platform-panel');
    if (!panel?.hidden) return false;

    for (const group of tabGroups) {
      const index = group.panels.indexOf(panel);
      if (index > -1) { selectTab(group, index, { save: false }); return true; }
    }
    return false;
  };

  const platformTabs = () => {
    for (const list of $$('.platform-tabs')) {
      try { upgradeTabs(list); }
      catch (error) { console?.warn?.('[docs] tab set left as anchors:', error); }
    }
    if (!tabGroups.length) return;

    /* Captured, so the panel is open before the browser computes where to jump —
       the contents rail and the sidebar both link into these panels. */
    document.addEventListener('click', (event) => {
      const link = event.target.closest?.('a[href]');
      if (!link || link.getAttribute('role') === 'tab') return;

      const href = link.getAttribute('href') ?? '';
      const at = href.indexOf('#');
      if (at < 0) return;
      if (at > 0 && !isSamePage(href.slice(0, at))) return;
      revealAnchor(hashId(href));
    }, true);

    window.addEventListener('hashchange', () => {
      const id = hashId(location.hash);
      if (revealAnchor(id)) document.getElementById(id)?.scrollIntoView({ block: 'start' });
    });

    // Landing on a hash whose panel this file has just hidden or swapped.
    const id = hashId(location.hash);
    if (id) document.getElementById(id)?.scrollIntoView({ block: 'start' });
  };

  // ----------------------------------------------------------------- install

  feature('fallback styles', installFallbackStyles);
  feature('mobile navigation', mobileNav);
  feature('platform tabs', platformTabs);   // before the scroll-spy: it changes what is visible
  feature('scroll spy', scrollSpy);
  feature('copy buttons', copyButtons);
  feature('heading anchors', headingAnchors);
  feature('search', search);
})();
