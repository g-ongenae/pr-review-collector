// Populate version from manifest
const manifest = chrome?.runtime?.getManifest?.() || browser?.runtime?.getManifest?.();
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

// Check if current tab is a GitHub PR page
async function checkStatus() {
  try {
    const queryFn =
      (typeof chrome !== 'undefined' && chrome.tabs?.query) || (typeof browser !== 'undefined' && browser.tabs?.query);
    const tabs = queryFn ? await queryFn({ active: true, currentWindow: true }) : [];
    const url = tabs?.[0]?.url || '';
    const isPR = /^https:\/\/github\.com\/.+\/pull\/\d+/.test(url);
    if (isPR) {
      setStatus(true, 'Active on this PR page');
    } else {
      setStatus(false, 'Navigate to a GitHub PR to use this extension');
    }
  } catch {
    setStatus(false, 'Open a GitHub PR to get started');
  }
}

checkStatus();
