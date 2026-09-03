# Privacy Policy — PR Review Collector

_Last updated: 2026-09-03_

PR Review Collector is a browser extension that reads review comments displayed on the GitHub pull request page you are currently viewing, lets you assign a decision to each comment, and copies a formatted Markdown prompt to your clipboard.

## Data collection

**The extension does not collect, transmit, sell, or share any data.**

- It makes **no network requests** of any kind. There is no backend server, no analytics, no telemetry, no crash reporting.
- It runs **only** on pages matching `https://github.com/*/pull/*`.
- All processing happens locally in your browser. Review comments are read from the page you are viewing and rendered in a sidebar on that same page.
- Content only leaves the browser when **you** click **Copy to clipboard**, and then only to your own system clipboard.

## Data stored on your device

The extension stores a small amount of data in the browser's standard web storage for the `github.com` origin:

| Key                   | Storage          | Content                                          | Lifetime                          |
| --------------------- | ---------------- | ------------------------------------------------ | --------------------------------- |
| `prc-decisions`       | `sessionStorage` | The decision and note you typed for each comment | Cleared when the tab is closed    |
| `prc-ignored-authors` | `localStorage`   | The list of author usernames you chose to hide   | Until you remove it or clear data |

This data never leaves your device.

## Permissions

| Permission                             | Why it is needed                                                                    |
| -------------------------------------- | ----------------------------------------------------------------------------------- |
| `activeTab`                            | Lets the toolbar popup check whether the current tab is a GitHub pull request page. |
| `clipboardWrite`                       | Lets the **Copy to clipboard** button write the generated prompt to your clipboard. |
| `github.com/*/pull/*` (content script) | Injects the sidebar and reads review comments on pull request pages only.           |

## Third parties

The extension contains no third-party code, libraries, fonts, or remote resources.

## Changes and contact

Changes to this policy are tracked in the project's Git history. Questions: open an issue at <https://github.com/g-ongenae/pr-review-collector/issues>.
