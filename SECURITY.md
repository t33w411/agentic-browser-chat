# Security Policy

## Reporting a vulnerability

Please **do not** open a public GitHub issue for security vulnerabilities.

Instead, please [open a private security advisory](https://github.com/t33w411/agentic-browser-chat/security/advisories/new) on GitHub. This delivers the report directly to the maintainers without exposing it publicly.

Please include:

- A description of the issue and its impact
- Steps to reproduce, ideally with a minimal example
- The extension version (from `manifest.json`) and Chrome version
- Any relevant logs or screenshots

You can expect an initial acknowledgement within **7 days**. We will work with you to confirm the issue, develop a fix, and coordinate disclosure. Please give us a reasonable window to ship a fix before any public disclosure.

## Scope

In scope:

- The extension code in this repository (background service worker, content scripts, panel, tools)
- The way the extension handles user data, API keys, and page content
- Permissions used by the extension

Out of scope:

- Vulnerabilities in third-party libraries vendored under `lib/` should be reported to those projects directly. We will update vendored copies when patched releases are available.
- Issues that require a malicious extension or local attacker with full filesystem access.
- Vulnerabilities in the LLM provider APIs themselves.

## Data handling

This extension stores all user data (chat history, notes, API keys, settings) locally in IndexedDB and `chrome.storage`. It does not transmit data anywhere except to the LLM provider endpoint configured by the user. See [`PRIVACY.md`](./PRIVACY.md) for full details.
