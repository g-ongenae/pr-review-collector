// Populate version from manifest
const manifest = chrome?.runtime?.getManifest?.() || browser?.runtime?.getManifest?.();
if (manifest) {
  document.getElementById('version').textContent = `v${manifest.version}`;
}

// Check if current tab is a GitHub PR page
async function checkStatus() {
  const statusEl = document.getElementById('status');
  try {
    const tabs = await (chrome?.tabs?.query || browser?.tabs?.query)({ active: true, currentWindow: true });
    const url = tabs?.[0]?.url || '';
    const isPR = /^https:\/\/github\.com\/.+\/pull\/\d+/.test(url);
    if (isPR) {
      statusEl.innerHTML = '<span class="status-dot active"></span> Active on this PR page';
    } else {
      statusEl.innerHTML = '<span class="status-dot inactive"></span> Navigate to a GitHub PR to use this extension';
    }
  } catch {
    statusEl.innerHTML = '<span class="status-dot inactive"></span> Open a GitHub PR to get started';
  }
}

checkStatus();
