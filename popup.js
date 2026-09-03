// Prefer the promise-based `browser` namespace (Firefox); Chrome MV3 `chrome.*` also returns promises.
const ext = (typeof browser !== 'undefined' && browser) || chrome;

// Populate version from manifest
const manifest = ext?.runtime?.getManifest?.();
if (manifest) {
  document.getElementById('version').textContent = `v${manifest.version}`;
}

function setStatus(active, message) {
  const statusEl = document.getElementById('status');
  statusEl.replaceChildren();
  const dot = document.createElement('span');
  dot.className = `status-dot ${active ? 'active' : 'inactive'}`;
  statusEl.append(dot, ` ${message}`);
}

// Ping the content script: it is only injected on GitHub PR pages, so a reply means we are active.
async function checkStatus() {
  try {
    const [tab] = await ext.tabs.query({ active: true, currentWindow: true });
    if (!tab?.id) throw new Error('No active tab');
    const reply = await ext.tabs.sendMessage(tab.id, { type: 'prc-ping' });
    if (reply?.ok) {
      setStatus(true, 'Active on this PR page');
    } else {
      setStatus(false, 'Navigate to a GitHub PR to use this extension');
    }
  } catch {
    // No receiver → content script not injected → not a PR page
    setStatus(false, 'Navigate to a GitHub PR to use this extension');
  }
}

checkStatus();
