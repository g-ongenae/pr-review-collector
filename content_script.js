// content_script.js
// Injected on every GitHub PR page. Scrapes reviews and injects the sidebar.

(function () {
  if (document.getElementById('prc-sidebar')) return; // already injected

  // ── Sidebar injection ────────────────────────────────────────────────────
  const sidebar = document.createElement('div');
  sidebar.id = 'prc-sidebar';
  sidebar.innerHTML = getSidebarHTML();
  document.body.appendChild(sidebar);

  // Toggle button (floating)
  const toggle = document.createElement('button');
  toggle.id = 'prc-toggle';
  toggle.title = 'PR Review Collector';
  toggle.textContent = '📋';
  document.body.appendChild(toggle);

  toggle.addEventListener('click', () => {
    sidebar.classList.toggle('prc-open');
    if (sidebar.classList.contains('prc-open')) loadReviews();
  });

  // ── Review scraping ──────────────────────────────────────────────────────
  function scrapeReviews() {
    const reviews = [];

    // ── 1. Inline file review comments (standard PR diff comments) ──────────
    document.querySelectorAll('.review-comment, .inline-comment-form-container').forEach(el => {
      const comment = extractInlineComment(el);
      if (comment && !isNoiseComment(comment)) reviews.push(comment);
    });

    // ── 2. PR-level review comments (conversation tab) ────────────────────
    document.querySelectorAll('.comment-body').forEach(el => {
      const wrapper = el.closest('.js-timeline-item, .timeline-comment-wrapper');
      if (!wrapper) return;
      // Skip if already captured as inline
      if (wrapper.closest('.review-comment')) return;
      const c = extractConversationComment(el, wrapper);
      if (c && !isNoiseComment(c)) reviews.push(c);
    });

    // ── 3. SonarQube / SonarCloud annotations ────────────────────────────
    document.querySelectorAll('[data-sonar-issue], .sonar-review-comment').forEach(el => {
      const c = extractSonarComment(el);
      if (c) reviews.push(c);
    });

    // Deduplicate by a rough key
    const seen = new Set();
    return reviews.filter(r => {
      const key = `${r.file}|${r.lines}|${r.author}|${r.comment.slice(0, 40)}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }

  // ── Inline diff comment ──────────────────────────────────────────────────
  function extractInlineComment(el) {
    const body = el.querySelector('.comment-body, .js-comment-body');
    if (!body) return null;

    const authorEl = el.querySelector('.author');
    const author = authorEl ? authorEl.innerText.trim() : 'unknown';

    // File path from nearest file header
    let file = '';
    let linesText = '';
    const fileHeader = el.closest('.file') || el.closest('[data-path]');
    if (fileHeader) {
      const pathEl = fileHeader.querySelector('.file-header [data-path], .file-info a, .Truncate');
      file = pathEl ? pathEl.getAttribute('title') || pathEl.innerText.trim() : '';
    }

    // Line numbers from the table row
    const row = el.closest('tr');
    if (row) {
      const lineNums = row.querySelectorAll('.blob-num');
      if (lineNums.length >= 2) {
        linesText = `L${lineNums[0].dataset.lineNumber || '?'}-L${lineNums[lineNums.length - 1].dataset.lineNumber || '?'}`;
      } else if (lineNums.length === 1) {
        linesText = `L${lineNums[0].dataset.lineNumber || '?'}`;
      }
    }

    // Suggested change block — extract diff with +/- markers
    let suggestion = '';
    const suggestContainer = el.querySelector('.js-suggested-changes-container') || el.querySelector('.js-suggested-changes-blob');
    if (suggestContainer) {
      suggestion = extractSuggestionDiff(suggestContainer);
    }

    // Extract comment text, stripping suggestion blocks and UI artifacts
    const cleanBody = body.cloneNode(true);
    // Remove suggestion containers, buttons, and interactive elements
    cleanBody.querySelectorAll([
      '.js-suggested-changes-container', '.js-suggested-changes-blob',
      '.suggested-changes-container', '.blob-wrapper',
      '.js-comment-edit-button', '.review-simple-reply-button',
      'button', '.btn', '[data-hotkey]', '[role="button"]',
      '.suggested-changes-header', '.js-suggestion-diff-header'
    ].join(', ')).forEach(n => n.remove());
    let commentText = cleanBody.innerText.trim();
    // Strip any remaining GitHub suggestion UI noise via text cleanup
    commentText = commentText
      .replace(/^Suggested change\s*/gim, '')
      .replace(/^Commit suggestion\s*/gim, '')
      .replace(/^Add suggestion to batch\s*/gim, '')
      .trim();
    if (!commentText) return null;

    // Severity type heuristics (SonarQube / Copilot label tags)
    const type = detectType(el, commentText);

    return { file, lines: linesText, author, type, comment: commentText, suggestion, decision: '', note: '' };
  }

  // Extract suggestion diff with +/- markers from GitHub's suggestion container
  function extractSuggestionDiff(container) {
    const lines = [];

    // GitHub renders suggestion diffs as table rows with background colors.
    // Try multiple selector strategies to find deletion/addition rows.
    const rows = container.querySelectorAll('tr, .blob-code-inner');

    if (rows.length) {
      rows.forEach(row => {
        // Check class names and background styles for deletion/addition markers
        const cls = row.className || '';
        const codeEl = row.querySelector('.blob-code-inner') || row;
        const text = codeEl.innerText;
        if (!text || !text.trim()) return;

        if (/deletion|removed/i.test(cls) || row.querySelector('.blob-code-deletion')) {
          lines.push('- ' + text);
        } else if (/addition|added/i.test(cls) || row.querySelector('.blob-code-addition')) {
          lines.push('+ ' + text);
        } else if (/context|unchanged/i.test(cls)) {
          lines.push('  ' + text);
        }
      });
    }

    if (lines.length) return lines.join('\n');

    // Fallback: extract raw text and strip UI noise before returning
    let raw = container.innerText.trim();
    raw = raw
      .replace(/^Suggested change\s*/im, '')
      .replace(/Commit suggestion\s*/im, '')
      .replace(/Add suggestion to batch\s*/im, '')
      .trim();
    return raw;
  }

  // ── Conversation-level comment ───────────────────────────────────────────
  function extractConversationComment(body, wrapper) {
    const text = body.innerText.trim();
    if (!text || text.length < 5) return null;

    const authorEl = wrapper.querySelector('.author');
    const author = authorEl ? authorEl.innerText.trim() : 'unknown';

    // Skip bot noise like "approved these changes"
    if (/approved these changes|requested changes|merged|closed|reopened/i.test(text) && text.length < 60) return null;

    const type = detectType(wrapper, text);
    return { file: '', lines: '', author, type, comment: text, suggestion: '', decision: '', note: '' };
  }

  // ── Sonar annotation (best-effort) ───────────────────────────────────────
  function extractSonarComment(el) {
    const text = el.innerText.trim();
    if (!text) return null;
    const severity = el.dataset.severity || el.getAttribute('data-severity') || '';
    return {
      file: el.dataset.file || '',
      lines: el.dataset.line ? `L${el.dataset.line}` : '',
      author: 'SonarQube',
      type: normalizeSeverity(severity),
      comment: text,
      suggestion: '',
      decision: '',
      note: ''
    };
  }

  // ── Noise filter — skip GitHub UI artefacts that aren't real comments ─
  const NOISE_PATTERNS = /^(preview|nothing to preview|write|leave a comment|add a comment|add your comment|comment|cancel|submit|close issue|close pull request|update comment)$/i;

  function isNoiseComment(r) {
    const text = r.comment.trim();
    // Filter out short UI-text artefacts, especially from unknown authors
    if (NOISE_PATTERNS.test(text)) return true;
    // Multi-token noise: lines that are only GitHub tab/button labels
    const lines = text.split('\n').map(l => l.trim()).filter(Boolean);
    if (lines.length <= 3 && lines.every(l => NOISE_PATTERNS.test(l))) return true;
    return false;
  }

  // ── Type detection helpers ────────────────────────────────────────────────
  function detectType(el, text) {
    const label = el.querySelector('.Label, .label, [data-severity], .severity') ;
    if (label) {
      const t = label.innerText.trim();
      return normalizeSeverity(t);
    }
    // Copilot/Sonar prefixes in comment text
    const prefixMatch = text.match(/^(Nit|Low|Medium|High|Critical|Major|Minor|Info|Suggestion)[:.\s]/i);
    if (prefixMatch) return normalizeSeverity(prefixMatch[1]);
    return '';
  }

  function normalizeSeverity(raw) {
    const map = { critical: 'High', major: 'Medium', minor: 'Low', info: 'Nit', suggestion: 'Nit', nit: 'Nit', low: 'Low', medium: 'Medium', high: 'High' };
    return map[(raw || '').toLowerCase()] || raw || '';
  }

  // ── PR metadata ───────────────────────────────────────────────────────────
  function getPRMeta() {
    const title = document.querySelector('.js-issue-title, h1.gh-header-title .js-issue-title, .markdown-title')?.innerText.trim() || '';
    const branch = document.querySelector('.head-ref, .commit-ref:last-child span')?.innerText.trim() || '';
    const url = window.location.href;
    const descEl = document.querySelector('.comment-body .js-comment-body');
    const description = descEl ? descEl.innerText.trim() : '';
    return { url, title, branch, description };
  }

  // ── Sidebar HTML ──────────────────────────────────────────────────────────
  function getSidebarHTML() {
    return `
      <div id="prc-header">
        <span id="prc-title">PR Review Collector</span>
        <button id="prc-refresh" title="Re-scrape page">↺</button>
        <button id="prc-close" title="Close">✕</button>
      </div>
      <div id="prc-meta-box">
        <div id="prc-meta-info"></div>
      </div>
      <div id="prc-list"></div>
      <div id="prc-footer">
        <button id="prc-copy">📋 Copy to clipboard</button>
      </div>
      <div id="prc-toast" class="prc-hidden">Copied!</div>
    `;
  }

  // ── Load / render reviews ─────────────────────────────────────────────────
  let reviews = [];

  function loadReviews() {
    reviews = scrapeReviews();
    // Restore saved decisions from session storage
    const saved = JSON.parse(sessionStorage.getItem('prc-decisions') || '{}');
    reviews.forEach((r, i) => {
      if (saved[i]) { r.decision = saved[i].decision; r.note = saved[i].note; }
    });
    renderMeta();
    renderList();
  }

  function renderMeta() {
    const meta = getPRMeta();
    const box = document.getElementById('prc-meta-info');
    box.innerHTML = `
      <strong>${escHtml(meta.title || 'Pull Request')}</strong><br>
      <span>Branch: ${escHtml(meta.branch || '–')}</span><br>
      <span>${reviews.length} comment${reviews.length !== 1 ? 's' : ''} found</span>
    `;
  }

  function renderList() {
    const list = document.getElementById('prc-list');
    if (!reviews.length) {
      list.innerHTML = '<p class="prc-empty">No review comments found on this page.<br>Make sure you\'re on the "Files changed" or "Conversation" tab.</p>';
      return;
    }
    list.innerHTML = reviews.map((r, i) => renderCard(r, i)).join('');
    list.querySelectorAll('.prc-decision-select').forEach(sel => {
      sel.addEventListener('change', e => updateDecision(+e.target.dataset.idx, 'decision', e.target.value));
    });
    list.querySelectorAll('.prc-note-input').forEach(inp => {
      inp.addEventListener('input', e => updateDecision(+e.target.dataset.idx, 'note', e.target.value));
    });
  }

  function renderCard(r, i) {
    const DECISIONS = ['', 'Apply', 'Fix', 'Explain', 'Plan fix', 'Investigate', 'Ignore', 'Other'];
    const opts = DECISIONS.map(d => `<option value="${d}" ${r.decision === d ? 'selected' : ''}>${d || '— pick decision —'}</option>`).join('');
    const ignClass = r.decision === 'Ignore' ? ' prc-card-ignored' : '';
    return `
      <div class="prc-card${ignClass}" data-idx="${i}">
        <div class="prc-card-meta">
          ${r.file ? `<span class="prc-file" title="${escHtml(r.file)}">${escHtml(shortenPath(r.file))}</span>` : ''}
          ${r.lines ? `<span class="prc-lines">${escHtml(r.lines)}</span>` : ''}
          <span class="prc-author">${escHtml(r.author)}</span>
          ${r.type ? `<span class="prc-type prc-type-${(r.type || '').toLowerCase()}">${escHtml(r.type)}</span>` : ''}
        </div>
        <div class="prc-comment">${escHtml(r.comment)}</div>
        ${r.suggestion ? `<div class="prc-suggestion"><em>Suggested change:</em><pre>${formatSuggestionHtml(r.suggestion)}</pre></div>` : ''}
        <div class="prc-decision-row">
          <select class="prc-decision-select" data-idx="${i}">${opts}</select>
          <input class="prc-note-input" data-idx="${i}" type="text" placeholder="Optional note…" value="${escHtml(r.note)}">
        </div>
      </div>
    `;
  }

  function updateDecision(i, field, val) {
    reviews[i][field] = val;
    // Persist to session storage
    const saved = JSON.parse(sessionStorage.getItem('prc-decisions') || '{}');
    saved[i] = { decision: reviews[i].decision, note: reviews[i].note };
    sessionStorage.setItem('prc-decisions', JSON.stringify(saved));
    // Toggle ignored style
    const card = document.querySelector(`.prc-card[data-idx="${i}"]`);
    if (card) card.classList.toggle('prc-card-ignored', reviews[i].decision === 'Ignore');
  }

  // ── Output builder ────────────────────────────────────────────────────────
  function buildOutput() {
    const meta = getPRMeta();
    const active = reviews.filter(r => r.decision && r.decision !== 'Ignore');

    const lines = [];
    lines.push('# PR Reviews — human decisions for Claude');
    lines.push('');
    lines.push('Here is the list of pull request review comments with human decisions.');
    lines.push('For each item, apply the stated decision. Ask for any missing information');
    lines.push('before implementing changes. List all the actions you will take before');
    lines.push('starting, and update the TODO list as you go.');
    lines.push('');
    lines.push('## PR metadata');
    lines.push('');
    lines.push(`- **URL**: ${meta.url}`);
    lines.push(`- **Title**: ${meta.title || '(not found)'}`);
    lines.push(`- **Branch**: ${meta.branch || '(not found)'}`);
    if (meta.description) {
      lines.push(`- **Description**: ${meta.description.replace(/\n/g, ' ')}`);
    }
    lines.push('');
    lines.push('## Reviews');
    lines.push('');

    if (!active.length) {
      lines.push('_No reviews with a non-Ignore decision found._');
    } else {
      active.forEach((r, i) => {
        lines.push(`### Review ${i + 1}`);
        lines.push('');
        if (r.file)  lines.push(`- **File**: \`${r.file}\``);
        if (r.lines) lines.push(`- **Lines**: ${r.lines}`);
        if (r.author) lines.push(`- **Author**: ${r.author}`);
        if (r.type)  lines.push(`- **Type**: ${r.type}`);
        if (r.suggestion) {
          lines.push('- **Suggested change**:');
          lines.push('  ```diff');
          r.suggestion.split('\n').forEach(l => lines.push('  ' + l));
          lines.push('  ```');
        }
        lines.push('- **Comment**:');
        r.comment.split('\n').forEach(l => lines.push('  > ' + l));
        const humanDecision = r.note ? `${r.decision} / ${r.note}` : r.decision;
        lines.push(`- **Human decision**: ${humanDecision}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  // ── Wire up sidebar buttons ───────────────────────────────────────────────
  document.getElementById('prc-close').addEventListener('click', () => sidebar.classList.remove('prc-open'));
  document.getElementById('prc-refresh').addEventListener('click', loadReviews);

  document.getElementById('prc-copy').addEventListener('click', () => {
    const text = buildOutput();
    navigator.clipboard.writeText(text).then(() => {
      const toast = document.getElementById('prc-toast');
      toast.classList.remove('prc-hidden');
      setTimeout(() => toast.classList.add('prc-hidden'), 2200);
    }).catch(() => {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
    });
  });

  // ── Utilities ─────────────────────────────────────────────────────────────
  function escHtml(s) {
    return (s || '').replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
  }

  function formatSuggestionHtml(suggestion) {
    return suggestion.split('\n').map(l => {
      const escaped = escHtml(l);
      if (l.startsWith('- ')) return `<span class="prc-diff-del">${escaped}</span>`;
      if (l.startsWith('+ ')) return `<span class="prc-diff-add">${escaped}</span>`;
      return escaped;
    }).join('\n');
  }

  function shortenPath(p) {
    const parts = p.split('/');
    if (parts.length <= 2) return p;
    return '…/' + parts.slice(-2).join('/');
  }
})();
