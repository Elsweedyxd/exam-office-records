// table.js
// One reusable table used by both the Marks and the Students pages.
// It handles searching, filters, sorting, paging, the result count, the empty state
// and the delete confirmation. The current view is kept in the address bar so the Back button works.
'use strict';
function DataTable({ endpoint, columns, renderCells, noun, defaultSort = '', defaultDir = 'asc' }) {
  const { $, $$, api, toast } = App;
  const form = $('#filters');
  const tbody = $('#rows');
  const wrap = $('#table-wrap');
  const count = $('#result-count');
  const empty = $('#empty');
  const pager = $('#pagination');
  const pageSizeSel = $('#pageSize');
  const params = new URLSearchParams(location.search);
  // The current sort, page and page size. They are read from the address bar first,
  // so a filtered list can be bookmarked or shared and still look the same.
  const state = {
    sort: params.get('sort') || defaultSort,
    dir: params.get('dir') || defaultDir,
    page: +params.get('page') || 1,
    pageSize: +params.get('pageSize') || +localStorageGet('pageSize') || 25,
  };
  let lastRows = [];
  let requestId = 0;

  // localStorage can throw an error in private browsing, so these are wrapped in try/catch.
  function localStorageGet(k) { try { return localStorage.getItem(k); } catch { return null; } }
  function localStorageSet(k, v) { try { localStorage.setItem(k, v); } catch {} }

  // Restore filter values from the URL
  // Put the filter values from the address bar back into the filter boxes.
  [...form.elements].forEach(el => { if (el.name && params.has(el.name)) el.value = params.get(el.name); });
  pageSizeSel.value = String(state.pageSize);

  // ----- Mobile "Sort by" control (column headers are hidden in card layout) -----
  // On small screens the column headings are hidden (rows become cards),
  // so I add a "Sort by" drop-down that does the same as clicking a heading.
  const sortable = $$('th[data-sort]');
  const mobileSort = document.createElement('div');
  mobileSort.className = 'sort-mobile';
  mobileSort.innerHTML = `<label class="inline-label" for="sort-mobile">Sort by</label>
    <select class="input input-auto" id="sort-mobile">${sortable.map(th =>
      ['asc', 'desc'].map(d => `<option value="${th.dataset.sort}:${d}">${th.textContent.trim()} (${d === 'asc' ? 'ascending' : 'descending'})</option>`).join('')).join('')}
    </select>`;
  $('.toolbar-right').prepend(mobileSort);
  const mobileSel = $('#sort-mobile');
  mobileSel.addEventListener('change', () => {
    const [s, d] = mobileSel.value.split(':'); state.sort = s; state.dir = d; state.page = 1; load();
  });

  // Clicking a heading button sorts by it. Clicking the same one again reverses the order.
  sortable.forEach(th => th.querySelector('button').addEventListener('click', () => {
    const key = th.dataset.sort;
    state.dir = state.sort === key && state.dir === 'asc' ? 'desc' : 'asc';
    state.sort = key; state.page = 1;
    load();
  }));

  // Shows which column is sorted. aria-sort on the heading tells screen readers,
  // the arrow shows it visually, and the button label says what clicking will do.
  function paintSort() {
    sortable.forEach(th => {
      const btn = th.querySelector('button');
      const label = btn.textContent.trim();
      if (th.dataset.sort === state.sort) {
        th.setAttribute('aria-sort', state.dir === 'asc' ? 'ascending' : 'descending');
        btn.setAttribute('aria-label', `${label}, sorted ${state.dir === 'asc' ? 'ascending' : 'descending'}. Select to reverse.`);
      } else {
        th.removeAttribute('aria-sort');
        btn.setAttribute('aria-label', `${label}, select to sort`);
      }
    });
    if (state.sort) mobileSel.value = `${state.sort}:${state.dir}`;
  }

  // ----- Filters: selects apply instantly; search applies after a short pause in typing -----
  // Filters: drop-downs update the table straight away. The search box waits until the user
  // stops typing for a moment (debounce) so it does not reload on every letter.
  let debounce;
  form.addEventListener('submit', e => { e.preventDefault(); state.page = 1; load(); });
  form.addEventListener('change', e => { if (e.target.tagName === 'SELECT') { state.page = 1; load(); } });
  form.addEventListener('input', e => {
    if (e.target.type !== 'search') return;
    clearTimeout(debounce);
    debounce = setTimeout(() => { state.page = 1; load(); }, 450);
  });
  // Clear filters puts everything back and moves focus to the search box.
  const clear = () => { form.reset(); [...form.elements].forEach(el => { if (el.type === 'hidden') el.value = ''; }); state.page = 1; load(); $('#q').focus(); };
  $('#clear-filters').addEventListener('click', clear);
  $('#empty-clear')?.addEventListener('click', clear);
  pageSizeSel.addEventListener('change', () => { state.pageSize = +pageSizeSel.value; localStorageSet('pageSize', state.pageSize); state.page = 1; load(); });

  // Builds the query string sent to the server from the filters, sort and page.
  function query() {
    const q = new URLSearchParams();
    [...form.elements].forEach(el => { if (el.name && el.value.trim()) q.set(el.name, el.value.trim()); });
    if (state.sort) { q.set('sort', state.sort); q.set('dir', state.dir); }
    if (state.page > 1) q.set('page', state.page);
    q.set('pageSize', state.pageSize);
    return q;
  }

  // Describes the active filters in words, e.g. matching "smith", Exam.
  // Added to the result count so the user always knows why they see these rows.
  function activeFilterText() {
    const parts = [];
    [...form.elements].forEach(el => {
      if (!el.name || !el.value.trim()) return;
      if (el.tagName === 'SELECT') parts.push(el.options[el.selectedIndex].text);
      else if (el.type === 'search') parts.push(`“${el.value.trim()}”`);
      else if (el.type === 'hidden') parts.push(`student ${el.value}`);
    });
    return parts.length ? ` matching ${parts.join(', ')}` : '';
  }

  // Loads and draws the table.
  // - requestId makes sure an older, slower reply never replaces a newer one
  // - aria-busy and "Loading..." show that it is working
  // - the result count (a live region) says e.g. "Showing 1 to 25 of 177 marks"
  // - every cell gets data-label, which the mobile card layout shows as the label
  // - if there are no rows the table is hidden and the empty state is shown
  async function load({ focusCount = false } = {}) {
    const id = ++requestId;
    const q = query();
    history.replaceState(null, '', location.pathname + '?' + q.toString());
    wrap.setAttribute('aria-busy', 'true');
    count.textContent = `Loading ${noun[1]}…`;
    paintSort();
    try {
      const data = await api(`${endpoint}?${q}`);
      if (id !== requestId) return; // a newer request is in flight
      lastRows = data.rows;
      const pages = Math.max(1, Math.ceil(data.total / data.pageSize));
      if (state.page > pages && data.total) { state.page = pages; return load(); }
      tbody.innerHTML = data.rows.map(row => {
        const cells = renderCells(row);
        return `<tr role="row">${cells.map((html, i) => {
          const col = columns[i];
          const tag = col.rowHeader ? 'th scope="row" role="rowheader"' : 'td role="cell"';
          const close = col.rowHeader ? 'th' : 'td';
          // The cell content is wrapped in a div so it stays together when the row becomes a card on small screens.
          return `<${tag} data-label="${col.label}"${col.cls ? ` class="${col.cls}"` : ''}><div class="cell">${html}</div></${close}>`;
        }).join('')}</tr>`;
      }).join('');
      const from = data.total ? (data.page - 1) * data.pageSize + 1 : 0;
      const to = Math.min(data.total, data.page * data.pageSize);
      count.textContent = data.total
        ? `Showing ${from} to ${to} of ${data.total} ${data.total === 1 ? noun[0] : noun[1]}${activeFilterText()}`
        : `No ${noun[1]} found${activeFilterText()}`;
      wrap.hidden = !data.total;
      empty.hidden = !!data.total;
      renderPager(data.page, pages);
      $('#export')?.setAttribute('href', '/api/marks/export.csv?' + q.toString());
      if (focusCount) { count.setAttribute('tabindex', '-1'); count.focus(); }
    } catch (err) {
      if (id !== requestId) return;
      count.textContent = `${noun[1][0].toUpperCase() + noun[1].slice(1)} could not be loaded.`;
      toast(err.message, 'error');
    } finally {
      if (id === requestId) wrap.removeAttribute('aria-busy');
    }
  }

  // Page buttons: Previous, first, last, the pages next to the current one, and Next.
  // "..." fills the gaps. aria-current marks the current page.
  function renderPager(page, pages) {
    if (pages <= 1) { pager.innerHTML = ''; return; }
    const nums = new Set([1, pages, page - 1, page, page + 1].filter(n => n >= 1 && n <= pages));
    const sorted = [...nums].sort((a, b) => a - b);
    let html = '<ul>';
    if (page > 1) html += `<li><button type="button" class="btn btn-secondary btn-small" data-page="${page - 1}">‹ Previous<span class="visually-hidden"> page</span></button></li>`;
    sorted.forEach((n, i) => {
      if (i && n - sorted[i - 1] > 1) html += '<li aria-hidden="true">…</li>';
      html += `<li><button type="button" class="btn btn-secondary btn-small" data-page="${n}"${n === page ? ' aria-current="page"' : ''}><span class="visually-hidden">Page </span>${n}</button></li>`;
    });
    if (page < pages) html += `<li><button type="button" class="btn btn-secondary btn-small" data-page="${page + 1}">Next<span class="visually-hidden"> page</span> ›</button></li>`;
    pager.innerHTML = html + `</ul><p class="hint pager-info">Page ${page} of ${pages}</p>`;
  }
  // After changing page, focus moves to the result count so keyboard users start at the
  // top of the new rows instead of being left at the bottom.
  pager.addEventListener('click', e => {
    const b = e.target.closest('[data-page]');
    if (!b) return;
    state.page = +b.dataset.page;
    load({ focusCount: true }); // move focus to the results summary so keyboard users start at the top
  });

  // ----- Delete confirmation using the native <dialog> (focus is trapped and Esc closes it) -----
  // Asks "are you sure?" before deleting (error prevention), using the browser's <dialog>.
  // showModal() keeps focus inside the dialog, Esc cancels, the safe button gets focus first,
  // and focus goes back to the Delete button afterwards. It returns true or false.
  function confirmDelete(description) {
    const dlg = $('#confirm-dialog');
    $('#confirm-desc').textContent = description;
    const opener = document.activeElement;
    return new Promise(resolve => {
      const done = val => { dlg.close(); resolve(val); };
      $('#confirm-yes').onclick = () => done(true);
      $('#confirm-no').onclick = () => done(false);
      dlg.oncancel = e => { e.preventDefault(); done(false); };
      dlg.onclose = () => { if (opener && document.contains(opener)) opener.focus(); };
      dlg.showModal();
      $('#confirm-no').focus();
    });
  }

  load();
  return { reload: load, rows: () => lastRows, confirmDelete };
}
