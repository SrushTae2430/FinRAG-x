/* FinRAG-X — vanilla JS SPA served by FastAPI */
'use strict';

const BASE = window.FINRAG_BASE || '';

// ─── State ───────────────────────────────────────────────────────────────────
const state = {
  token: localStorage.getItem('finrag_token') || '',
  email: localStorage.getItem('finrag_email') || '',
  page: 'ask',
  docs: [],
  openEv: null,
};

// ─── Utils ───────────────────────────────────────────────────────────────────
function qs(sel, ctx = document) { return ctx.querySelector(sel); }
function qsa(sel, ctx = document) { return [...ctx.querySelectorAll(sel)]; }
function el(tag, attrs = {}, ...children) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(attrs)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2), v);
    else if (k === 'html') e.innerHTML = v;
    else e.setAttribute(k, v);
  }
  children.flat().forEach(c => { if (c != null) e.appendChild(typeof c === 'string' ? document.createTextNode(c) : c); });
  return e;
}

function fmt(n, d = 4) {
  return Number(n).toLocaleString('en-US', { maximumFractionDigits: d }).replace('-', '−');
}
function fmtArg(a) {
  if (typeof a === 'string' && a.startsWith('#')) return `result of step ${Number(a.slice(1)) + 1}`;
  if (typeof a === 'number') return fmt(a);
  return String(a);
}
function parseMeta(text) {
  const m = text.match(/^\[([^\]]*)\]\s*/);
  if (!m) return { company: '', year: '', page: '', body: text };
  const parts = m[1].split('|').map(s => s.trim());
  return {
    company: parts[0] || '',
    year: parts[1] || '',
    page: (parts[2] || '').replace(/^page\s*/i, ''),
    body: text.slice(m[0].length),
  };
}
function parseTable(body) {
  const rows = [];
  for (const line of body.split('\n')) {
    if (!line.trim().startsWith('|')) continue;
    const cells = line.split('|').map(c => c.trim());
    cells.shift();
    if (cells.length && cells[cells.length - 1] === '') cells.pop();
    if (cells.length && cells.every(c => /^:?-{2,}:?$/.test(c))) continue;
    rows.push(cells);
  }
  if (rows.length && rows[0][0] === '') rows.forEach(r => r.shift());
  return rows;
}
const isNumeric = c => /^[\s$(−-]*[\d,.]+\)?\s*%?$/.test(c);
const NUM_RE = /\d[\d,]*(?:\.\d+)?/g;
function toNum(s) { return parseFloat(s.replace(/,/g, '')); }

function highlightNums(text, nums) {
  if (!nums.size) return document.createTextNode(text);
  const frag = document.createDocumentFragment();
  let last = 0;
  for (const m of text.matchAll(NUM_RE)) {
    const idx = m.index;
    if (nums.has(toNum(m[0]))) {
      if (idx > last) frag.appendChild(document.createTextNode(text.slice(last, idx)));
      frag.appendChild(el('mark', {}, m[0]));
      last = idx + m[0].length;
    }
  }
  frag.appendChild(document.createTextNode(text.slice(last)));
  return frag;
}

function userInitials(email) {
  const parts = email.split('@')[0].split(/[._-]/);
  return parts.length >= 2
    ? (parts[0][0] + parts[1][0]).toUpperCase()
    : email.slice(0, 2).toUpperCase();
}

// ─── API ─────────────────────────────────────────────────────────────────────
async function apiFetch(path, opts = {}) {
  const headers = { ...(opts.headers || {}) };
  if (state.token) headers['Authorization'] = `Bearer ${state.token}`;
  if (opts.json) {
    headers['Content-Type'] = 'application/json';
    opts.body = JSON.stringify(opts.json);
    delete opts.json;
  }
  const res = await fetch(BASE + path, { ...opts, headers });
  if (res.status === 401) throw Object.assign(new Error('UNAUTHORIZED'), { status: 401 });
  if (!res.ok) {
    let msg = `Request failed (${res.status})`;
    try { msg = (await res.json()).detail || msg; } catch {}
    throw new Error(msg);
  }
  return res.json();
}

function handleAuthError(e) {
  if (e.status === 401 || e.message === 'UNAUTHORIZED') { logout(); return true; }
  return false;
}

// ─── Auth helpers ─────────────────────────────────────────────────────────────
function setAuth(token, email) {
  state.token = token;
  state.email = email;
  localStorage.setItem('finrag_token', token);
  localStorage.setItem('finrag_email', email);
}

