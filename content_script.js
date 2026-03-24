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

  // ── Ignored authors ─────────────────────────────────────────────────────
  const IGNORED_AUTHORS_KEY = 'prc-ignored-authors';
  const DEFAULT_IGNORED_AUTHORS = ['notion-workspace', 'nx-cloud'];

  function getIgnoredAuthors() {
    const stored = localStorage.getItem(IGNORED_AUTHORS_KEY);
    if (stored) return JSON.parse(stored);
    localStorage.setItem(IGNORED_AUTHORS_KEY, JSON.stringify(DEFAULT_IGNORED_AUTHORS));
    return DEFAULT_IGNORED_AUTHORS;
  }

  function saveIgnoredAuthors(list) {
    localStorage.setItem(IGNORED_AUTHORS_KEY, JSON.stringify(list));
  }

  function isIgnoredAuthor(author) {
    return getIgnoredAuthors().some(a => a.toLowerCase() === (author || '').toLowerCase());
  }

  // ── Review scraping ──────────────────────────────────────────────────────
  function scrapeReviews() {
    const reviews = [];

    // ── 1. Review threads (groups linked comments together) ──────────────
    const processedThreads = new Set();
    document.querySelectorAll('.review-thread-component, .js-resolvable-timeline-thread-container').forEach(thread => {
      if (processedThreads.has(thread)) return;
      processedThreads.add(thread);
      const commentEls = thread.querySelectorAll('.review-comment');
      if (!commentEls.length) return;
      // First comment is the main review
      const main = extractInlineComment(commentEls[0]);
      if (!main || isNoiseComment(main) || isIgnoredAuthor(main.author)) return;
      // Remaining comments are replies
      main.replies = [];
      for (let i = 1; i < commentEls.length; i++) {
        const reply = extractReply(commentEls[i]);
        if (reply && !isNoiseComment(reply) && !isIgnoredAuthor(reply.author)) {
          main.replies.push(reply);
        }
      }
      reviews.push(main);
    });
    // Catch any orphan .review-comment not inside a thread container
    document.querySelectorAll('.review-comment').forEach(el => {
      if (el.closest('.review-thread-component, .js-resolvable-timeline-thread-container')) return;
      const comment = extractInlineComment(el);
      if (comment && !isNoiseComment(comment) && !isIgnoredAuthor(comment.author)) {
        comment.replies = [];
        reviews.push(comment);
      }
    });

    // ── 2. React-based "Files changed" / "changes" page ────────────────────
    document.querySelectorAll('[data-testid="review-thread"]').forEach(thread => {
      const main = extractChangesPageComment(thread);
      if (!main || isNoiseComment(main) || isIgnoredAuthor(main.author)) return;
      main.replies = [];
      // Replies are [data-first-thread-comment="false"]
      thread.querySelectorAll('[data-first-thread-comment="false"]').forEach(replyEl => {
        const reply = extractChangesPageReply(replyEl);
        if (reply && !isNoiseComment(reply) && !isIgnoredAuthor(reply.author)) {
          main.replies.push(reply);
        }
      });
      reviews.push(main);
    });

    // ── 3. PR-level review comments (conversation tab) ────────────────────
    document.querySelectorAll('.comment-body').forEach(el => {
      const wrapper = el.closest('.js-timeline-item, .timeline-comment-wrapper');
      if (!wrapper) return;
      // Skip if already captured as inline review comment
      if (el.closest('.review-comment, .js-line-comments, .js-inline-comments-container')) return;
      const c = extractConversationComment(el, wrapper);
      if (c && !isNoiseComment(c) && !isIgnoredAuthor(c.author)) reviews.push(c);
    });

    // ── 4. SonarQube / SonarCloud annotations ────────────────────────────
    document.querySelectorAll('[data-sonar-issue], .sonar-review-comment').forEach(el => {
      const c = extractSonarComment(el);
      if (c) reviews.push(c);
    });

    // Deduplicate by a rough key
    const seen = new Set();
    return reviews.filter(r => {
      const key = `${r.author}|${r.comment.slice(0, 60)}`;
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

    // File path: try multiple strategies for GitHub's DOM
    let file = '';
    let linesText = '';
    // Strategy 1: hidden input[name="path"] in the suggestion commit form (most reliable)
    const pathInput = el.querySelector('input[name="path"]')
      || el.closest('.js-line-comments')?.querySelector('input[name="path"]');
    if (pathInput) {
      file = pathInput.value;
    }
    // Strategy 2: conversation tab — the review thread <details> has a <summary> with a file link
    if (!file) {
      const reviewThread = el.closest('.review-thread-component, .js-resolvable-timeline-thread-container');
      if (reviewThread) {
        const fileLink = reviewThread.querySelector('summary a.text-mono');
        if (fileLink) file = fileLink.innerText.trim();
      }
    }
    // Strategy 3: classic diff view — comment is inside a .file container
    if (!file) {
      const fileHeader = el.closest('.file') || el.closest('[data-path]');
      if (fileHeader) {
        const pathEl = fileHeader.querySelector('.file-header [data-path], .file-info a, .Truncate');
        file = pathEl ? pathEl.getAttribute('title') || pathEl.innerText.trim() : '';
      }
    }

    // Line numbers: extract from the diff table in the review thread
    // Strategy 1: conversation tab — diff table is in .blob-wrapper sibling
    const reviewThread = el.closest('.review-thread-component, .js-resolvable-timeline-thread-container');
    if (reviewThread) {
      const lineNumCells = reviewThread.querySelectorAll('.blob-num[data-line-number]');
      if (lineNumCells.length) {
        const nums = Array.from(lineNumCells).map(td => td.dataset.lineNumber).filter(Boolean);
        const first = nums[0];
        const last = nums[nums.length - 1];
        linesText = first === last ? `L${first}` : `L${first}-L${last}`;
      }
    }
    // Strategy 2: classic diff view — comment is inside a <tr>
    if (!linesText) {
      const row = el.closest('tr');
      if (row) {
        const lineNums = row.querySelectorAll('.blob-num[data-line-number]');
        if (lineNums.length >= 2) {
          linesText = `L${lineNums[0].dataset.lineNumber}-L${lineNums[lineNums.length - 1].dataset.lineNumber}`;
        } else if (lineNums.length === 1) {
          linesText = `L${lineNums[0].dataset.lineNumber}`;
        }
      }
    }

    // Suggested change block
    let suggestion = '';
    const suggestBlob = el.querySelector('.js-suggested-changes-blob');
    if (suggestBlob) {
      suggestion = extractSuggestionDiff(suggestBlob);
    }

    // Extract comment text, stripping the suggestion blob (which contains
    // the diff table, "Suggested change" header, and action buttons)
    const cleanBody = body.cloneNode(true);
    cleanBody.querySelectorAll('.js-suggested-changes-blob, .js-suggested-changes-container').forEach(n => n.remove());
    const commentText = cleanBody.innerText.trim();
    if (!commentText) return null;

    // Severity type heuristics (SonarQube / Copilot label tags)
    const type = detectType(el, commentText);

    return { file, lines: linesText, author, type, comment: commentText, suggestion, replies: [], decision: '', note: '' };
  }

  // Extract a reply comment (lightweight — just author + text)
  function extractReply(el) {
    const body = el.querySelector('.comment-body, .js-comment-body');
    if (!body) return null;
    const authorEl = el.querySelector('.author');
    const author = authorEl ? authorEl.innerText.trim() : 'unknown';
    const cleanBody = body.cloneNode(true);
    cleanBody.querySelectorAll('.js-suggested-changes-blob, .js-suggested-changes-container').forEach(n => n.remove());
    const comment = cleanBody.innerText.trim();
    if (!comment) return null;
    return { author, comment };
  }

  // ── React-based "Files changed" page extractors ────────────────────────
  function extractChangesPageComment(thread) {
    const firstComment = thread.querySelector('[data-first-thread-comment="true"]');
    if (!firstComment) return null;

    // Author
    const authorEl = firstComment.querySelector('[data-testid="avatar-link"], [class*="AuthorName"]');
    const author = authorEl ? authorEl.innerText.trim() : 'unknown';

    // Comment body
    const bodyEl = firstComment.querySelector('.markdown-body');
    if (!bodyEl) return null;

    // Suggested change (same .js-suggested-changes-blob structure as conversation tab)
    let suggestion = '';
    const suggestBlob = bodyEl.querySelector('.js-suggested-changes-blob');
    if (suggestBlob) {
      suggestion = extractSuggestionDiff(suggestBlob);
    }

    const cleanBody = bodyEl.cloneNode(true);
    // Strip suggestion blob, "Copilot uses AI" noise, and action buttons
    cleanBody.querySelectorAll('.js-suggested-changes-blob, .js-suggested-changes-container, .js-apply-changes').forEach(n => n.remove());
    cleanBody.querySelectorAll('p.text-small.color-fg-muted').forEach(n => n.remove());
    const commentText = cleanBody.innerText.trim();
    if (!commentText) return null;

    // File path: walk up to the diff container which has the file header
    let file = '';
    const diffContainer = thread.closest('[class*="Diff-module__diff"]') || thread.closest('[id^="diff-"]');
    if (diffContainer) {
      // data-file-path attribute on the expand button
      const filePathEl = diffContainer.querySelector('[data-file-path]');
      if (filePathEl) {
        file = filePathEl.getAttribute('data-file-path');
      }
      // Fallback: file name heading
      if (!file) {
        const heading = diffContainer.querySelector('[class*="file-name"] code, [class*="file-name"] a');
        if (heading) file = heading.innerText.replace(/\u200E/g, '').trim(); // strip LRM markers
      }
    }

    // Line numbers from the thread heading "Comment on lines R13 to R16"
    let linesText = '';
    const headingEl = thread.closest('[data-marker-id]')?.querySelector('h2') || thread.querySelector('h2');
    if (headingEl) {
      const m = headingEl.innerText.match(/R(\d+)(?:\s+to\s+R(\d+))?/i);
      if (m) {
        linesText = m[2] ? `L${m[1]}-L${m[2]}` : `L${m[1]}`;
      }
    }
    // Fallback: from data-line-number on surrounding cells
    if (!linesText && diffContainer) {
      const marker = thread.closest('[data-marker-id]');
      if (marker) {
        const row = marker.closest('tr');
        if (row) {
          const lineCell = row.querySelector('[data-line-number]');
          if (lineCell) linesText = `L${lineCell.dataset.lineNumber}`;
        }
      }
    }

    const type = detectType(firstComment, commentText);
    return { file, lines: linesText, author, type, comment: commentText, suggestion, replies: [], decision: '', note: '' };
  }

  function extractChangesPageReply(el) {
    const authorEl = el.querySelector('[data-testid="avatar-link"], [class*="AuthorName"]');
    const author = authorEl ? authorEl.innerText.trim() : 'unknown';
    const bodyEl = el.querySelector('.markdown-body');
    if (!bodyEl) return null;
    const comment = bodyEl.innerText.trim();
    if (!comment) return null;
    return { author, comment };
  }

  // Extract suggestion diff with +/- markers from GitHub's suggestion blob.
  // GitHub renders suggestions as a table where:
  //   - Deletion <td> has classes: blob-code-deletion js-blob-code-deletion
  //   - Addition <td> has classes: blob-code-addition js-blob-code-addition
  function extractSuggestionDiff(blob) {
    const lines = [];
    const deletions = blob.querySelectorAll('td.blob-code-deletion');
    const additions = blob.querySelectorAll('td.blob-code-addition');

    deletions.forEach(td => lines.push('- ' + td.innerText));
    additions.forEach(td => lines.push('+ ' + td.innerText));

    if (lines.length) return lines.join('\n');

    // Fallback: clean the blob text if no structured diff found
    const clone = blob.cloneNode(true);
    clone.querySelectorAll('button, .btn, .suggested-change-form-container, [role="button"]').forEach(n => n.remove());
    const header = clone.querySelector('.f6.border-bottom');
    if (header) header.remove();
    return clone.innerText.trim();
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
    return { file: '', lines: '', author, type, comment: text, suggestion: '', replies: [], decision: '', note: '' };
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
    // The head branch is the last BranchName element (after "from")
    const branchEls = document.querySelectorAll('.head-ref, .commit-ref:last-child span, [class*="BranchName-BranchName"]');
    const branch = branchEls.length ? branchEls[branchEls.length - 1].innerText.trim() : '';
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
        <button id="prc-reset" title="Reset all decisions">🧹</button>
        <button id="prc-refresh" title="Re-scrape page">↺</button>
        <button id="prc-close" title="Close">✕</button>
      </div>
      <div id="prc-meta-box">
        <div id="prc-meta-info"></div>
      </div>
      <div id="prc-ignored-box">
        <details>
          <summary class="prc-ignored-summary">Ignored authors</summary>
          <div id="prc-ignored-list"></div>
          <div class="prc-ignored-add">
            <input id="prc-ignored-input" type="text" placeholder="Add author…">
            <button id="prc-ignored-add-btn">+</button>
          </div>
        </details>
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
      <span>${reviews.length} thread${reviews.length !== 1 ? 's' : ''} found</span>
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
        ${r.replies && r.replies.length ? `<div class="prc-replies">${r.replies.map(rp =>
          `<div class="prc-reply"><span class="prc-reply-author">${escHtml(rp.author)}:</span> ${escHtml(rp.comment)}</div>`
        ).join('')}</div>` : ''}
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
        if (r.replies && r.replies.length) {
          lines.push('- **Replies**:');
          r.replies.forEach(rp => {
            lines.push(`  > **${rp.author}**: ${rp.comment.split('\n').join(' ')}`);
          });
        }
        const humanDecision = r.note ? `${r.decision} / ${r.note}` : r.decision;
        lines.push(`- **Human decision**: ${humanDecision}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  }

  // ── Ignored authors UI ──────────────────────────────────────────────────
  function renderIgnoredAuthors() {
    const list = document.getElementById('prc-ignored-list');
    const authors = getIgnoredAuthors();
    list.innerHTML = authors.map(a =>
      `<span class="prc-ignored-tag">${escHtml(a)}<button class="prc-ignored-remove" data-author="${escHtml(a)}">✕</button></span>`
    ).join('');
    list.querySelectorAll('.prc-ignored-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const updated = getIgnoredAuthors().filter(x => x.toLowerCase() !== btn.dataset.author.toLowerCase());
        saveIgnoredAuthors(updated);
        renderIgnoredAuthors();
        loadReviews();
      });
    });
  }

  renderIgnoredAuthors();

  document.getElementById('prc-ignored-add-btn').addEventListener('click', addIgnoredAuthor);
  document.getElementById('prc-ignored-input').addEventListener('keydown', e => {
    if (e.key === 'Enter') addIgnoredAuthor();
  });

  function addIgnoredAuthor() {
    const input = document.getElementById('prc-ignored-input');
    const name = input.value.trim();
    if (!name) return;
    const authors = getIgnoredAuthors();
    if (!authors.some(a => a.toLowerCase() === name.toLowerCase())) {
      authors.push(name);
      saveIgnoredAuthors(authors);
      renderIgnoredAuthors();
      loadReviews();
    }
    input.value = '';
  }

  // ── Wire up sidebar buttons ───────────────────────────────────────────────
  document.getElementById('prc-reset').addEventListener('click', () => {
    sessionStorage.removeItem('prc-decisions');
    reviews.forEach(r => { r.decision = ''; r.note = ''; });
    renderList();
  });
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
