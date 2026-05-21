# Privacy Policy

_Last updated: 2026-05-21_

Agentic Browser Chat ("the extension") is a Chrome extension that lets you chat with an AI model about web pages, manage notes and tasks, and attach files for context. This policy describes what data the extension handles, where it goes, and what it does not do.

## Summary

- **All your data stays on your device.** Chat history, notes, tasks, attachments, settings, and your API key are stored locally in your browser (IndexedDB and `chrome.storage`).
- **The only external network destination is OpenRouter.** When you send a message, the extension calls the [OpenRouter](https://openrouter.ai) API using the API key you provided. OpenRouter then routes the request to the underlying model provider (OpenAI, Anthropic, Google, Meta, etc.) you selected.
- **There is no telemetry, analytics, tracking, or remote server operated by the developer.** The developer has no servers and receives no data from the extension.

## What the extension stores locally

Stored in IndexedDB on your device:

- Chat conversations (messages, tool calls, attachments, token/cost metadata)
- Notes and note version history
- Tasks and reminders
- Quizzes
- Attachment blobs (files, screenshots, generated images and documents)

Stored in `chrome.storage`:

- Your OpenRouter API key
- Selected model and related settings
- Theme and UI preferences
- Agent guardrail preferences (e.g. confirm-before-form-submit)
- Other extension settings

You can clear all of this at any time by removing the extension or by using the **Settings** tab inside the panel.

## What the extension sends over the network

When you send a message, the extension makes an HTTPS request directly from your browser to the OpenRouter API endpoint. That request contains:

- Your OpenRouter API key (in the `Authorization` header)
- The conversation history for the current chat
- Any attachments or page content you have explicitly attached
- System prompt, tool definitions, and model parameters

OpenRouter then forwards the request to the underlying model provider (OpenAI, Anthropic, Google, Meta, etc.) that hosts the model you selected. OpenRouter's and the underlying provider's privacy policies and terms govern how they handle that data. See [openrouter.ai/privacy](https://openrouter.ai/privacy) and the policy of the model provider you choose. The developer of this extension does not see, intercept, or store any of that traffic.

The extension may also fetch publicly-available resources required for features you use (for example, retrieving a page's own assets when you attach page content). It does not contact any analytics, advertising, or developer-controlled server.

## Permissions and why they are requested

| Permission | Why |
|---|---|
| `<all_urls>` host access | Required to read page content for selection actions, the content selector, and "chat with this page". Activated only when you invoke a feature. |
| `activeTab`, `tabs` | Identify the current tab and synchronize the panel state across tabs. |
| `scripting` | Inject the panel and tool scripts into the page when you open the extension. |
| `contextMenus` | Add right-click menu items for "Explain", "Summarize", and similar actions on selected text. |
| `clipboardRead`, `clipboardWrite` | Copy formatted output to your clipboard and read clipboard content when you paste into the panel. |
| `storage` | Save your settings, API key, and preferences locally. |
| `alarms` | Schedule task reminders. |
| `notifications` | Show reminder notifications when a task is due. |
| `offscreen` | Run background utilities (clipboard, parsing) that require a DOM in Manifest V3. |

## Data you should be careful with

Because your messages and any attached page content are sent to OpenRouter and the underlying model provider, do not attach material that you are not authorized to share with them. The extension cannot inspect or restrict what those services do with the content you submit.

## Children's privacy

The extension is not directed at children under 13 and does not knowingly collect any data from anyone, including children, on a developer-controlled server.

## Changes to this policy

If the extension's data practices change, this file will be updated and the change will be noted in the release notes. The "Last updated" date at the top will reflect the most recent change.

## Contact

Questions about this policy: please [open an issue](https://github.com/t33w411/agentic-browser-chat/issues) on GitHub. For security-related concerns, use a [private security advisory](https://github.com/t33w411/agentic-browser-chat/security/advisories/new) instead.