function logout() {
  state.token = '';
  state.email = '';
  localStorage.removeItem('finrag_token');
  localStorage.removeItem('finrag_email');
  renderRoot();
}

// ─── Root render ─────────────────────────────────────────────────────────────
function renderRoot() {
  const root = qs('#root');
  root.innerHTML = '';
  if (!state.token) {
    root.appendChild(renderLogin());
  } else {
    root.appendChild(renderApp());
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  LOGIN PAGE
// ═══════════════════════════════════════════════════════════════════════════
function renderLogin() {
  let mode = 'login';

  const page = el('div', { id: 'login-page' });
  const card = el('div', { class: 'login-card' });

  const logo = el('div', { class: 'login-logo' },
    el('div', { class: 'brand-icon-lg' }, '📊'),
    el('h1', {}, 'FinRAG-X'),
    el('p', {}, 'Financial Research & Evidence')
  );

  const toggle = el('div', { class: 'tab-toggle' });
  const btnLogin = el('button', { class: 'active', onclick: () => switchMode('login') }, 'Sign In');
  const btnSignup = el('button', { onclick: () => switchMode('signup') }, 'Create Account');
  toggle.append(btnLogin, btnSignup);

  const form = el('form', { onsubmit: handleSubmit });
  const fieldGroup = el('div', { class: 'field-group' });

  const emailLabel = el('label', { class: 'field' }, 'Email Address');
  const emailInput = el('input', { type: 'email', placeholder: 'you@example.com', required: '' });
  emailLabel.appendChild(emailInput);

  const pwLabel = el('label', { class: 'field' }, 'Password');
  const pwInput = el('input', { type: 'password', placeholder: '••••••••', required: '', minlength: '8', autocomplete: 'current-password' });
  pwLabel.appendChild(pwInput);

  fieldGroup.append(emailLabel, pwLabel);

  const errDiv = el('div', { class: 'error-bar hidden' },
    el('span', {}, '⚠ '),
    el('span', { class: 'err-text' }, '')
  );

  const submitBtn = el('button', { type: 'submit', class: 'btn btn-primary btn-full' }, 'Sign In');

  const switchLink = el('p', { style: 'text-align:center;margin-top:16px;font-size:0.82rem;color:var(--text3)' });
  const switchA = el('button', { class: 'example-link', onclick: () => switchMode(mode === 'login' ? 'signup' : 'login') }, 'Create one');
  switchLink.append('No account? ', switchA);

  form.append(fieldGroup, errDiv, submitBtn, switchLink);
  card.append(logo, toggle, form);
  page.appendChild(card);

  function switchMode(m) {
    mode = m;
    btnLogin.classList.toggle('active', m === 'login');
    btnSignup.classList.toggle('active', m === 'signup');
    submitBtn.textContent = m === 'login' ? 'Sign In' : 'Create Account';
    pwInput.setAttribute('autocomplete', m === 'login' ? 'current-password' : 'new-password');
    switchA.textContent = m === 'login' ? 'Create one' : 'Sign in';
    switchLink.childNodes[0].textContent = m === 'login' ? 'No account? ' : 'Already registered? ';
    errDiv.classList.add('hidden');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    errDiv.classList.add('hidden');
    submitBtn.disabled = true;
    submitBtn.textContent = 'Please wait…';
    try {
      const r = await apiFetch(`/${mode}`, {
        method: 'POST',
        json: { email: emailInput.value, password: pwInput.value }
      });
      setAuth(r.token, r.email);
      renderRoot();
    } catch (err) {
      qs('.err-text', errDiv).textContent = err.message;
      errDiv.classList.remove('hidden');
    } finally {
      submitBtn.disabled = false;
      submitBtn.textContent = mode === 'login' ? 'Sign In' : 'Create Account';
    }
  }

  return page;
}

// ═══════════════════════════════════════════════════════════════════════════
//  APP SHELL
// ═══════════════════════════════════════════════════════════════════════════
function renderApp() {
  const page = el('div', { id: 'app-page' });

  // Topbar
  const topbar = el('header', { class: 'topbar' },
    el('div', { class: 'brand' },
      el('div', { class: 'brand-icon-sm' }, '📊'),
      el('span', { class: 'brand-name' }, 'FinRAG-X'),
      el('span', { class: 'brand-tag' }, 'Financial RAG')
    ),
    el('div', { class: 'topbar-right' },
      el('div', { class: 'user-badge' },
        el('div', { class: 'user-avatar' }, userInitials(state.email)),
        el('span', { class: 'user-email' }, state.email)
      ),
      el('button', { class: 'btn btn-ghost btn-sm', onclick: logout }, '↩ Sign Out')
    )
  );

  // Nav tabs
  const tabs = [
    ['ask', '🔍', 'Analyze'],
    ['compare', '⚡', 'Compare Retrieval'],
    ['eval', '📈', 'Evaluation'],
  ];
  const navtabs = el('nav', { class: 'navtabs' });
  const tabBtns = {};
  tabs.forEach(([key, icon, label]) => {
    const btn = el('button', {
      class: key === state.page ? 'active' : '',
      onclick: () => switchTab(key)
    },
      el('span', { class: 'tab-dot' }),
      `${icon} ${label}`
    );
    tabBtns[key] = btn;
    navtabs.appendChild(btn);
  });

  // Content
  const content = el('div', { class: 'page-content' });
  const panes = {};

  const askPane = el('div', { class: 'tab-pane' + (state.page === 'ask' ? ' active' : ''), id: 'pane-ask' });
  const comparePane = el('div', { class: 'tab-pane' + (state.page === 'compare' ? ' active' : ''), id: 'pane-compare' });
  const evalPane = el('div', { class: 'tab-pane' + (state.page === 'eval' ? ' active' : ''), id: 'pane-eval' });

  panes.ask = askPane;
  panes.compare = comparePane;
  panes.eval = evalPane;

  initAskPane(askPane);
  initComparePane(comparePane);
  initEvalPane(evalPane);

  content.append(askPane, comparePane, evalPane);
  page.append(topbar, navtabs, content);

  function switchTab(key) {
    state.page = key;
    Object.entries(tabBtns).forEach(([k, b]) => b.classList.toggle('active', k === key));
    Object.entries(panes).forEach(([k, p]) => p.classList.toggle('active', k === key));
    // Lazy-load eval
    if (key === 'eval' && !evalPane.dataset.loaded) {
      loadEval(evalPane);
      evalPane.dataset.loaded = '1';
    }
  }

  return page;
}

// ═══════════════════════════════════════════════════════════════════════════
//  ASK PANE
// ═══════════════════════════════════════════════════════════════════════════
const CHECK_LABELS = {
  answered: 'An answer was produced',
  citations_valid: 'Cited sources are among the retrieved evidence',
  inputs_grounded: 'Calculation inputs appear in the evidence',
  result_in_answer: 'Computed result appears in the answer',
  answer_numbers_supported: 'Numbers in the answer appear in the evidence',
};

const MODES = [
  ['hybrid_rerank', 'Hybrid + Rerank (recommended)'],
  ['hybrid', 'Hybrid (rank fusion)'],
  ['dense', 'Dense only'],
  ['bm25', 'BM25 only'],
];

const EXAMPLE_Q = "What was the percentage change in AES Corporation's proportional free cash flow between 2013 and 2014, as reported in the 2015 financial report?";

function initAskPane(pane) {
  // Header
  const header = el('div', { class: 'section-header' },
    el('h2', {}, '🔍 Financial Analysis'),
    el('p', {}, 'Ask a question about financial reports. Evidence is retrieved, calculations run in code, and answers are verified before release.')
  );

  // Ask panel
  const askPanel = el('div', { class: 'ask-panel' });
  const textarea = el('textarea', {
    placeholder: 'Ask a question about a financial report…',
    'aria-label': 'Question'
  });
  textarea.addEventListener('keydown', e => {
    if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) runAsk();
  });

  // Doc selector
  const docSelect = el('select', { class: 'select-styled', id: 'doc-select' },
    el('option', { value: '' }, 'Pre-indexed reports')
  );
  state.docs.forEach(d => {
    docSelect.appendChild(el('option', { value: d.id }, d.name));
  });

  // Mode selector
  const modeSelect = el('select', { class: 'select-styled', id: 'mode-select' });
  MODES.forEach(([v, l]) => modeSelect.appendChild(el('option', { value: v }, l)));
  modeSelect.value = 'hybrid_rerank';

  const controls = el('div', { class: 'ask-controls' },
    el('div', { class: 'control-group' },
      el('span', { class: 'control-label' }, 'Search in'),
      docSelect
    ),
    el('div', { class: 'control-group' },
      el('span', { class: 'control-label' }, 'Retrieval Mode'),
      modeSelect
    ),
    el('div', { class: 'ask-cta' },
      el('button', { class: 'btn btn-primary', id: 'run-btn', onclick: runAsk }, '▶ Run Analysis')
    )
  );

  const exampleBtn = el('button', { class: 'example-link', onclick: () => { textarea.value = EXAMPLE_Q; } },
    '📌 Example: AES Corp proportional free cash flow (2013–2014)'
  );

  // Upload zone
  const fileInput = el('input', { type: 'file', accept: '.pdf,.txt', id: 'file-input' });
  const uploadMsg = el('span', { class: 'upload-msg' }, '');
  const uploadLabel = el('label', { class: 'upload-label', for: 'file-input' },
    '📎 Upload PDF or TXT'
  );
  uploadLabel.appendChild(fileInput);

  fileInput.addEventListener('change', async () => {
    const f = fileInput.files[0];
    if (!f) return;
    uploadMsg.className = 'upload-msg loading';
    uploadMsg.textContent = `Indexing ${f.name}…`;
    try {
      const form = new FormData();
      form.append('file', f);
      const d = await apiFetch('/upload', { method: 'POST', body: form });
      state.docs.push(d);
      docSelect.appendChild(el('option', { value: d.id }, d.name));
      docSelect.value = d.id;
      uploadMsg.className = 'upload-msg success';
      uploadMsg.textContent = `✓ ${d.name}: ${d.chunks} passages indexed`;
    } catch (e) {
      if (handleAuthError(e)) return;
      uploadMsg.className = 'upload-msg';
      uploadMsg.textContent = `✗ ${e.message}`;
    }
  });

  const uploadZone = el('div', { class: 'upload-zone' }, uploadLabel, uploadMsg);

  askPanel.append(textarea, controls, exampleBtn, uploadZone);

  // Status / results area
  const statusArea = el('div', { id: 'status-area' });

  pane.append(header, askPanel, statusArea);

  async function runAsk() {
    if (!textarea.value.trim()) return;
    const btn = qs('#run-btn');
    btn.disabled = true;
    btn.textContent = '⏳ Analyzing…';
    statusArea.innerHTML = '';

    // Loading bar
    const loadingBar = el('div', { class: 'status-bar' },
      el('div', { class: 'spinner' }),
      'Retrieving evidence, calculating and verifying the answer…'
    );
    statusArea.appendChild(loadingBar);

    try {
      const data = await apiFetch('/ask', {
        method: 'POST',
        json: {
          question: textarea.value,
          mode: modeSelect.value,
          doc_id: docSelect.value || null
        }
      });
      statusArea.innerHTML = '';
      statusArea.appendChild(renderResult(data, modeSelect.value));
    } catch (e) {
      if (handleAuthError(e)) return;
      statusArea.innerHTML = '';
      statusArea.appendChild(el('div', { class: 'error-bar' },
        el('span', {}, '⚠ '),
        el('span', {}, e.message)
      ));
    } finally {
      btn.disabled = false;
      btn.textContent = '▶ Run Analysis';
    }
  }
}

function renderResult(data, mode) {
  const program = data.program || {};
  const steps = program.steps || [];
  const result = data.result ?? null;
  const isPercent = !!program.percent;
  const passed = !!data.passed;
  const rawAnswer = data.raw_answer || '';
  const citedIds = new Set((data.answer + ' ' + rawAnswer).match(/D\d+_C\d+/g) || []);

  // Build highlight numbers
  const hlNums = new Set();
  steps.forEach(s => (s.args || []).forEach(a => { if (typeof a === 'number') hlNums.add(Math.abs(a)); }));
  if (!hlNums.size) {
    const cleaned = (passed ? data.answer : rawAnswer).replace(/\[?\s*D\d+_C\d+\s*\]?/g, '');
    for (const m of cleaned.matchAll(NUM_RE)) {
      const v = toNum(m[0]);
      if (!(v >= 1900 && v <= 2100 && Number.isInteger(v))) hlNums.add(v);
    }
  }

  function renderAnswerText(text) {
    const parts = text.split(/(\[\s*D\d+_C\d+\s*\])/g);
    const frag = document.createDocumentFragment();
    parts.forEach((part, i) => {
      const m = part.match(/D\d+_C\d+/);
      if (m && /^\[/.test(part)) {
        const btn = el('button', { class: 'cite-btn', onclick: () => jumpToEvidence(m[0]) }, m[0]);
        frag.appendChild(btn);
      } else {
        frag.appendChild(document.createTextNode(part));
      }
    });
    return frag;
  }

  function jumpToEvidence(id) {
    state.openEv = id;
    const evItem = qs(`#ev-${id}`);
    if (evItem) {
      evItem.classList.add('open');
      evItem.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      // show body if not open
      const body = qs('.ev-body', evItem);
      if (!body) {
        const toggle = qs('.ev-toggle', evItem);
        if (toggle) toggle.click();
      }
    }
  }

  const workspace = el('div', { class: 'workspace' });
  const colMain = el('div', { class: 'col-main' });
  const colEvidence = el('div', { class: 'col-evidence' });

  // ── Answer Card ──
  const ansCard = el('div', { class: `card ${passed ? 'answer-passed' : 'answer-withheld'}` });
  const ansHeader = el('div', { class: 'card-header' },
    el('div', { class: 'card-title' },
      el('span', { class: 'card-title-dot' }),
      'Answer'
    ),
    el('span', { class: `verdict-badge ${passed ? 'pass' : 'fail'}` },
      passed ? '✓ Verified' : '✗ Withheld'
    )
  );
  const ansBody = el('div', { class: 'card-body' });

  if (passed) {
    const p = el('p', { class: 'answer-text' });
    p.appendChild(renderAnswerText(data.answer));
    ansBody.appendChild(p);
  } else {
    const p = el('p', { class: 'answer-text withheld-text' });
    p.textContent = data.answer;
    ansBody.appendChild(p);
    ansBody.appendChild(el('div', { class: 'withheld-note' },
      'The system withheld this answer because one or more verification checks failed.'
    ));
    if (rawAnswer) {
      const details = el('details', { class: 'draft-details' },
        el('summary', {}, 'Show withheld draft (unverified)'),
        el('p', { class: 'answer-text' })
      );
      qs('p', details).appendChild(renderAnswerText(rawAnswer));
      ansBody.appendChild(details);
    }
  }

  ansCard.append(ansHeader, ansBody);
  colMain.appendChild(ansCard);

  // ── Calculation Card ──
  if (steps.length && result !== null) {
    const calcCard = el('div', { class: 'card' });
    const calcHeader = el('div', { class: 'card-header' },
      el('div', { class: 'card-title' },
        el('span', { class: 'card-title-dot' }),
        'Calculation'
      )
    );
    const calcBody = el('div', { class: 'card-body' });

    const stepsList = el('ol', { class: 'calc-steps' });
    steps.forEach((s, i) => {
      stepsList.appendChild(el('li', {},
        el('span', { class: 'step-num' }, String(i + 1)),
        el('span', { class: 'step-op' }, s.op),
        el('span', { class: 'step-args' }, `(${(s.args || []).map(fmtArg).join(', ')})`)
      ));
    });
    calcBody.appendChild(stepsList);

    // Change pattern formula
    const isChange = steps.length === 2 && steps[0].op === 'subtract' && steps[1].op === 'divide' && steps[1].args?.[0] === '#0' && isPercent;
    if (isChange) {
      calcBody.appendChild(el('p', { class: 'formula-note' },
        `Formula: (${fmt(steps[0].args[0])} − ${fmt(steps[0].args[1])}) / ${fmt(steps[1].args[1])} × 100`
      ));
    }

    const resultRow = el('div', { class: 'result-row' },
      el('span', { class: 'result-label' }, 'Result'),
      el('span', { class: `result-value ${result < 0 ? 'neg' : ''}` },
        `${fmt(result, 2)}${isPercent ? '%' : ''}`
      )
    );
    calcBody.appendChild(resultRow);
    calcCard.append(calcHeader, calcBody);
    colMain.appendChild(calcCard);
  }

  // ── Verification Card ──
  const verCard = el('div', { class: 'card' });
  const verHeader = el('div', { class: 'card-header' },
    el('div', { class: 'card-title' },
      el('span', { class: 'card-title-dot' }),
      'Verification'
    )
  );
  const verBody = el('div', { class: 'card-body' });
  const checksList = el('ul', { class: 'checks-list' });
  Object.entries(data.checks || {}).forEach(([k, v]) => {
    checksList.appendChild(el('li', { class: v ? 'pass' : 'fail' },
      el('span', { class: `check-mark ${v ? 'pass' : 'fail'}` }, v ? '✓' : '✗'),
      CHECK_LABELS[k] || k.replace(/_/g, ' ')
    ));
  });
  verBody.appendChild(checksList);

  const modeName = MODES.find(m => m[0] === mode)?.[1] || mode;
  const chips = el('div', { class: 'meta-chips' },
    el('div', { class: 'meta-chip' }, 'Coverage: ', el('strong', {}, `${data.evidence_coverage ?? '?'}%`)),
    el('div', { class: 'meta-chip' }, 'Type: ', el('strong', {}, data.question_type || 'unknown')),
    el('div', { class: 'meta-chip' }, 'Mode: ', el('strong', {}, modeName))
  );
  verBody.appendChild(chips);
  verCard.append(verHeader, verBody);
  colMain.appendChild(verCard);

  // ── Evidence Panel ──
  const evidenceCard = el('div', { class: 'card evidence-panel' });
  const evHeader = el('div', { class: 'card-header' },
    el('div', { class: 'card-title' },
      el('span', { class: 'card-title-dot' }),
      `Evidence (${data.evidence.length})`
    )
  );
  const evBody = el('div', { class: 'card-body', style: 'padding:12px' });

  if (hlNums.size) {
    evBody.appendChild(el('div', { class: 'hl-note' },
      '🟡 Highlighted figures are calculation inputs or values stated in the answer.'
    ));
  }

  const evList = el('div', { class: 'evidence-list' });

  const firstCited = ([...citedIds][0]) || data.evidence[0]?.id;

  data.evidence.forEach(ev => {
    const meta = parseMeta(ev.text);
    const isCited = citedIds.has(ev.id);
    const truncated = ev.text.length >= 3990;

    const item = el('div', { class: `ev-item ${isCited ? 'cited' : ''}`, id: `ev-${ev.id}` });

    const metaLabel = [meta.company, meta.year, meta.page && `p.${meta.page}`].filter(Boolean).join(' · ');

    const toggleBtn = el('button', { class: 'ev-toggle' },
      el('span', { class: 'ev-id' }, ev.id),
      el('span', { class: `ev-type ${ev.type}` }, ev.type),
      isCited ? el('span', { class: 'ev-cited-badge' }, 'cited') : null,
      metaLabel ? el('span', { class: 'ev-meta' }, metaLabel) : null,
      el('span', { class: 'ev-chevron' }, '▼')
    );

    let bodyEl = null;

    toggleBtn.addEventListener('click', () => {
      const isOpen = item.classList.contains('open');
      if (isOpen) {
        item.classList.remove('open');
        if (bodyEl) { bodyEl.remove(); bodyEl = null; }
      } else {
        item.classList.add('open');
        bodyEl = el('div', { class: 'ev-body' });
        if (ev.type === 'table') {
          bodyEl.appendChild(renderEvidenceTable(meta.body, hlNums));
        } else {
          const pre = el('p', { class: 'ev-excerpt' });
          pre.appendChild(highlightNums(meta.body, hlNums));
          bodyEl.appendChild(pre);
        }
        if (truncated) bodyEl.appendChild(el('p', { class: 'trunc-note' }, 'Excerpt truncated by the backend.'));
        item.appendChild(bodyEl);
      }
    });

    item.appendChild(toggleBtn);
    evList.appendChild(item);

    // auto-open first cited
    if (ev.id === firstCited) {
      setTimeout(() => toggleBtn.click(), 50);
    }
  });

  evBody.appendChild(evList);
  evidenceCard.append(evHeader, evBody);
  colEvidence.appendChild(evidenceCard);

  workspace.append(colMain, colEvidence);
  return workspace;
}

function renderEvidenceTable(body, nums) {
  const rows = parseTable(body);
  if (rows.length < 2) {
    const pre = el('p', { class: 'ev-excerpt' });
    pre.appendChild(highlightNums(body, nums));
    return pre;
  }
  const [head, ...rest] = rows;
  const wrap = el('div', { class: 'ev-table-wrap' });
  const table = el('table', { class: 'ev-table' });
  const thead = el('thead', {}, el('tr', {}, ...head.map(h => el('th', {}, h))));
  const tbody = el('tbody', {}, ...rest.map(r =>
    el('tr', {}, ...r.map(c => {
      const td = el('td', { class: isNumeric(c) ? 'num' : '' });
      td.appendChild(highlightNums(c, nums));
      return td;
    }))
  ));
  table.append(thead, tbody);
  wrap.appendChild(table);
  return wrap;
}

// ═══════════════════════════════════════════════════════════════════════════
//  COMPARE PANE
// ═══════════════════════════════════════════════════════════════════════════
const MODE_LABELS = {
  bm25: 'BM25 Only',
  dense: 'Dense Only',
  hybrid: 'Hybrid (Rank Fusion)',
  hybrid_rerank: 'Hybrid + Rerank',
};

function initComparePane(pane) {
  const header = el('div', { class: 'section-header' },
    el('h2', {}, '⚡ Compare Retrieval Modes'),
    el('p', {}, 'Shows the top-5 passages from each retrieval mode for the same question. No language model is called.')
  );

  const panel = el('div', { class: 'ask-panel' });
  const textarea = el('textarea', {
    placeholder: 'Enter a question to compare retrieval modes…',
    'aria-label': 'Question',
    style: 'min-height:80px'
  });
  const controls = el('div', { class: 'ask-controls', style: 'justify-content:flex-end;margin-top:16px' },
    el('button', { class: 'btn btn-primary', onclick: runCompare }, '⚡ Compare Modes')
  );
  panel.append(textarea, controls);

  const resultsArea = el('div', { id: 'compare-results' });
  pane.append(header, panel, resultsArea);

  async function runCompare() {
    if (!textarea.value.trim()) return;
    resultsArea.innerHTML = '';
    resultsArea.appendChild(el('div', { class: 'status-bar' },
      el('div', { class: 'spinner' }),
      'Comparing retrieval modes…'
    ));
    try {
      const data = await apiFetch('/compare', {
        method: 'POST',
        json: { question: textarea.value }
      });
      resultsArea.innerHTML = '';
      const grid = el('div', { class: 'compare-grid' });
      Object.keys(MODE_LABELS).forEach(k => {
        const chunks = data[k] || [];
        const card = el('div', { class: 'compare-mode-card' });
        const modeHeader = el('div', { class: 'compare-mode-header' },
          el('span', { class: `mode-badge ${k}` }, MODE_LABELS[k])
        );
        const list = el('div', { class: 'compare-chunk-list' });
        chunks.forEach((c, i) => {
          list.appendChild(el('div', { class: 'compare-chunk' },
            el('div', { class: 'compare-chunk-header' },
              el('span', { class: 'chunk-rank' }, String(i + 1)),
              el('span', { class: 'ev-id' }, c.id),
              el('span', { class: `ev-type ${c.type}` }, c.type)
            ),
            el('p', { class: 'compare-chunk-text' }, c.text + '…')
          ));
        });
        card.append(modeHeader, list);
        grid.appendChild(card);
      });
      resultsArea.appendChild(grid);
    } catch (e) {
      if (handleAuthError(e)) return;
      resultsArea.innerHTML = '';
      resultsArea.appendChild(el('div', { class: 'error-bar' }, '⚠ ', e.message));
    }
  }
}

// ═══════════════════════════════════════════════════════════════════════════
//  EVAL PANE
// ═══════════════════════════════════════════════════════════════════════════
function initEvalPane(pane) {
  const header = el('div', { class: 'section-header' },
    el('h2', {}, '📈 Evaluation Metrics'),
    el('p', {}, 'Benchmark results on the FinQA subset of T²-RAGBench. Read from saved evaluation files.')
  );
  const placeholder = el('div', { class: 'empty-state' },
    el('div', { class: 'empty-icon' }, '📊'),
    el('p', {}, 'Metrics will load when you switch to this tab.')
  );
  pane.append(header, placeholder);
}

function loadEval(pane) {
  // Remove placeholder
  const ph = qs('.empty-state', pane);
  if (ph) ph.remove();

  const loadDiv = el('div', { class: 'status-bar' },
    el('div', { class: 'spinner' }), 'Loading evaluation metrics…'
  );
  pane.appendChild(loadDiv);

  apiFetch('/metrics').then(m => {
    pane.removeChild(loadDiv);
    pane.appendChild(renderMetrics(m));
  }).catch(e => {
    pane.removeChild(loadDiv);
    if (handleAuthError(e)) return;
    pane.appendChild(el('div', { class: 'error-bar' }, '⚠ ', e.message));
  });
}

function pct(k, n) { return n ? `${((100 * k) / n).toFixed(1)}%` : 'n/a'; }

function renderMetrics(m) {
  const container = el('div');
  const main = m?.main, r = m?.retrieval, s = m?.sufficiency;

  if (!main && !r && !s) {
    container.appendChild(el('div', { class: 'empty-state' },
      el('div', { class: 'empty-icon' }, '📭'),
      el('p', {}, 'No evaluation data found. Run the evaluation scripts first (backend/evaluate.py).')
    ));
    return container;
  }

  const grid = el('div', { class: 'metrics-grid' });

  // Accuracy table
  if (main) {
    const rows = [
      ['A: Direct LLM', main.A, false],
      ['B: Basic RAG', main.B, false],
      ['C: Hybrid + rerank + page exp.', main.C, false],
      ['D before verifier (raw answers)', main.D_raw, false],
      ['D: FinRAG-X (verified)', main.D, true],
    ];

    const accCard = el('div', { class: 'metric-card', style: 'grid-column: 1 / -1' });
    accCard.appendChild(el('div', { class: 'metric-card-title' }, `Answer Accuracy — ${main.n} questions`));
    const table = el('table', { class: 'metric-table' });
    table.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'System'), el('th', {}, 'Correct'), el('th', {}, 'Accuracy'), el('th', {}, 'Progress')
    )));
    const tbody = el('tbody');
    rows.forEach(([label, k, highlight]) => {
      const p = main.n ? (100 * k / main.n) : 0;
      const tr = el('tr', { class: highlight ? 'highlight' : '' },
        el('td', {}, label),
        el('td', { class: 'num' }, `${k}/${main.n}`),
        el('td', { class: 'num' }, pct(k, main.n)),
        el('td', {},
          el('div', { class: 'acc-bar-wrap' },
            el('div', { class: 'acc-bar' },
              el('div', { class: 'acc-bar-fill', style: `width:${p}%` })
            ),
            el('span', { class: 'acc-pct' }, `${p.toFixed(1)}%`)
          )
        )
      );
      tbody.appendChild(tr);
    });
    table.appendChild(tbody);
    accCard.appendChild(table);
    grid.appendChild(accCard);

    // Abstention card
    const abCard = el('div', { class: 'metric-card' });
    abCard.appendChild(el('div', { class: 'metric-card-title' }, 'Abstention (FinRAG-X Verifier)'));
    const abTable = el('table', { class: 'metric-table' });
    const abBody = el('tbody');
    [
      ['Total refused', `${main.refused}/${main.n}`],
      ['Abstention precision (blocked wrong)', `${main.blocked_wrong}/${main.refused} = ${pct(main.blocked_wrong, main.refused)}`],
      ['Abstention recall (wrong answers blocked)', `${main.blocked_wrong}/${main.raw_wrong} = ${pct(main.blocked_wrong, main.raw_wrong)}`],
      ['False-refusal (correct answers blocked)', `${main.blocked_correct}/${main.n - main.raw_wrong} = ${pct(main.blocked_correct, main.n - main.raw_wrong)}`],
    ].forEach(([label, val]) => {
      abBody.appendChild(el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, val)));
    });
    abTable.appendChild(abBody);
    abCard.appendChild(abTable);
    grid.appendChild(abCard);
  }

  // Retrieval card
  if (r) {
    const retCard = el('div', { class: 'metric-card' });
    retCard.appendChild(el('div', { class: 'metric-card-title' }, `Retrieval — ${r.n} questions, gold page in top-k`));
    const retTable = el('table', { class: 'metric-table' });
    retTable.appendChild(el('thead', {}, el('tr', {},
      el('th', {}, 'Mode'), el('th', {}, 'Recall@5'), el('th', {}, 'Recall@10'), el('th', {}, 'Avg Latency')
    )));
    const retBody = el('tbody');
    Object.entries(r.modes).forEach(([k, v]) => {
      retBody.appendChild(el('tr', {},
        el('td', {}, MODE_LABELS[k] || k),
        el('td', { class: 'num' }, pct(v.r5, r.n)),
        el('td', { class: 'num' }, pct(v.r10, r.n)),
        el('td', { class: 'num' }, `${v.latency}s`)
      ));
    });
    retTable.appendChild(retBody);
    retCard.appendChild(retTable);
    grid.appendChild(retCard);
  }

  // Sufficiency card
  if (s) {
    const sufCard = el('div', { class: 'metric-card' });
    sufCard.appendChild(el('div', { class: 'metric-card-title' }, `Evidence Sufficiency — ${s.n} questions`));
    const sufTable = el('table', { class: 'metric-table' });
    const sufBody = el('tbody');
    [
      ['Answerable, judged sufficient', `${s.sufficient_with_gold}/${s.n}`],
      ['Unanswerable, flagged insufficient', `${s.insufficient_without_gold}/${s.n} = ${pct(s.insufficient_without_gold, s.n)}`],
      ['False-refusal rate', `${s.n - s.sufficient_with_gold}/${s.n} = ${pct(s.n - s.sufficient_with_gold, s.n)}`],
    ].forEach(([label, val]) => {
      sufBody.appendChild(el('tr', {}, el('td', {}, label), el('td', { class: 'num' }, val)));
    });
    sufTable.appendChild(sufBody);
    sufCard.appendChild(sufTable);
    grid.appendChild(sufCard);
  }

  container.appendChild(grid);
  return container;
}

// ─── Boot ─────────────────────────────────────────────────────────────────────
document.addEventListener('DOMContentLoaded', renderRoot);
