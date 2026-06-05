(function () {
  var globalScopeForTools = globalThis;
  var ns = globalScopeForTools.ABChatAgent || {};

  ns.toolDefs = [

    // ---- File tools ----

    {
      type: 'function',
      function: {
        name: 'read',
        description: 'Read a note, chat, task, or question by ID. Returns content as an array of {ln, lc} objects (ln: line number, lc: line content) and a revision token (rev). Use offset and limit to read a contiguous range, or use lines to fetch specific non-contiguous line numbers in a single call (useful after grep). lines takes precedence over offset and limit when provided. When limit is omitted, a default cap of 200 lines is applied; if the item has more lines the response includes has_more: true; use offset to page forward. For notes read without an explicit limit or lines parameter, the response also includes an attachments field (string) if the note has file or image attachments; this field is suppressed when has_more is true (i.e. the note did not fit in the default window).',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['note', 'chat', 'task', 'question'], description: 'The data type to read.' },
            id: { type: 'integer', description: 'The integer ID of the item to read.' },
            lines: { type: 'array', items: { type: 'integer' }, description: 'Specific 1-indexed line numbers to fetch. Non-contiguous lines are returned in ascending order. Takes precedence over offset and limit. Values less than 1 and values exceeding total_lines are both skipped and reported in a warning field on the response; check total_lines before requesting specific line numbers.' },
            offset: { type: 'integer', description: '1-indexed line number to start reading from. Defaults to 1. Must be 1 or greater and must not exceed the item\'s total_lines; the call fails with an error if either condition is violated. Check total_lines from a prior read or list result before paginating. Ignored when lines is provided.' },
            limit: { type: 'integer', description: 'Maximum number of lines to return. Defaults to 200 when omitted; pass a larger value to read more. When the default truncates the result, the response includes has_more: true; use offset to page forward. Ignored when lines is provided.' }
          },
          required: ['type', 'id']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'write',
        description: 'Create a new note or task. Cannot be used on chats or questions; use generate_questions for questions. To replace an existing item entirely, read it first to obtain rev and total_lines, then use edit with line_start: 1 and line_end: total_lines. Returns the new id, type, title, and rev.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['note', 'task'], description: 'The data type to create.' },
            title: { type: 'string', description: 'Item title. Required.' },
            content: { type: 'string', description: 'Full content to write. For notes and tasks this is the body text. For questions this is the serialized question format.' },
            noteType: { type: 'string', enum: ['user', 'agent'], description: "Notes only: fails with an error if used on tasks or questions. noteType to assign. Defaults to 'user'." },
            tags: { type: 'array', items: { type: 'string' }, description: "Notes only: fails with an error if used on tasks or questions. Array of tag strings." },
            due_at: { type: 'string', description: "Tasks only: fails with an error if used on other types. ISO 8601 due date/time string. Defaults to tomorrow if omitted." },
            is_completed: { type: 'boolean', description: "Tasks only: fails with an error if used on other types. Completion status. Defaults to false." }
          },
          required: ['type', 'title', 'content']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'edit',
        description: 'Make a targeted edit in a note, task, or question. Requires the rev token from a prior read. Can update the title, content, or both in one call. At least one of title or a content change (old_string or line_start) must be provided. Two content modes: (1) String mode (no line_start): find and replace old_string with new_string. Fails if old_string is empty, not found, or matches more than once without replace_all. (2) Line mode (line_start provided): replace the specified line or line range with new_string. old_string and old_string_end are optional safety checks: in line mode they are substring checks (the target line must contain the string, not match it exactly). Only use line_start: 1 with line_end: total_lines when the new content is substantially different from the original; for small changes use string mode or targeted line replacement. Both modes fail if rev is stale. Returns the updated id, type, and rev.',
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['note', 'task', 'question'], description: 'The data type to edit.' },
            id: { type: 'integer', description: 'ID of the item to edit.' },
            rev: { type: 'string', description: 'Revision token from the most recent read of this item.' },
            title: { type: 'string', description: 'New title for the item. Can be provided alone for a title-only rename, or alongside a content change.' },
            old_string: { type: 'string', description: 'String mode: exact non-empty string to find and replace; must be unique unless replace_all is true. Line mode: optional safety check: edit fails if line_start does not contain this string.' },
            new_string: { type: 'string', description: 'Replacement content. In line mode, may span multiple lines. Pass an empty string to delete. Omit when only updating the title.' },
            replace_all: { type: 'boolean', description: 'String mode only: replace every occurrence of old_string. Defaults to false. Fails with an error if line_start is also provided.' },
            line_start: { type: 'integer', description: 'Activates line mode. 1-indexed line number to begin replacing. When line_end is omitted, only this single line is replaced.' },
            line_end: { type: 'integer', description: 'Line mode only: 1-indexed last line of the range to replace (inclusive). Must be >= line_start. Omit to replace only line_start.' },
            old_string_end: { type: 'string', description: 'Line mode only: optional safety check: edit fails if line_end does not contain this string. Requires line_end to be specified.' }
          },
          required: ['type', 'id', 'rev']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'grep',
        description: 'Search items with a JavaScript regular expression. By default searches the body content of items; set scope: "title" to search titles instead (use this to find items by name when you do not know an ID). Content scope (default): results are grouped by item and each entry in matches has id, type, title, and a lines array of matching line objects (ln: line number, lc: line content). In content output_mode (default), the response includes total_lines and total_items. In items_with_matches output_mode, the top-level count key is total_matches and no line content is returned. When max_words is set, each matched line is trimmed to that many words centered on the first match; truncated: true and match_count (when > 1) are added to the line object. Use read with lines afterward to fetch full content of specific matched lines. Title scope: returns { ok, total, matches } where each match is { id, type, title } with no line content; context_lines, max_words, and output_mode are ignored. In title scope, type is optional (omit to search titles across all types).',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: "JavaScript regular expression. Examples: 'closure', 'TODO:', '^##\\\\s', 'TODO|FIXME|HACK' (alternation to match any of several terms in one call). In title scope, also: 'meeting|standup' (alternation across title keywords), '^Q[1-4] ' (anchored prefix)." },
            scope: { type: 'string', enum: ['content', 'title'], description: 'What to search. "content" (default): match the pattern against item body text and return matching lines. "title": match the pattern against item titles and return matching items with no line content. Use "title" when looking up items by name without knowing an ID.' },
            type: { type: 'string', enum: ['note', 'chat', 'task', 'question'], description: 'The data type to search. Required when scope is "content". Optional when scope is "title" (omit to search titles across all types).' },
            id: { type: 'integer', description: 'Content scope only: restrict to one specific item by ID. Omit to search all items of the given type. Ignored in title scope.' },
            noteType: { type: 'string', enum: ['user', 'agent'], description: "When type is 'note', further filter by noteType. Omit to search notes of both types." },
            case_insensitive: { type: 'boolean', description: 'Match case-insensitively. Defaults to true.' },
            limit: { type: 'integer', description: 'Content scope: maximum total number of matching lines to return across all items; the loop stops as soon as the limit is reached. Title scope: maximum number of matching items to return; the response always includes the pre-limit total count.' },
            context_lines: { type: 'integer', description: 'Content scope only: number of lines to include before and after each matching line (like grep -C). Each match gains context_before and context_after arrays. Defaults to 0. Ignored in title scope.' },
            max_words: { type: 'integer', description: 'Content scope only: truncate each matched line to this many words centered on the first match. Results include truncated: true and match_count when the pattern appears more than once on the line. Use read with lines to retrieve the full line. Ignored in title scope.' },
            output_mode: { type: 'string', enum: ['content', 'items_with_matches'], description: 'Content scope only: "content" (default) returns matching lines grouped by item; "items_with_matches" returns only item metadata and a match_count per item with no line content (use for broad searches to avoid loading all matched lines into context). Ignored in title scope.' }
          },
          required: ['pattern']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'ls',
        description: "List items with metadata but no content. Notes are grouped by noteType in the response. The response includes a totals object with the count of each type after filtering but before pagination, so you can detect when results are truncated and paginate with offset.",
        parameters: {
          type: 'object',
          properties: {
            type: { type: 'string', enum: ['note', 'chat', 'task', 'question'], description: 'Restrict to one data type. Omit to list all types.' },
            noteType: { type: 'string', enum: ['user', 'agent'], description: "Filter notes by noteType. Only valid when type is 'note' or omitted; fails with an error if type is set to anything other than 'note'. Omit to include both." },
            limit: { type: 'integer', description: 'Maximum items to return per type. Must be a positive integer if provided; omit to return all.' },
            offset: { type: 'integer', description: 'Number of items to skip per type before returning results. Use with limit for pagination. Defaults to 0.' },
            sort_by: { type: 'string', enum: ['updatedAt', 'createdAt', 'title', 'dueAt', 'intervalStage'], description: "Field to sort by. Defaults to 'updatedAt'. dueAt applies to tasks and questions; intervalStage applies to questions. Both fall back to updatedAt for other types." },
            order: { type: 'string', enum: ['asc', 'desc'], description: "Sort direction. Defaults to 'desc'." },
            tags: { type: 'array', items: { type: 'string' }, description: "Notes only: return notes that have any of these tags. Fails with an error if type is set to anything other than 'note'." },
            is_completed: { type: 'boolean', description: "Tasks only: filter by completion status. Fails with an error if type is set to anything other than 'task'." },
            is_paused: { type: 'boolean', description: "Questions only: filter by paused status. Fails with an error if type is set to anything other than 'question'." },
            is_pinned: { type: 'boolean', description: "Chats only: filter by pinned status. Fails with an error if type is set to anything other than 'chat'." },
            due_before: { type: 'string', description: "Tasks and questions: return only items with dueAt on or before this ISO 8601 date string. Fails with an error if type is set to 'note' or 'chat'." },
            due_after: { type: 'string', description: "Tasks and questions: return only items with dueAt on or after this ISO 8601 date string. Fails with an error if type is set to 'note' or 'chat'." }
          },
          required: []
        }
      }
    },

    // ---- Page tool ----

    {
      type: 'function',
      function: {
        name: 'page_query',
        description: 'Your first resort when a question could be about content on the current page. Explore and read web page content through structured category-based discovery. IMPORTANT: getSelection, getPageContext, getPageContent, getPageOverview, findPageElements, and findText are NOT standalone tools; they are values of the `operation` parameter on this single `page_query` tool. Always invoke as `page_query` with the chosen operation, e.g. `page_query({ operation: "findText", pattern: "..." })`, never as a tool literally named `findText` or `findPageElements`. getSelection and getPageContext need no other parameters. getPageContent returns the entire current page as a single flattened snapshot (use only for whole-page tasks). getPageOverview returns a structured inventory of all recognizable element categories on the page. findPageElements in discovery mode lists all elements in a category; in detail mode performs operations on a specific element. findText locates elements by text pattern.',
        parameters: {
          type: 'object',
          properties: {
            operation: {
              type: 'string',
              enum: ['getSelection', 'getPageContext', 'getPageContent', 'getPageOverview', 'findPageElements', 'findText'],
              description: [
                'getSelection: text the user currently has highlighted.',
                'Result: { selected: boolean, result: string }.',
                'Always check selected first: it is false with an empty result string when nothing is highlighted.',
                '',
                'getPageContext: page title and URL only.',
                'Result: { title: string, url: string }.',
                'Use when you only need to identify the page, not read its content.',
                '',
                'getPageContent: the entire current page as a single flattened snapshot, identical to the content the user gets when they attach this browser tab and identical to the "Current page context" flattened-HTML conventions (images become <img_jpg>/<img_png>/<img_svg> etc. placeholders, hidden elements are marked hidden="", scripts/styles/canvas are stripped, redundant div/span wrappers are collapsed, most attributes removed). Result: { truncated: boolean, result: string }. This is a WHOLE-PAGE read and can be large, so use it only when the task genuinely needs holistic understanding of the page (e.g. "summarize this page", "what is this page about", "extract every X across the whole page", or when targeted search has failed to locate scattered content). For a specific value, fact, link, or element, do NOT use getPageContent: prefer findText first, then findPageElements detail mode, which return small targeted snippets far more cheaply. The snapshot is capped at 200,000 characters; truncated is true when the page exceeded the cap and the tail was cut.',
                '',
                'getPageOverview: structured inventory of all recognizable element categories present on the current page.',
                'Result: { <category>: count } (a flat map of category name to element count for every category that has at least one match).',
                'Call this first when you need to understand what element types are present before drilling into a category with findPageElements.',
                '',
                'findPageElements: discover elements on the page or perform a sub-operation on a specific element.',
                'Discovery mode (category only, no selector): returns all elements in the category: result is { total_matched, returned, truncated, items } where each item has { tag, selector, unique } plus content fields. For most categories the content field is innerText (trimmed to 150 chars). For type-specific categories the content field differs: links get href, label (visible text or accessible name), and target (when set); images get src and alt; videos and audio get src (falling back to the first <source> child when no direct src), controls, and label (when title or aria-label is set); buttons get label (visible text or accessible name), effective type (button/submit/reset; uses el.type so a <button> inside a <form> correctly reports its implicit "submit" default), disabled (only when true), name/value (when set), ARIA widget signals when set (role, aria_haspopup, aria_expanded, aria_controls, aria_selected), and inferred: true when the element was categorized only by a class-name heuristic (class contains select/dropdown/picker/combo/chooser/multiselect AND the element has a focusable tabindex or click handler) rather than by a native tag or ARIA role; treat inferred entries as candidates to verify by label, not confirmed widgets; form_fields get type (for inputs), label, placeholder, name, value, required, min, max, step, maxLength, pattern (each only when set on the element), and ARIA combobox signals when set: role, aria_haspopup, aria_expanded, aria_controls; iframes get src plus title and name (when set); landmarks get role, label (when an accessible name is set), and a truncated innerText fallback when no accessible label is present. Categorization covers interactive ARIA widget roles: role="option", role="menuitem", role="menuitemradio", role="menuitemcheckbox", role="tab", role="treeitem", and role="switch" appear in the buttons category; non-input role="combobox" appears in form_fields. Custom dropdowns built on the ARIA combobox+listbox+option pattern (common on Google, Material UI, Headless UI, Radix, Ant Design, React Select, etc.) are set with the select_option sub_operation, not page_fill_form: call findPageElements with the dropdown trigger\'s selector (the role="combobox" element, the aria-haspopup="listbox" button, or the inferred dropdown widget), sub_operation="select_option", and option set to the target value\'s visible label. select_option opens the dropdown, locates the option list (even when portal-rendered elsewhere in the DOM), types to filter and scrolls virtualized lists as needed, clicks the matching option, and reports whether the selection committed; the page\'s own JavaScript updates any underlying hidden input. Manual fallback if select_option cannot resolve the option: (1) click the role="combobox" element to open its listbox; (2) re-run findPageElements category="buttons" to discover the now-visible role="option" elements; (3) click the option whose label matches your target value. To filter, sort, or aggregate the items array, pass the result directly into eval via vars.',
                'Detail mode, category path (category + selector + sub_operation): validates the element belongs to the category, then performs the sub-operation. sub_operation values: get_inner_text (visible text), get_outer_html (raw markup: eval has no DOM so parse the returned string with string/regex operations in eval), get_attribute (requires attribute_name), get_computed_style (all resolved CSS values; pass the result object into eval to filter to the subset you need), traverse (requires direction: walks DOM relatives, each result entry has { tag, selector, unique, category, access_token, innerText }), click (dispatches a click on the element and returns a summarized DOM diff observed in the quiet window after the click; optional button: "left" (default) or "right"), select_option (requires the option parameter: opens a CUSTOM dropdown trigger and clicks the option matching that label, handling portal-rendered/typeahead/virtualized lists; this is how you set div/ARIA comboboxes such as React Select or Material UI Select, since page_fill_form only sets native <select>). NEVER use click to submit, save, update, delete, confirm, send, or otherwise commit a form or state-changing action — see the sub_operation description for the full rule.',
                'Detail mode, access token path (access_token + selector + sub_operation): for uncategorized elements returned by traverse (category: null). Only get_inner_text and get_outer_html are available. Tokens are bound to the specific page and tab where traverse ran: they expire on navigation and cannot be used cross-tab.',
                'category and access_token are mutually exclusive.',
                '',
                'findText: searches for text matching a JavaScript regex pattern across all visible text nodes in the page (or within a scoped selector subtree) and returns one entry per matching element.',
                'Result: { count: number, result: array } where each entry is { tag: string, selector: string, unique: boolean, category: string|null, match: string, snippet: string }.',
                'tag is the element tag name. selector is a CSS path. unique indicates whether the selector matches exactly one element on the page. category is the element\'s recognized category (null if uncategorized). match is the exact text the pattern matched. snippet is up to 60 characters of context on either side.',
                'Only the first match per element is recorded. script, style, and noscript content is excluded.',
                'Use the returned selector and category to chain into findPageElements detail mode. If category is null and unique is true, a traverse of a known nearby element can yield an access_token for the element.',
                'selector is optional for findText: when provided it scopes the search to that subtree; when omitted the whole page body is searched.'
              ].join(' ')
            },
            category: {
              type: 'string',
              enum: ['links', 'buttons', 'images', 'headers', 'paragraphs', 'blockquotes', 'tables', 'lists', 'iframes', 'videos', 'audio', 'forms', 'form_fields', 'landmarks', 'code', 'custom_elements'],
              description: 'For findPageElements: the element category to target. In discovery mode (no selector), returns all elements of this type. In detail mode (with selector and sub_operation), verifies the element belongs to this category before performing the sub_operation. Categories: links (a[href], area[href], role=link), buttons (button, input[type=submit/button/reset], role=button), images (img, picture, semantic svg), headers (h1-h6), paragraphs (p), blockquotes (blockquote), tables (table), lists (ul, ol, dl), iframes (iframe), videos (video, video embeds), audio (audio, audio embeds), forms (form), form_fields (input fields, select, textarea, contenteditable), landmarks (header, nav, main, aside, footer, article, section, ARIA landmark roles), code (pre, pre>code), custom_elements (hyphenated custom elements with ARIA attributes).'
            },
            sub_operation: {
              type: 'string',
              enum: ['get_inner_text', 'get_outer_html', 'get_attribute', 'get_computed_style', 'traverse', 'click', 'select_option'],
              description: 'For findPageElements detail mode: the operation to perform on the element matched by selector. get_inner_text: visible text content (element.innerText), normalized whitespace. get_outer_html: raw outerHTML markup; use eval to parse the returned string. get_attribute: value of a single named attribute (requires attribute_name). get_computed_style: all resolved CSS property values as computed by the browser; pass the result object into eval to filter to the subset you need. traverse: walks the DOM relative to the matched element (requires direction); each result entry includes category and access_token so uncategorized elements can be targeted in a follow-up call. click: dispatches a click (or right-click via the button parameter) on the matched element and returns a summarized diff of how the DOM changed in the ~300ms quiet window after the click (up to a 3s hard cap). The diff includes urlChanged/titleChanged, added/removed elements, textChanged, attrChanged, classChanged, activeElementChanged, visibleAlerts, counts, truncated, and timedOut. Each added/removed/changed list is capped at 20 entries; check truncated and counts.* if you need to know whether more changed. Click fails fast (with a clear reason) when the element is disabled, aria-disabled="true", has zero bounding box, has display:none/visibility:hidden/pointer-events:none, or has an ancestor with display:none/visibility:hidden. Click is also refused outright when the target (or any anchor ancestor) is an <a>/<area> whose href would unload the current document; same-page hash links (href="#..."), target="_blank" links (which open a new tab), and mailto:/tel:/sms:/javascript: links are still allowed. CRITICAL: never use click to submit, save, update, delete, confirm, send, or otherwise commit a form or state-changing action, even if the element is not a <button type="submit"> (this includes elements labelled "OK", "Continue", "Done", "Confirm", "Yes", "Apply", or their translations). Use click only for navigation, expansion, selection, opening menus, toggling UI, and other non-committing interactions. If unsure whether a click would submit or commit, do not click. Right-click (button: "right") dispatches a contextmenu event so page-level handlers fire; the browser\'s native context menu cannot be opened programmatically. select_option: choose a value from a CUSTOM dropdown (a div/ARIA combobox such as React Select, Material UI Select, Headless UI, Radix, Ant Design, Select2, etc.; NOT a native <select>, which page_fill_form handles). Requires the option parameter (the target option\'s visible label). Point selector at the dropdown trigger (the role="combobox" element, the aria-haspopup="listbox" button, or the inferred dropdown widget you discovered). select_option then, in one call: scrolls the trigger into view and opens it with a realistic pointer sequence (pointerdown/mousedown/mouseup/click, so widgets that commit on mousedown work); locates the option list even when it is portal-rendered elsewhere in the DOM; matches your option against each option\'s text/aria-label/value (exact, then starts-with, then contains, returning candidates instead of guessing when an ambiguous non-exact match hits more than one); types into the field to filter when the list is typeahead-driven; scrolls a virtualized list to render the target; clicks the option (with an Enter-key fallback); and verifies whether the selection committed. Returns { ok, selected_option, match_tier, committed, opened, used_typeahead, used_scroll, used_keyboard, diff }, or ok:false with the visible options listed when no option matches. When committed is false, the click landed but the commit could not be confirmed: verify with findText before relying on it. Only get_inner_text and get_outer_html are available in the access token path; click and select_option are not available via access_token.'
            },
            access_token: {
              type: 'string',
              description: 'For findPageElements access token path: the token returned in a traverse result entry where category is null. Allows get_inner_text and get_outer_html on uncategorized elements (e.g. generic div/span containers) without needing a category. Cannot be combined with category. Tokens are bound to the specific page load and tab where the traverse ran; if the page has navigated or you are on a different tab, the token will be rejected. Re-run the traverse on the current page to get a fresh token.'
            },
            selector: {
              type: 'string',
              description: 'CSS selector for the target element. Required for findPageElements detail mode (category path and access token path). Optional for findText; when provided it scopes the text search to that subtree; when omitted the whole body is searched. Not used by getSelection, getPageContext, or getPageOverview. findPageElements detail mode targets the first matching element only. Selector rules: comma-separated selectors are not allowed; use a single selector only. Bare unqualified tag names (e.g. "div", "table", "span") are not allowed; qualify with a class, id, attribute, or combinator (e.g. "main > table", "table.price-grid"). Exception: findText scope selectors may use bare tag names. Elements inside shadow DOM are not reachable.'
            },
            attribute_name: { type: 'string', description: 'For findPageElements with sub_operation get_attribute: the exact attribute name to read (e.g. "href", "data-id", "aria-label").' },
            button: { type: 'string', enum: ['left', 'right'], description: 'For findPageElements with sub_operation click: which mouse button to use. Defaults to "left". "right" dispatches a contextmenu event (page handlers only; the native browser context menu cannot be opened programmatically).' },
            option: { type: 'string', description: 'For findPageElements with sub_operation select_option: the option to choose from a custom dropdown, given as the visible label the user would see (e.g. "California"), NOT a CSS selector. Matched against each option\'s visible text, then aria-label, then value/data-value, then title, with precedence exact (case-insensitive) then starts-with then contains. An ambiguous non-exact match that hits more than one option is returned for you to disambiguate rather than guessed; re-run with the exact label. Respects case_insensitive (defaults to true).' },
            pattern: { type: 'string', description: 'For findText: JavaScript regular expression to search for in visible text nodes. Must not match the empty string. Examples: "climate change", "\\\\d{4}-\\\\d{2}-\\\\d{2}", "return policy|refund|exchange" (alternation to cover synonyms in one call instead of multiple findText calls).' },
            case_insensitive: { type: 'boolean', description: 'For findText: match case-insensitively. Defaults to true.' },
            direction: {
              type: 'string',
              enum: ['parent', 'children', 'nextSibling', 'previousSibling', 'nextSiblings', 'previousSiblings'],
              description: 'For findPageElements with sub_operation traverse: which relatives of the matched element to return. parent: direct parent element (null if already at body). children: all direct child elements. nextSibling: the immediately following sibling element (null if none). previousSibling: the immediately preceding sibling element (null if none). nextSiblings: all following sibling elements in document order. previousSiblings: all preceding sibling elements in document order (closest last). Singular directions return a single object or null; plural directions return an array with a count.'
            },
            limit: { type: 'integer', description: 'For findPageElements discovery mode: maximum elements to return; defaults to 50. The response includes total_matched, returned, and truncated so you can tell whether results were cut. For findText: maximum matching elements to return; defaults to 20.' }
          },
          required: ['operation']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'page_fill_form',
        description: 'Fill visible, non-sensitive form fields on the current page. Use page_query first to discover current selectors, then pass only confirmed selectors. This tool can fill text-like inputs, textareas, selects, checkboxes, radios, and contenteditable elements. It does not click, submit, navigate, run arbitrary page JavaScript, access iframes, or pierce shadow DOM. It blocks sensitive fields such as passwords, payment/card fields, OTPs, recovery codes, hidden fields, disabled fields, readonly fields, and fields that are not visible. Maximum 50 fields per call. Before filling, verify each target field by its discovered type, label, and placeholder, not by selector position: a text field with placeholder "e.g. 60 min" is for duration, not a date. Never write a date or time string to a number, text, or non-date input; never write a non-numeric string to a number input. Match the value format to the input type: type=date expects YYYY-MM-DD, type=datetime-local expects YYYY-MM-DDTHH:MM, type=time expects HH:MM, type=month expects YYYY-MM, type=week expects YYYY-Www, type=number/range expects a numeric string, type=color expects #RRGGBB. Each per-field result includes status (changed, blocked, or failed) and, on changed entries where the browser normalized the value or a page script reformatted it, a warning string with the actual stored value; verify the stored value matches your intent before treating a fill as final. Returns { ok, changed_count, blocked_count, failed_count, results, diff } where each entry in results reports the per-field outcome. The diff field summarizes DOM changes observed across the entire fill call (single 300ms-quiet-window / 3s-cap observation, not per-field) so cascading effects are visible: validation messages that appeared, newly-revealed form fields (e.g. a State input that becomes interactive after Country is set, a coupon input revealed by a checkbox), class flips like .is-invalid on filled inputs, and aria-invalid changes. The diff shape matches the click sub_operation\'s diff: urlChanged, titleChanged, added, removed, textChanged, attrChanged, classChanged, activeElementChanged, visibleAlerts, counts, truncated, timedOut. Value/checked mutations the tool itself caused on filled fields are filtered out of the diff so the agent sees the page\'s reactions, not its own write echoes. Inspect diff.added for newly-revealed elements (often new form fields you can now fill or validation messages), diff.attrChanged for aria-invalid flips, diff.classChanged for error-state classes, and diff.visibleAlerts for toast-style feedback. Async autocomplete suggestion lists that arrive after the 3s cap will not appear in the diff; for those fields, follow up with findPageElements after the call. ok is false if any field was blocked or failed, even when other fields in the same call succeeded: check changed_count, blocked_count, and failed_count for the full picture.',
        parameters: {
          type: 'object',
          properties: {
            fields: {
              type: 'array',
              description: 'Fields to fill. Each selector must match exactly one current page element. Text-like inputs, textareas, selects, and contenteditable elements use value. Checkboxes use checked. Radio buttons use checked:true on the specific radio option selector.',
              items: {
                type: 'object',
                properties: {
                  selector: { type: 'string', description: 'Confirmed CSS selector for one form field from page_query. Must match exactly one element on the current page.' },
                  value: { type: 'string', description: 'Value for text-like inputs, textarea, select, and contenteditable fields.' },
                  checked: { type: 'boolean', description: 'Checked state for checkbox fields. For radio fields, only checked:true is supported.' }
                },
                required: ['selector']
              }
            }
          },
          required: ['fields']
        }
      }
    },

    // ---- Visual inspection tool ----

    {
      type: 'function',
      function: {
        name: 'take_screenshot',
        description: 'Capture the currently visible portion of the active page and return a vision model description of what is on screen. The extension\'s own panel UI is hidden during capture so it never appears in the screenshot. This is a discretionary visual-inspection fallback, NOT a default way to read the page: the text and DOM tools (page_query findText, findPageElements, getPageContent) are far cheaper and must remain your first resort for page content. Use take_screenshot only when those tools have given confusing or insufficient signal, or when the issue is inherently visual and not faithfully represented in the DOM. Concrete triggers: a page_fill_form or click result that contradicts what the DOM reported; a suspected overlay, modal, or cookie banner covering the target element; a custom widget such as a date picker, canvas chart, map, or slider whose rendered state the DOM does not expose; a visual layout or rendering glitch; or an error/validation state you cannot locate in the DOM. IMPORTANT: it only sees the current viewport, never off-screen or whole-page content, so scroll the relevant area into view before calling (page_query click and page_fill_form both scroll their target into view). Provide a focused prompt describing exactly what to look for to get a focused answer; omit it for a general description. Each call hides the panel, captures, and runs a vision model, so it is comparatively slow and costly: do not call it repeatedly or as a substitute for reading text. Returns { ok, content } where content is the vision model\'s text description, or { ok: false, error } when capture or analysis fails.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'A specific question or instruction about what to look for in the screenshot (e.g. "Is an overlay covering the email input? What validation text appears under the Submit button?"). A focused prompt yields a focused answer. Omit for a general description of what is currently visible.' }
          }
        }
      }
    },

    // ---- Compute tool ----

    {
      type: 'function',
      function: {
        name: 'eval',
        description: 'Run JavaScript in a sandboxed Web Worker. Use this whenever in-context reasoning would be imprecise or unreliable: it gives you exact, deterministic results. WHEN TO USE: (1) Precise arithmetic: financial calculations, percentages, weighted averages, rounding; anything where an off-by-one or floating-point error matters. (2) Bulk data processing: filter, sort, group, deduplicate, or aggregate arrays of objects returned by page_query or web_fetch; do not try to process large datasets in context. (3) Date/time math: day differences, adding/subtracting intervals, sorting ISO date strings, finding day-of-week; use the Date API rather than reasoning about calendars. (4) String and regex operations: extract all pattern matches from a large text block, reformat lists, count occurrences, strip or replace at scale. (5) JSON reshaping: flatten nested API responses, pick specific fields, group-by a key, before passing cleaned data to the next step. (6) Encoding and decoding: base64 (atob/btoa), URL encoding (encodeURIComponent/decodeURIComponent), parsing numeric strings with parseFloat/parseInt. (7) Sorting and ranking: sort arrays of objects by computed fields or multi-key criteria. CONSTRAINTS: No DOM, no chrome APIs, no network (fetch, XHR, WebSocket, importScripts, caches, indexedDB, BroadcastChannel, and self.close are all blocked). crypto.subtle is available. Input data is passed via vars (inline values) and/or blob_ids (contents of attachments already in the conversation). The model-facing return value must be JSON-serializable and under 200 KB; the vars payload must be under 1 MB; the resolved blob_ids payload and any returned __document__ spec each get a separate 50 MB budget. Tight infinite loops run until the timeout fires; keep code efficient. The code must use an explicit return statement. ATTACHMENT INPUT: to process the contents of attachments already in the conversation, list their blob IDs in blob_ids. Each resolved attachment is injected as an element of a reserved blobs array variable (never also declare a vars key named blobs); each entry is { id, name, kind, mimeType, size, text, dataUrl }. The text field holds the already-extracted text content (for files this is the parsed text captured at upload, such as CSV, TXT, or JSON text); dataUrl holds the base64 data URL. The sandbox has no document parsers, so for DOCX, XLSX, and PDF rely on the text field rather than dataUrl. Blob IDs appear in context as [Attached file: "name" (blob id: N)] markers, as __blob:N__ (generated images), and as #abchat-docblob-N (generated documents). Prefer blob_ids over re-pasting large attachment text into vars. An unresolved ID arrives as a { id, error } entry. DOCUMENT OUTPUT: to turn your computation into a downloadable file, return an object whose __document__ key holds a document spec; the file is generated, saved, and shown to the user automatically, and __document__ is stripped from the result you get back. The spec uses the same shape as the create_document tool: { format (one of xlsx, docx, pdf, csv, pptx), filename, title, and the format-appropriate content field: sheets or rows for xlsx and csv, blocks or content for docx and pdf, slides for pptx }. Do not use markdown in document fields. Emit exactly one document per call; everything else in the returned object is the normal result the model sees. EXAMPLE (read a CSV attachment with blob id 42, total revenue per region, and emit an xlsx): set blob_ids to [42] and code to: const lines = blobs[0].text.trim().split("\\n"); lines.shift(); const totals = {}; lines.forEach(function (l) { const c = l.split(","); totals[c[0]] = (totals[c[0]] || 0) + (parseFloat(c[2]) || 0); }); const rows = [["Region","Total"]].concat(Object.keys(totals).sort().map(function (k) { return [k, totals[k]]; })); return { totals: totals, __document__: { format: "xlsx", filename: "revenue-by-region", sheets: [{ name: "Summary", rows: rows }] } };  (the model then receives result: { totals: ... } plus a document note, and the user gets the xlsx file).',
        parameters: {
          type: 'object',
          properties: {
            code: { type: 'string', description: 'JavaScript code to execute. Must use an explicit return statement to produce a result. Keep it efficient: a tight infinite loop will consume the full timeout.' },
            vars: { type: 'object', description: 'JSON-serializable named variables injected into the function scope. Pass data from other tool results here rather than inlining large values in the code string. Example: { "rows": [[1,2],[3,4]], "threshold": 10 }. Total serialized size must be under 1 MB. The name "blobs" is reserved and cannot be used as a vars key.' },
            blob_ids: { type: 'array', items: { type: 'integer' }, description: 'Optional. Attachment blob IDs to load into the sandbox. Each resolved blob is injected as an element of a reserved `blobs` array variable: { id, name, kind, mimeType, size, text, dataUrl }. Use the text field for file contents (the sandbox cannot parse binary office formats from dataUrl). IDs come from [Attached file: "..." (blob id: N)] markers, __blob:N__ image refs, and #abchat-docblob-N document refs. Prefer this over pasting large attachment text into vars. Combined resolved payload must be under 50 MB.' },
            timeout: { type: 'integer', description: 'Execution timeout in milliseconds. Minimum 5000, maximum 30000. Defaults to 5000. Values below 5000 are clamped to 5000 and values above 30000 are clamped to 30000. Increase only for genuinely long-running computations on large datasets.' }
          },
          required: ['code']
        }
      }
    },

    // ---- Web tools ----

    // web_fetch and page_query/getPageContent use the same HTML flattening pipeline.
    // web_fetch applies it to remotely fetched HTML; getPageContent applies it to the current page's live DOM.
    {
      type: 'function',
      function: {
        name: 'web_fetch',
        description: 'Fetch a URL\'s content and returns either a summary or only the relevant answer to the provided prompt. Handles HTML pages, plain text, JSON, images (JPEG, PNG, GIF, WebP), and documents (PDF, DOCX, XLSX, XLS, ODS, PPTX). HTML pages are parsed into a flattened simplified representation with noise stripped. Images are analyzed by a vision model: provide a prompt to ask a specific question about the image, or omit for a detailed description. Documents are parsed to extracted text. For HTML, text, and documents a fast secondary model summarizes the content; when a prompt is provided it returns only the relevant answer, otherwise it returns a general summary: the summarizer always runs for these content types. Has a 15-second timeout. Supports GET, POST, PUT, PATCH, DELETE, and HEAD. Use body and headers for API calls. ENFORCEMENT: The runtime blocks any URL that does not appear in the conversation context (user messages or prior tool results); calls with unrecognized URLs are rejected with an error regardless of the advisory text below. Only call this tool if the URL was explicitly provided by the user or appeared in a tool result (including URLs returned by web_search). If a web_search result does not contain enough detail to answer the question, fetch one or more of the result URLs with this tool to get the full page content. If you are about to construct a URL from memory, stop and call web_search instead.',
        parameters: {
          type: 'object',
          properties: {
            url: { type: 'string', description: 'The full URL to fetch (must begin with http:// or https://).' },
            prompt: { type: 'string', description: 'A specific question or instruction about the page content. A fast secondary model reads the page and returns only the relevant answer rather than the full content. Defaults to a general summary if omitted. Skip for API calls (POST/PUT/PATCH) where you need the raw response.' },
            method: { type: 'string', enum: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD'], description: "HTTP method. Defaults to 'GET'." },
            headers: { type: 'object', description: 'Key-value map of request headers. Example: { "Authorization": "Bearer token", "Content-Type": "application/json" }.' },
            body: { type: 'string', description: 'Request body as a string. Only sent for POST, PUT, and PATCH. For JSON APIs, stringify the payload and set Content-Type: application/json in headers.' }
          },
          required: ['url']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'web_search',
        description: 'Search the web for current information. Use this for news, recent events, real-time data, or any question where up-to-date information is needed. Use this whenever you need to look something up, even if you think you know the URL. Never construct a URL yourself and fetch it directly with web_fetch. Always write specific, detailed queries; vague or short queries produce poor results. After searching, if the result snippets do not provide enough detail, use web_fetch on one or more of the returned URLs to read the full page content.',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'The search query. Write it like an expert searcher: use 4-10 words, include specific terminology and related keywords, add the current year or a date range when recency matters (e.g. "2026"), include a location when the topic is geography-sensitive, and use precise nouns and qualifiers rather than vague generic phrases. Never use single-word or two-word queries.' },
            max_results: { type: 'integer', description: 'Maximum number of results to return (5-10). Defaults to 5.' },
            academic_only: { type: 'boolean', description: 'If true, restricts results to academic sources (arXiv, PubMed, Google Scholar, Semantic Scholar, JSTOR, bioRxiv, SSRN, IEEE Xplore, ACM Digital Library, ResearchGate, and similar). Best-effort: if no academic results are found the full result set is returned with a note.' }
          },
          required: ['query']
        }
      }
    },

    // ---- Document Generation Tools ----

    {
      type: 'function',
      function: {
        name: 'create_document',
        description: 'Create a downloadable DOCX, XLSX, PDF, PPTX, or CSV document and display it in the chat. Use DOCX or PDF for reports, letters, outlines, notes, and prose. Use XLSX for multi-sheet spreadsheets. Use CSV for simple tabular data that should open in spreadsheet apps or be imported elsewhere. Use PPTX for slide decks. DO NOT use markdown syntax (no **bold**, _italic_, `code`, [links](url), ```code fences```, > blockquotes, ---, or markdown table pipes like | col | col |) in any field; the document formats do not render markdown and the raw characters will appear literally in the output. For tables specifically, never use pipe-and-dash markdown tables; use a table block with rows for DOCX/PDF, or use sheets/rows for XLSX/CSV. Use each format\'s native structure: for DOCX/PDF pass structured blocks (heading, paragraph, bullet, table) with plain text; for XLSX/CSV pass plain cell values in sheets/rows; for PPTX pass slides with a plain title and plain-text bullets. Use the content field only for plain prose where each line is a paragraph (DOCX/PDF), a row (XLSX/CSV), or a slide section (PPTX), never with markdown formatting. Returns metadata only; the generated file is saved and shown to the user automatically.\n\nSample snippets (one per format):\nDOCX/PDF: { format: "docx", title: "Report", blocks: [ { type: "heading", level: 1, text: "Overview" }, { type: "paragraph", text: "Sales grew this quarter." }, { type: "bullet", items: ["North up 12%", "South up 5%"] }, { type: "table", rows: [["Region","Q1","Q2"],["North",100,112],["South",80,84]] } ] }\nXLSX: { format: "xlsx", filename: "sales", sheets: [ { name: "Q1", rows: [["Region","Revenue"],["North",100],["South",80]] }, { name: "Q2", rows: [["Region","Revenue"],["North",112],["South",84]] } ] }\nCSV: { format: "csv", filename: "contacts", rows: [["Name","Email"],["Ada","ada@example.com"],["Linus","linus@example.com"]] }\nPPTX: { format: "pptx", title: "Kickoff", slides: [ { title: "Agenda", bullets: ["Goals","Timeline","Owners"] }, { title: "Next Steps", bullets: ["Draft spec","Review Friday"] } ] }',
        parameters: {
          type: 'object',
          properties: {
            format: { type: 'string', enum: ['docx', 'xlsx', 'pdf', 'pptx', 'csv'], description: 'Document format to create.' },
            filename: { type: 'string', description: 'Optional filename. The correct extension is added if omitted.' },
            title: { type: 'string', description: 'Optional document title. For DOCX/PDF this is inserted as a top heading when not already present. For PPTX it can be used as the first slide title.' },
            content: { type: 'string', description: 'Plain text only, no markdown formatting (no **bold**, _italic_, `code`, links, code fences, blockquotes, etc.). DOCX/PDF: lines starting with # are treated as headings and lines starting with - as bullets; everything else is a paragraph. Prefer the blocks field for any non-trivial DOCX/PDF document so structure is explicit. XLSX/CSV: lines become rows; tab-separated or comma-separated lines become multiple cells. PPTX: blank-line-separated sections become slides; the first line becomes the slide title.' },
            blocks: {
              type: 'array',
              description: 'DOCX/PDF structured content blocks. Ignored for XLSX and PPTX.',
              items: {
                type: 'object',
                properties: {
                  type: { type: 'string', enum: ['heading', 'paragraph', 'bullet', 'table'], description: 'Block type.' },
                  level: { type: 'integer', description: 'Heading level from 1 to 3.' },
                  text: { type: 'string', description: 'Plain text for heading, paragraph, or a single bullet. No markdown syntax: the renderer outputs characters literally.' },
                  items: { type: 'array', items: { type: 'string' }, description: 'Bullet list items.' },
                  rows: {
                    type: 'array',
                    description: 'Table rows for a DOCX table.',
                    items: {
                      type: 'array',
                      items: { description: 'Cell value. Use a string, number, boolean, or null.' }
                    }
                  }
                }
              }
            },
            sheets: {
              type: 'array',
              description: 'XLSX/CSV workbook sheets. CSV uses only the first sheet.',
              items: {
                type: 'object',
                properties: {
                  name: { type: 'string', description: 'Sheet name, max 31 characters after sanitization.' },
                  rows: {
                    type: 'array',
                    description: 'Rows of cell values.',
                    items: {
                      type: 'array',
                      items: { description: 'Cell value. Use a string, number, boolean, or null.' }
                    }
                  }
                },
                required: ['rows']
              }
            },
            rows: {
              type: 'array',
              description: 'CSV-only direct rows. Prefer sheets for XLSX and rows for CSV when only one table is needed.',
              items: {
                type: 'array',
                items: { description: 'Cell value. Use a string, number, boolean, or null.' }
              }
            },
            slides: {
              type: 'array',
              description: 'PPTX-only slide definitions.',
              items: {
                type: 'object',
                properties: {
                  title: { type: 'string', description: 'Slide title.' },
                  bullets: { type: 'array', items: { type: 'string' }, description: 'Bullet points for the slide body.' },
                  items: { type: 'array', items: { type: 'string' }, description: 'Alias for bullets.' },
                  content: { type: 'string', description: 'Slide body text. Each line becomes a bullet if bullets are omitted.' }
                }
              }
            }
          },
          required: ['format']
        }
      }
    },

    // ---- Image Generation Tools ----

    {
      type: 'function',
      function: {
        name: 'generate_image',
        description: 'Generate an image from a text prompt using an image generation model. The image is automatically displayed inline in the chat. To iterate on a previously generated image, find its blob ID in the context (shown as __blob:N__ in the assistant message) and pass that N as source_blob_id, then describe only the changes in prompt. If source_blob_id is provided but the blob is not found or is not a valid image, the tool silently falls back to a text-only generation using the prompt alone rather than returning an error. Returns { ok, dataUrl, prompt }. When ok is true the image has already been shown to the user.',
        parameters: {
          type: 'object',
          properties: {
            prompt: { type: 'string', description: 'The image generation prompt, or the change description when iterating.' },
            source_blob_id: { type: 'integer', description: 'Optional. The blob_id of a previously generated image to iterate on. Omit for new images.' },
            aspect_ratio: { type: 'string', enum: ['1:1', '16:9', '9:16', '4:3', '3:4'], description: 'Required. Desired aspect ratio. Use "1:1" for square, "16:9" for landscape/widescreen, "9:16" for portrait/mobile, "4:3" for traditional landscape, "3:4" for traditional portrait.' }
          },
          required: ['prompt', 'aspect_ratio']
        }
      }
    },

    // ---- Environment tool ----

    {
      type: 'function',
      function: {
        name: 'get_environment',
        description: 'Returns the current date, time, timezone, locale, and OS/platform of the user\'s device. Call this when you need accurate temporal context (e.g. "what time is it?", "what day is today?") or when platform-aware answers are needed. The system prompt includes the date at session start; use this tool to get the live value mid-conversation or to get time, timezone, locale, or OS details not included in the system prompt. Sample response: { ok: true, date: "2026-05-11", time: "14:32:05", day_of_week: "Monday", month: "May", year: 2026, timezone: "America/New_York", utc_offset: "UTC-05:00", locale: "en-US", platform: "macOS" }.',
        parameters: {
          type: 'object',
          properties: {},
          required: []
        }
      }
    },

    // ---- Memory Tools ----

    {
      type: 'function',
      function: {
        name: 'memory',
        description: "Manage the persistent memory note that carries facts and preferences the user has asked you to remember. Use 'upsert' to add a new entry; use 'delete_entry' to remove one. Always phrase entries in third person (e.g. 'The user\\'s name is Tayo', not 'My name is Tayo').",
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['upsert', 'delete_entry'], description: "'upsert': append a new entry line to the memory note, creating the note if it does not exist yet. 'delete_entry': remove the matching entry line from the memory note." },
            entry: { type: 'string', description: "The memory entry text. For 'upsert': the new fact to store (one sentence, third-person). For 'delete_entry': exact text of the entry to remove." }
          },
          required: ['operation', 'entry']
        }
      }
    },

    {
      type: 'function',
      function: {
        name: 'skill',
        description: "Manage saved skills. Use 'create' when the user asks you to remember a detailed procedure or how-to. Use 'read' to load a skill's full instructions before applying it. Use 'update' to revise an existing skill. Use 'delete' to remove a skill.",
        parameters: {
          type: 'object',
          properties: {
            operation: { type: 'string', enum: ['create', 'read', 'update', 'delete'], description: "The operation to perform." },
            slug: { type: 'string', description: "The skill's slash-command identifier: lowercase letters, numbers, and hyphens only (e.g. 'calculate-worksheet-discrepancy'). Required for read, update, and delete. Required for create." },
            title: { type: 'string', description: "Short descriptive name for the skill. Required for create; optional for update (renames the skill)." },
            body: { type: 'string', description: "Full procedure text. Required for create; required for update (replaces existing body). Write this as self-contained, step-by-step instructions addressed to your future self: you will load and follow it verbatim in a later session that has no memory of this conversation, so it must stand on its own. Make it concrete, not vague. Use numbered, sequential steps. Name the exact tools, operations, and arguments you will call (e.g. page_query with operation 'findText', findPageElements with sub_operation 'click' or category 'form_fields', page_fill_form, web_search, read) rather than prose like 'find the field and fill it'. Include any known selectors, ids, or values as hints, explain the reasoning behind non-obvious steps, and note likely failure modes and how to recover. For state-changing or committing actions (submit, send, post, pay, delete), instruct yourself to stop and ask the user to perform that final step manually rather than automating it. Naming tools and operations here is expected and encouraged; the rule against mentioning tool names applies only to replies shown to the user, never to skill instructions you write for yourself. Example body for a skill titled 'How to post a comment on YouTube':\n1. Find the input area: call page_query findText for 'Add a comment...' to get the placeholder element's selector (often #simplebox-placeholder).\n2. Reveal the real field: the placeholder is not editable, so call findPageElements on that selector with sub_operation 'click' to expand the UI.\n3. Locate the editor: call findPageElements with category 'form_fields' to find the newly revealed editable field (a div with role 'textbox', often #contenteditable-root).\n4. Fill it: use page_fill_form to set the value of the field found in step 3.\n5. Stop before committing: tell the user the comment is entered but they must click the 'Comment' button themselves, since posting is a state-changing action you do not automate." }
          },
          required: ['operation']
        }
      }
    },

    // ---- Quiz Generation Tools ----

    {
      type: 'function',
      function: {
        name: 'generate_questions',
        description: 'Generate quiz questions (MCQ or FITB) from the provided source material and save them directly to the Quiz tab. Returns { ok, saved, titles } confirming how many questions were saved and their titles. Partial success is possible: if some questions fail to save, ok is still true and a non-empty errors array is included alongside the successfully saved items: always check saved and errors, not just ok.',
        parameters: {
          type: 'object',
          properties: {
            content: { type: 'string', description: 'The source material to generate questions from. Pass the relevant text you have already read from the conversation or notes.' },
            count: { type: 'integer', description: 'Number of questions to generate. Defaults to 1 if omitted.' },
            question_type: { type: 'string', enum: ['mcq', 'fitb', 'mix'], description: 'Type of questions to generate. "mcq" = multiple choice only, "fitb" = fill-in-the-blank only, "mix" = freely mix both types. Defaults to "mix" if omitted.' },
            focus: { type: 'string', description: 'Optional natural-language description scoping which topic or concept within the source material to focus on.' }
          },
          required: ['content']
        }
      }
    }

  ];

  globalScopeForTools.ABChatAgent = ns;
})();
