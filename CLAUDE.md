# CLAUDE.md — PR Review Collector

## What this is

Browser extension (Chrome MV3, Firefox MV2, Safari) that scrapes review comments from GitHub PR pages, lets the user assign a human decision to each one, and generates a structured Markdown prompt for Claude. Fully client-side DOM scraping — no GitHub API token required.

## Project structure

```
content_script.js   — All scraping logic, sidebar UI, output generation (~830 lines, single IIFE)
sidebar.css         — Sidebar styles (light/dark mode)
popup.html / popup.js — Extension popup (version display, status check)
manifest.chrome.json  — Chrome/Edge/Brave (MV3)
manifest.firefox.json — Firefox (MV2)
manifest.json         — Symlink to active manifest
icon.svg / icons/     — Extension icon (SVG source + generated PNGs 16–128px, referenced by both manifests)
docs/                 — Architecture diagram, example output
```

There is no build step or bundler. The JS/CSS files are loaded directly by the browser extension runtime.

## Commands

```sh
npm run check          # lint + format check (CI runs this)
npm run lint           # eslint
npm run lint:fix       # eslint --fix
npm run format         # prettier --write
npm run format:check   # prettier --check
```

There are no tests. Validation is manual — load the extension on a GitHub PR page and open the sidebar.

## Code conventions

- Single file (`content_script.js`) wrapped in an IIFE — no modules, no imports.
- Prettier: single quotes, trailing commas, 120 print width, 2-space indent.
- ESLint: `@eslint/js` recommended, browser + webextensions globals, `no-console` off.
- Commit style: `type: short description` (feat/fix/refactor/docs), max ~60 char title.

## Architecture notes

- **5 scraper paths** in `scrapeReviews()`: conversation-tab threads, orphan review comments, React-based Files-changed threads, PR-level conversation comments, SonarQube annotations, and inline CI annotations.
- **Filtering layers**: resolved threads skipped, ignored authors list (localStorage `prc-ignored-authors`), noise pattern regex, content-based bot summary filtering (Copilot overview, Sonar Quality Gate), deduplication by `author|comment.slice(0,60)`.
- **Decisions** are stored in `sessionStorage` (`prc-decisions`); ignored authors persist in `localStorage`.
- **Output** is a Markdown prompt with PR metadata, per-review sections, and a commit strategy selector.

## Things to watch out for

- DOM selectors rely on GitHub's internal class names (`.review-comment`, `.js-resolvable-timeline-thread-container`, `[data-testid="review-thread"]`, etc.). These can break when GitHub ships UI changes.
- The Files-changed page uses `textContent` instead of `innerText` because `content-visibility: auto` hides off-screen elements from `innerText`.
- `manifest.json` is a symlink — keep `manifest.chrome.json` and `manifest.firefox.json` as the source of truth.
- Version must be updated in both manifests and `package.json` when releasing.
