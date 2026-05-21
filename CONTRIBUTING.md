# Contributing to Agentic Browser Chat

Thanks for your interest in contributing. This document explains how to set up the project, the conventions to follow, and what to expect from the review process.

## Quick start

1. Fork the repository and clone your fork.
2. Open `chrome://extensions` in Chrome.
3. Enable **Developer mode** (top right).
4. Click **Load unpacked** and select the cloned folder.
5. Pin the extension and open the panel from the toolbar action.

You will need to bring your own [OpenRouter](https://openrouter.ai) API key. Open the panel's **Settings** tab and paste it there. Nothing is sent to any server other than OpenRouter (which then routes to the model provider you select).

There is no build step. The extension loads source files directly. After editing, click the reload icon for the extension in `chrome://extensions`, then reload any open tabs you want to test against.

## Reporting bugs and requesting features

- Search existing issues first.
- For bugs: include Chrome version, OS, the exact steps to reproduce, what you expected, and what happened. Console errors from both the page and the service worker (`chrome://extensions` -> **Service worker** link) are very helpful.
- For features: describe the use case before the implementation. A short scenario beats a long spec.

## Pull requests

1. Create a topic branch off `main`.
2. Keep changes focused. One concern per PR.
3. Run a syntax check on every JavaScript file you modify:
   ```bash
   node --check path/to/file.js
   ```
   PRs with syntax errors will not be reviewed.
4. Test the change manually in Chrome. UI changes need a screenshot or short clip in the PR description.
5. Write a clear PR description: what changed, why, and how you verified it.

### Code style

- Match the surrounding code. The project uses plain JavaScript (no TypeScript, no bundler) with an `ABChatContent` IIFE namespace pattern. Read any file in `panel/` or `content/` for an example before adding a new one.
- No inline event handlers (`onclick`, etc.). Use `data-action` delegation on the panel's mount node.
- All panel DOM queries go through the shadow root (`ABChatContent.ui.panelShadowRoot`), never `document`.
- Persistent DOM listeners must check the listener-generation counter on every fire so they no-op after the extension reloads.
- Don't add dependencies without discussing first. Bundled libraries live in `lib/` and are vendored deliberately (Manifest V3 forbids remote code).

### Commit messages

Short imperative subject line. Body explaining *why* if the change is not obvious. Reference issues with `#123` when relevant.

## Scope

This is a personal project released as open source. Maintenance is best effort. Large architectural rewrites or scope expansions are unlikely to be merged without prior discussion in an issue.

Good first contributions:
- Bug fixes with clear reproductions
- Documentation improvements
- New tool modules that follow the existing patterns
- Accessibility fixes
- Performance improvements with measurements

## Security

Do not file security issues as public GitHub issues. See [`SECURITY.md`](./SECURITY.md).

## License

By contributing, you agree that your contributions will be licensed under the MIT License (see [`LICENSE`](./LICENSE)).
