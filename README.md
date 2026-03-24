# PR Review Collector

A Firefox extension that scrapes review comments from GitHub Pull Requests, lets you assign a human decision to each one, and copies a ready-to-paste prompt directly into Claude.

No GitHub login required. No API calls. Fully client-side.

![Architecture diagram](./docs/architecture.svg)

---

## Why

PR reviews come from multiple sources — GitHub Copilot, SonarQube/SonarCloud, and manual developer comments. Triaging them and communicating your intent to an AI assistant is repetitive and error-prone when done by hand.

This extension gives you a sidebar panel directly on the GitHub PR page. For each comment you pick a decision, add an optional note, and hit **Copy to clipboard**. The result is a structured prompt you paste straight into Claude.

---

## Features

- Scrapes inline diff comments, conversation-level comments, SonarQube/SonarCloud annotations, and GitHub Copilot suggestions
- Detects severity/type labels (Nit, Low, Medium, High) from Copilot and Sonar
- Sidebar panel with per-review decision picker and free-text annotation
- Decisions persist in `sessionStorage` — a page refresh won't wipe your work
- Reviews marked **Ignore** are dimmed in the UI and excluded from the output
- Light and dark mode support
- Generates a structured Markdown prompt ready to paste into Claude

---

## Architecture

```
GitHub PR page  ──scrape──►  Content script  ──sends to──►  Sidebar panel
                              (content_script.js)             (sidebar.html/css/js)
                                                                      │
                                                               Per-review decisions
                                                               (dropdown + note field)
                                                                      │
                                                              Output builder
                                                              (filters Ignore,
                                                               formats Markdown)
                                                                      │
                                                           📋 Clipboard  ──paste──►  Claude
```

Extension files: `manifest.json` · `content_script.js` · `sidebar.css`

Permissions required: `activeTab` · `clipboardWrite` · `storage`

---

## Installation

### Temporary (development)

1. Clone or download this repository
2. Add a 48×48 PNG named `icon.png` to the root folder
3. Open Firefox and navigate to `about:debugging`
4. Click **This Firefox** → **Load Temporary Add-on**
5. Select `manifest.json`

The extension is active until Firefox is closed. Repeat step 4–5 after each restart.

### Permanent (self-distributed)

1. Zip the extension folder contents (not the folder itself)
2. In Firefox, go to `about:addons` → gear icon → **Install Add-on From File**
3. Select the `.zip` file

> For signing and distribution via addons.mozilla.org, see [Mozilla's extension signing docs](https://extensionworkshop.com/documentation/publish/signing-and-distribution-overview/).

---

## Usage

1. Open any Pull Request on GitHub (the **Files changed** or **Conversation** tab works best)
2. Click the **📋** floating button at the bottom-right of the page
3. The sidebar opens and scrapes all visible review comments
4. For each comment, pick a decision from the dropdown:

   | Decision | When to use |
   |---|---|
   | **Apply** | Accept the suggestion as-is |
   | **Fix** | Fix the issue, optionally add a note with guidance |
   | **Explain** | Ask Claude to explain the comment or a related question |
   | **Plan fix** | Draft a plan before implementing |
   | **Investigate** | Needs further research before deciding |
   | **Ignore** | Dismiss — excluded from the output entirely |
   | **Other** | Anything that doesn't fit the above |

5. Add an optional free-text note to any decision for extra context
6. Click **Copy to clipboard**
7. Paste into Claude

### Decision format in the output

```
Human decision: Fix / Use UTC for the base of the date
Human decision: Explain / Also what happens in this other case…?
Human decision: Other / This is a false positive, investigate the test suite instead
Human decision: Apply
```

---

## Output format

The clipboard content is structured Markdown with the following sections:

```
# PR Reviews — human decisions for Claude

[Preamble — instructions for Claude]

## PR metadata
- URL
- Title
- Branch
- Description

## Reviews
### Review N
- File
- Lines
- Author
- Type (Nit / Low / Medium / High)
- Suggested change (if present)
- Comment
- Human decision
```

See [`docs/output_example.md`](./docs/output_example.md) for a full example.

---

## Supported review sources

| Source | How it's detected |
|---|---|
| GitHub manual reviews | Inline diff comment threads and conversation comments |
| GitHub Copilot | Severity label elements + comment text prefix |
| SonarQube / SonarCloud | `data-sonar-issue` / `data-severity` attributes + `.sonar-review-comment` class |

> **Note:** GitHub's DOM is not a public API. If GitHub ships a major UI redesign, the selectors in `content_script.js` may need updating. The scraping logic is intentionally isolated in clearly marked sections to make patching straightforward.

---

## Project structure

```
pr-review-collector/
├── manifest.json          # Extension manifest (Manifest V2, Firefox)
├── content_script.js      # DOM scraping + sidebar logic
├── sidebar.css            # Sidebar styles (light + dark mode)
├── icon.png               # Extension icon (48×48, add manually)
└── docs/
    ├── architecture.png   # Architecture diagram (see below)
    └── output_example.md  # Example clipboard output
```

---

## Contributing

The most useful contributions are updates to the scraping selectors when GitHub or SonarQube changes their DOM. When submitting a fix:

- Identify which section of `content_script.js` is affected (`extractInlineComment`, `extractConversationComment`, or `extractSonarComment`)
- Include the old and new selectors in your PR description
- Test on both the **Files changed** and **Conversation** tabs

---

## License

MIT