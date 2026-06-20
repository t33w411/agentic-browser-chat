(function () {
  const globalScopeForPanelTemplate = globalThis;
  const contentNamespaceForPanelTemplate = globalScopeForPanelTemplate.ABChatContent || {};
  const icForPanelTemplate = contentNamespaceForPanelTemplate.icons || {};

  const panelMarkupForPanelTemplate = `
<div class="panel-host mode-expanded header-ctrl-theme" id="panel-host" data-theme="light">
  <div class="panel">
  <div id="abchat-libs-overlay" class="libs-loading-overlay"><div class="libs-loading-spinner"></div><span class="libs-loading-label">Initialising...</span></div>
  <div id="api-key-onboarding-overlay" class="api-key-onboarding-overlay hidden">
    <img id="api-key-onboarding-icon" class="api-key-onboarding-icon" src="" alt="Agentic Browser Chat">
    <h2 class="api-key-onboarding-title">OpenRouter API key required</h2>
    <p class="api-key-onboarding-desc">Agentic Browser Chat uses OpenRouter for AI functionality. Enter your API key to get started.</p>
    <input type="password" id="api-key-onboarding-input" class="api-key-onboarding-input" placeholder="Enter your OpenRouter API key...">
    <p class="api-key-onboarding-link">Get a key at <a href="https://openrouter.ai/sign-up" target="_blank" rel="noopener noreferrer">openrouter.ai</a></p>
    <button class="api-key-onboarding-btn" data-action="save-api-key-onboarding">Save and continue</button>
  </div>

    <!-- HEADER -->
    <div class="panel-header">
      <div class="panel-tabs">
        <button class="tab-btn active" data-tab="chats" data-action="set-tab">Chats</button>
        <button class="tab-btn" data-tab="notes" data-action="set-tab">Notes</button>
        <button class="tab-btn" data-tab="tasks" data-action="set-tab">Tasks<span class="tab-badge-dot" id="tasks-tab-dot"></span></button>
        <button class="tab-btn" data-tab="quiz" data-action="set-tab">Quiz<span class="tab-badge-dot" id="quiz-tab-dot"></span></button>
        <!-- Content selector -->
        <button class="tab-icon-btn" id="selector-tab" data-action="toggle-selector">
          ${icForPanelTemplate.cursor14}
        </button>
        <!-- New menu (reduced view only) -->
        <div class="new-menu-wrap">
          <button class="new-menu-btn" id="new-menu-btn" title="Create new" data-action="toggle-new-menu">+ New</button>
          <div class="new-menu-dropdown" id="new-menu-dropdown">
            <button class="new-menu-item" data-action="new-menu-create" data-new-kind="chat">New Chat</button>
            <button class="new-menu-item" data-action="new-menu-create" data-new-kind="note">New Note</button>
            <button class="new-menu-item" data-action="new-menu-create" data-new-kind="task">New Task</button>
            <button class="new-menu-item" data-action="new-menu-create" data-new-kind="quiz">New Quiz</button>
          </div>
        </div>
      </div>
      <div class="panel-controls">
        <button class="ctrl-btn ctrl-sync" id="sync-all-btn" title="Sync chats, notes, tasks, and quiz questions across tabs" data-action="sync-all">
          ${icForPanelTemplate.sync14}
        </button>
        <button class="ctrl-btn ctrl-header-theme" id="header-theme-btn" title="Toggle light / dark theme" data-action="toggle-header-theme">
          ${icForPanelTemplate.moon14}
        </button>
        <!-- Settings: in-panel settings view -->
        <button class="ctrl-btn" title="Settings (opens extension settings)" data-action="set-tab" data-tab="settings">
          ${icForPanelTemplate.settings14}
        </button>
        <button class="ctrl-btn ctrl-reduce" title="Reduce to float" data-action="set-mode" data-mode="reduced">
          ${icForPanelTemplate.reduce14}
        </button>
        <button class="ctrl-btn ctrl-expand" title="Expand to full" data-action="set-mode" data-mode="expanded">
          ${icForPanelTemplate.expand14}
        </button>
        <button class="ctrl-btn ctrl-close" title="Close / Minimize">
          ${icForPanelTemplate.x13}
        </button>
      </div>
    </div>
    <div id="offline-banner" class="offline-banner hidden">
      ${icForPanelTemplate.offline13}
      <span id="offline-banner-text">No internet connection</span>
    </div>

    <!-- CONTENT AREA -->
    <div class="panel-content">

      <!-- ===================================================
           CHAT VIEW
      =================================================== -->
      <div class="view" id="view-chats">

        <!-- Sidebar -->
        <div class="chat-sidebar" id="chat-sidebar">
          <div class="sidebar-top">
            <div class="sidebar-row1">
              <button class="new-chat-btn" data-action="new-chat">
                ${icForPanelTemplate.plus12}
                New chat
              </button>
              <button class="favs-btn" id="favs-btn" data-action="toggle-favs">${icForPanelTemplate.starEmpty12} Favs</button>
              <button class="collapse-btn" data-action="collapse-sidebar" title="Collapse sidebar">
                ${icForPanelTemplate.chevronLeft12}
              </button>
            </div>
            <div class="chat-type-row">
              <button class="ctab-btn active" data-ctype="chats" data-action="set-chat-type" data-chat-type="chats">Chats</button>
              <button class="ctab-btn" data-ctype="quickq" data-action="set-chat-type" data-chat-type="quickq">${icForPanelTemplate.zap12} Quick Q</button>
            </div>
            <div class="sidebar-search">
              <span class="s-icon">
                ${icForPanelTemplate.search11}
              </span>
              <input type="text" placeholder="Search chats..." data-action="search-chats" id="chat-search-input">
              <button class="s-clear" data-action="clear-search" data-search-id="chat-search-input" title="Clear">${icForPanelTemplate.x10}</button>
            </div>
          </div>
          <div class="chat-list">
          </div>
        </div>

        <!-- Chat Main -->
        <div class="chat-main" id="chat-main">
          <button class="expand-sidebar-trigger" data-action="expand-sidebar" title="Show sidebar">
            ${icForPanelTemplate.chevronRight12}
          </button>
          <button class="chat-back-btn" data-action="back-from-chat">
            ${icForPanelTemplate.chevronLeft12}
            <span class="chat-back-label">All chats</span>
            <span class="chat-back-current-title is-empty" id="chat-current-title">New chat</span>
          </button>

          <div class="messages-area">

            <!-- Empty state: shown when no chat is open -->
            <div id="chat-empty-state" class="empty-chat-state">
              <img class="ecs-icon" id="chat-empty-extension-icon" src="" alt="" width="48" height="48" />
              <div class="ecs-title">Start a new conversation</div>
              <div class="ecs-sub">Ask anything about this page, attach a note, or pick from your history.</div>
              <div class="ecs-prompts">
                <button class="ecs-prompt-btn" data-action="use-prompt">Summarise this for me</button>
                <button class="ecs-prompt-btn" data-action="use-prompt">Explain this to me</button>
                <button class="ecs-prompt-btn" data-action="use-prompt">Help me with this task/question</button>
              </div>
            </div>

            <!-- Messages: populated by renderChatMessages() when a chat is selected -->
            <div id="chat-messages-content" class="hidden"></div><!-- /chat-messages-content -->

            <!-- Raw JSON view: shown by "View raw" dropdown option -->
            <div id="chat-raw-view" class="hidden">
              <div class="raw-view-header">
                <span class="raw-view-title">Raw messages</span>
                <div class="raw-view-actions">
                  <button class="raw-view-btn" data-action="toggle-raw-wrap" aria-pressed="false">Wrap</button>
                  <button class="raw-view-btn" data-action="copy-raw-chat">Copy</button>
                  <button class="raw-view-btn raw-view-back-btn" data-action="close-raw-view">Back</button>
                </div>
              </div>
              <pre id="chat-raw-view-content" class="raw-view-pre"></pre>
            </div>

          </div><!-- /messages-area -->

          <!-- Input area -->
          <div class="chat-input-area">
            <div class="input-chips-row"></div>
            <textarea class="chat-textarea" placeholder="Type your message..." rows="3"></textarea>
            <div class="input-bottom">
              <div class="input-left">
                <div style="position:relative">
                  <button class="attach-btn" id="attach-btn" data-action="toggle-attach-picker" title="Add context">
                    ${icForPanelTemplate.plus14}
                  </button>
                  <div class="attach-picker" id="attach-picker">
                    <button class="ap-item" data-action="open-image-upload"><span class="ap-icon">${icForPanelTemplate.image16}</span> Image upload</button>
                    <button class="ap-item" data-action="open-file-upload"><span class="ap-icon">${icForPanelTemplate.upload16}</span> File upload</button>
                    <button class="ap-item" data-action="capture-screenshot"><span class="ap-icon">${icForPanelTemplate.screenshot16}</span> Take screenshot</button>
                    <button class="ap-item" data-action="open-tab-picker"><span class="ap-icon">${icForPanelTemplate.browserTab16}</span> Browser tab content</button>
                    <button class="ap-item" data-action="open-note-picker"><span class="ap-icon">${icForPanelTemplate.fileText16}</span> Note</button>
                    <button class="ap-item" data-action="open-chat-picker"><span class="ap-icon">${icForPanelTemplate.message16}</span> Chat summary</button>
                    <button class="ap-item" data-action="spreadsheet-from-clipboard"><span class="ap-icon">${icForPanelTemplate.spreadsheet16}</span> Spreadsheet in page</button>
                  </div>
                  <input type="file" id="chat-image-input" data-action="chat-image-input-change" accept="image/png,image/jpeg,image/webp,image/gif" multiple hidden>
                  <input type="file" id="chat-file-input" data-action="chat-file-input-change" accept=".txt,.md,.markdown,.json,.csv,.pdf,.docx,.xlsx,.xls,.ods,.pptx,text/*" multiple hidden>
                </div>
                <div class="model-wrap">
                  <select class="model-select" id="chat-model-select" hidden>
                    <option value="google/gemini-3.1-flash-lite">Gemini 3.1 Flash Lite</option>
                    <option value="openai/gpt-4.1-mini">GPT-4.1 Mini</option>
                    <option value="anthropic/claude-haiku-4.5">Claude Haiku 4.5</option>
                  </select>
                  <button class="model-picker-btn" id="model-picker-btn" data-action="toggle-model-picker" title="Select model">
                    <span class="model-picker-label" id="model-picker-label">Select model</span>
                    ${icForPanelTemplate.modelPickerChevron10}
                  </button>
                  <div class="model-picker-dropdown" id="model-picker-dropdown">
                    <div class="mp-search-row">
                      <input type="text" class="mp-search" id="model-picker-search" data-action="filter-models" placeholder="Search models" autocomplete="off" spellcheck="false" />
                      <button class="s-clear mp-search-clear" data-action="clear-search" data-search-id="model-picker-search" title="Clear">${icForPanelTemplate.x10}</button>
                    </div>
                    <div class="mp-list" id="model-picker-list"></div>
                    <div class="mp-empty" id="model-picker-empty" hidden>No matching models</div>
                  </div>
                </div>
              </div>
              <button class="send-btn" data-action="send-chat">
                ${icForPanelTemplate.send14}
              </button>
            </div>
          </div>
        </div><!-- /chat-main -->

      </div><!-- /view-chats -->

      <!-- ===================================================
           NOTES VIEW
      =================================================== -->
      <div class="view hidden" id="view-notes">

        <!-- Notes Sidebar -->
        <div class="notes-sidebar">
          <div class="ns-header">
            <div class="ns-row1">
              <button class="sec-btn" data-action="open-note-editor">
                ${icForPanelTemplate.plus12}
                New note
              </button>
              <button class="favs-btn" id="note-favs-btn" data-action="toggle-note-favs">${icForPanelTemplate.starEmpty12} Favs</button>
              <button class="collapse-btn" data-action="collapse-notes-sidebar" title="Collapse sidebar">
                ${icForPanelTemplate.chevronLeft12}
              </button>
            </div>
            <div class="ns-search">
              <span class="s-icon">
                ${icForPanelTemplate.search11}
              </span>
              <input type="text" placeholder="Search notes..." data-action="search-notes" id="notes-search-input">
              <button class="s-clear" data-action="clear-search" data-search-id="notes-search-input" title="Clear">${icForPanelTemplate.x10}</button>
            </div>
          </div>
          <div class="notes-list">
          </div>
        </div>

        <!-- Note Editor -->
        <div class="note-editor" id="note-editor">
          <button class="expand-notes-sidebar-trigger" data-action="expand-notes-sidebar" title="Show sidebar">
            ${icForPanelTemplate.chevronRight12}
          </button>
          <button class="ne-back-btn" data-action="back-from-note">
            ${icForPanelTemplate.chevronLeft12}
            All notes
          </button>

          <!-- Pane empty state: visible in expanded mode when nothing is selected -->
          <div class="pane-empty-state" id="note-pane-empty">
            ${icForPanelTemplate.noteEdit32}
            <p>Select a note to edit it, or create a new one.</p>
          </div>
          <div class="note-popout-handoff hidden" id="note-popout-handoff">
            <p class="note-popout-handoff-title">This note is open in pop out mode for this tab.</p>
            <div class="note-popout-handoff-actions">
              <button class="btn-primary" data-action="focus-note-popout">Focus popout</button>
              <button class="btn-ghost" data-action="close-note-popout-handoff">Close popout</button>
            </div>
          </div>

          <!-- Actual editor: hidden until a note is selected or New note is clicked -->
          <div id="note-editor-form" class="hidden" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
            <div class="ne-header">
              <!-- Preview mode: plain text display -->
              <div class="ne-title-display untitled" id="ne-title-display">Untitled</div>
              <!-- Edit mode: editable input -->
              <input class="ne-title-input" id="ne-title" type="text" placeholder="Note title...">
              <!-- Edit button shown in preview mode -->
              <button class="btn-icon ne-edit-btn" title="Edit note" data-action="enter-note-edit-mode">
                ${icForPanelTemplate.noteEdit13}
              </button>
            </div>
            <div class="ne-body">
              <!-- Preview mode: rendered output -->
              <div class="ne-preview" id="ne-preview"></div>
              <!-- Edit mode: raw text -->
              <div class="ne-body-ta-wrap">
                <textarea class="ne-body-ta" id="ne-body" rows="8" placeholder="Write anything — plain text, markdown, JSON, code…"></textarea>
              </div>
              <div id="ne-tags-section">
                <div class="field-label">Tags</div>
                <div class="tags-wrap" id="ne-tags-wrap">
                  <input class="tags-input ne-tags-input" id="ne-tags-input" type="text" placeholder="Add tag…">
                </div>
              </div>
              <div id="ne-attachments-section">
                <div class="field-label">Attachments</div>
                <div class="ne-attach-row" id="ne-attachments">
                  <button class="btn-ghost btn-sm ne-attach-add" data-action="add-note-attachment">+ Add</button>
                </div>
                <input type="file" id="ne-attach-file-input" data-action="ne-attach-file-input-change" style="display:none" accept=".txt,.md,.markdown,.json,.csv,.pdf,.docx,.xlsx,.xls,.ods,.pptx,text/*,image/png,image/jpeg,image/webp,image/gif" multiple>
              </div>
            </div>
            <div class="ne-footer">
              <!-- Preview mode footer -->
              <div class="ne-preview-btns" style="align-items:center;gap:6px;width:100%">
                <button class="btn-primary" data-action="enter-note-edit-mode">Edit</button>
                <button class="btn-ghost" data-action="open-note-popout">Pop out</button>
                <button class="btn-danger" id="ne-delete-btn" data-action="delete-note" style="margin-left:auto">Delete</button>
              </div>
              <!-- Edit mode footer -->
              <div class="ne-edit-btns" style="align-items:center;gap:6px;width:100%">
                <button class="btn-primary" data-action="save-note">Save</button>
                <button class="btn-ghost" data-action="exit-note-edit-mode">Cancel</button>
                <button class="btn-danger" id="ne-delete-btn-edit" data-action="delete-note" style="margin-left:auto">Delete</button>
              </div>
            </div>
          </div>
        </div>

      </div><!-- /view-notes -->

      <!-- ===================================================
           TASKS VIEW
      =================================================== -->
      <div class="view hidden" id="view-tasks">

        <!-- Tasks Main -->
        <div class="tasks-main">
          <div class="tasks-header">
            <div class="tasks-row1">
              <button class="sec-btn" style="flex:0;white-space:nowrap;gap:5px" data-action="new-task">
                ${icForPanelTemplate.plus12}
                New task
              </button>
              <div class="filter-tabs" style="margin-left:auto">
                <button class="ftab active" data-filter="all" data-action="set-task-filter" data-filter="all">All</button>
                <button class="ftab" data-filter="pending" data-action="set-task-filter" data-filter="pending">Pending</button>
                <button class="ftab" data-filter="completed" data-action="set-task-filter" data-filter="completed">Completed</button>
              </div>
            </div>
            <div class="task-search">
              <span class="s-icon">
                ${icForPanelTemplate.search11}
              </span>
              <input type="text" placeholder="Search tasks..." data-action="search-tasks" id="task-search-input">
              <button class="s-clear" data-action="clear-search" data-search-id="task-search-input" title="Clear">${icForPanelTemplate.x10}</button>
            </div>
          </div>
          <div class="tasks-list">
          </div>
        </div>

        <!-- Task Editor Pane -->
        <div class="task-editor-pane" id="task-editor-pane">
          <button class="tep-back-btn" data-action="back-from-task">
            ${icForPanelTemplate.chevronLeft12}
            All tasks
          </button>

          <!-- Pane empty state: visible in expanded mode when nothing is selected -->
          <div class="pane-empty-state" id="task-pane-empty">
            ${icForPanelTemplate.calendar32}
            <p>Select a task to edit it, or create a new one.</p>
          </div>

          <!-- Actual editor: hidden until a task is selected or New task is clicked -->
          <div id="task-editor-form" class="hidden" style="display:flex;flex-direction:column;flex:1;overflow:hidden;">
            <div class="tep-header">
              <span class="tep-title" id="tep-title">New Task</span>
              <button class="btn-icon" data-action="close-task-editor">
                ${icForPanelTemplate.x12}
              </button>
            </div>
            <div class="tep-body">
              <div class="form-row">
                <label class="form-label">Title <span class="required-dot">*</span></label>
                <input class="form-input" id="tep-title-input" type="text" placeholder="Task title…">
              </div>
              <div class="form-row">
                <label class="form-label">Notes <span style="font-weight:400;text-transform:none;font-size:12px;color:var(--text-muted)">(optional)</span></label>
                <textarea class="form-ta" id="tep-notes" placeholder="Add details…"></textarea>
              </div>
              <div class="form-row">
                <label class="form-label">Due date &amp; time <span class="required-dot">*</span></label>
                <input class="form-input" id="tep-due" type="datetime-local" data-action="tep-due-change">
              </div>
              <div class="form-row">
                <label class="form-label">Reminder <span class="required-dot">*</span></label>
                <input class="form-input" id="tep-reminder" type="datetime-local">
              </div>
            </div>
            <div class="tep-footer">
              <button class="btn-primary btn-sm" data-action="save-task">Save</button>
              <button class="btn-ghost btn-sm" id="tep-markdone-btn" data-action="mark-task-done">Mark done</button>
              <button class="btn-danger btn-sm" id="tep-delete-btn" data-action="delete-task">Delete</button>
            </div>
          </div>
        </div>

      </div><!-- /view-tasks -->

      <!-- ===================================================
           SETTINGS VIEW
      =================================================== -->
      <div class="view hidden" id="view-settings">
        <div class="settings-inner">

          <div class="stg-section">
            <div class="stg-section-title">Appearance</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Theme</strong>
                <span>Light, dark, or follow system preference</span>
              </div>
              <select class="stg-select" data-action="apply-theme-settings">
                <option value="light">Light</option>
                <option value="dark">Dark</option>
                <option value="system">System</option>
              </select>
            </div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Header button</strong>
                <span>What the button in the panel header does: quickly toggle light/dark, or sync your data across tabs.</span>
              </div>
              <select class="stg-select" data-action="apply-header-btn">
                <option value="theme">Theme toggle</option>
                <option value="sync">Sync across tabs</option>
              </select>
            </div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Sync now</strong>
                <span>Manually refresh chats, notes, tasks, and quiz questions across all open tabs. Handy when the header button is set to theme toggle.</span>
              </div>
              <button class="btn-ghost btn-sm" id="settings-sync-now-btn" data-action="sync-all">Sync</button>
            </div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Transparent when inactive</strong>
                <span>Fade the floating panel when your mouse isn't over it, so you can see the page underneath. Reduced view only.</span>
              </div>
              <label class="ts"><input type="checkbox" id="settings-transparency-toggle" data-action="toggle-panel-transparency"><span class="ts-slider"></span></label>
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">API</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>OpenRouter API Key</strong>
                <span>Stored locally, never synced</span>
              </div>
              <input class="stg-input mono" type="password" id="settings-api-key-input" value="" placeholder="sk-or-v1-..." data-action="save-api-key">
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Models</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Default chat model</strong>
                <span>Used for new conversations</span>
              </div>
              <select class="stg-select" id="settings-default-model-select" data-action="save-default-model">
                <option value="anthropic/claude-sonnet-4-5">Claude Sonnet 4.5</option>
                <option value="openai/gpt-4.1">GPT-4.1</option>
                <option value="openai/gpt-4.1-mini">GPT-4.1 Mini</option>
                <option value="google/gemini-2.5-pro">Gemini 2.5 Pro</option>
              </select>
            </div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Image generation model</strong>
                <span>Choose which model is used when generating images</span>
              </div>
              <select class="stg-select" id="settings-image-model-select" data-action="save-image-model"></select>
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Agent</div>
            <div class="stg-row stg-row-col">
              <div class="stg-label">
                <strong>Custom instructions</strong>
                <span>Injected into every new chat</span>
              </div>
              <textarea class="stg-input stg-textarea" id="settings-agent-rules-input" placeholder="e.g. Always respond in Spanish. Keep answers concise." style="min-height:80px"></textarea>
              <div class="stg-agent-rules-footer">
                <span class="stg-agent-rules-saved-msg" id="agent-rules-saved-msg"></span>
                <button class="btn-primary btn-sm" data-action="save-agent-rules-btn">Save</button>
              </div>
            </div>
            <div class="stg-row stg-agent-manage-row">
              <button class="stg-agent-manage-btn" data-action="set-tab" data-tab="skills">Manage Skills <span class="stg-agent-manage-count" id="settings-skills-count">(0)</span></button>
              <button class="stg-agent-manage-btn" data-action="set-tab" data-tab="memory">Manage Memory <span class="stg-agent-manage-count" id="settings-memory-count">(0)</span></button>
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Behaviour</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Alert sound</strong>
                <span>Play sound for reminders and agent prompts</span>
              </div>
              <label class="ts"><input type="checkbox" id="settings-alert-sound-toggle" data-action="save-alert-sound"><span class="ts-slider"></span></label>
            </div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Reminder lead time</strong>
                <span>Minutes before due date (default)</span>
              </div>
              <input class="stg-input" type="number" id="settings-reminder-lead-time" data-action="save-reminder-lead-time" value="15" min="0" max="1440" style="max-width:80px">
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Advanced automation</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Let the assistant control pages</strong>
                <span>Click, type, and act on pages the normal tools cannot reach, such as spreadsheet grids and other canvas apps. Chrome shows a "debugging this browser" banner while it runs.</span>
              </div>
              <label class="ts"><input type="checkbox" id="settings-automation-toggle" data-action="toggle-automation"><span class="ts-slider"></span></label>
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Experimental</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Keep runs alive across page reloads</strong>
                <span>Run the assistant in the background so an in-progress task keeps going even when the page navigates or reloads (for example, after it submits a form). If you notice any issues, turn this off to use the in-page mode.</span>
              </div>
              <label class="ts"><input type="checkbox" id="settings-offscreen-loop-toggle" data-action="toggle-offscreen-loop"><span class="ts-slider"></span></label>
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Data</div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Storage used</strong>
                <span id="settings-storage-estimate">...</span>
              </div>
            </div>
            <div class="stg-row">
              <div class="stg-label">
                <strong>Delete chats older than</strong>
                <span>Pinned chats are excluded</span>
              </div>
              <select class="stg-select" id="settings-delete-chats-older-than" data-action="save-delete-chats-older-than">
                <option value="">Never</option>
                <option value="30">30 days</option>
                <option value="60">60 days</option>
                <option value="90">90 days</option>
                <option value="180">6 months</option>
                <option value="365">1 year</option>
              </select>
            </div>
            <div class="stg-data-row">
              <button class="btn-ghost btn-sm" data-action="prune-orphaned-blobs">Prune orphaned blobs</button>
              <span class="stg-agent-rules-saved-msg" id="settings-prune-blobs-result"></span>
            </div>
          </div>

          <div class="stg-section">
            <div class="stg-section-title">Logs</div>
            <div class="stg-data-row">
              <button class="btn-ghost btn-sm" data-action="set-tab" data-tab="logs">View API logs</button>
            </div>
          </div>

        </div>
      </div><!-- /view-settings -->

      <!-- ===================================================
           LOGS VIEW
      =================================================== -->
      <div class="view hidden" id="view-logs">
        <div class="logs-topbar">
          <button class="logs-back-btn" data-action="set-tab" data-tab="settings">&#8592; Settings</button>
          <span class="logs-topbar-title">API Logs</span>
          <button class="btn-ghost btn-sm" data-action="clear-api-logs">Clear all</button>
        </div>
        <div class="logs-list-container" id="logs-list-container">
          <div class="logs-empty" id="logs-empty-state">No API logs recorded yet.</div>
        </div>
        <div class="logs-pagination-bar" id="logs-pagination-bar"></div>
        <div class="logs-detail hidden" id="logs-detail-overlay">
          <div class="logs-topbar">
            <button class="logs-back-btn" data-action="close-log-detail">&#8592; Back</button>
            <span class="logs-topbar-title">Log Detail</span>
            <button class="btn-ghost btn-sm" data-action="toggle-log-view" id="log-view-toggle-btn">JSON</button>
            <button class="btn-ghost btn-sm hidden" data-action="toggle-log-wrap" id="log-wrap-toggle-btn" aria-pressed="false">Wrap</button>
            <button class="btn-ghost btn-sm" data-action="copy-log-detail">Copy</button>
          </div>
          <div class="logs-detail-body" id="logs-detail-body"></div>
        </div>
      </div><!-- /view-logs -->

      <!-- ===================================================
           SKILLS VIEW
      =================================================== -->
      <div class="view hidden" id="view-skills">
        <div class="logs-topbar">
          <button class="logs-back-btn" data-action="set-tab" data-tab="settings">&#8592; Settings</button>
          <span class="logs-topbar-title">Skills</span>
          <button class="btn-ghost btn-sm agent-add-btn" data-action="skill-new">${icForPanelTemplate.plus12} Add</button>
        </div>
        <div class="agent-manage-list" id="skills-list-container">
          <div class="logs-empty" id="skills-empty-state">No skills yet. Skills are reusable instructions the agent applies on demand.</div>
        </div>
        <div class="agent-editor hidden" id="skill-editor-overlay">
          <div class="logs-topbar">
            <button class="logs-back-btn" data-action="skill-editor-cancel">&#8592; Back</button>
            <span class="logs-topbar-title" id="skill-editor-heading">New skill</span>
            <button class="btn-primary btn-sm" data-action="skill-editor-save">Save</button>
          </div>
          <div class="agent-editor-body">
            <div class="agent-editor-field">
              <label class="agent-editor-label" for="skill-editor-slug">Command</label>
              <div class="agent-editor-slug-wrap">
                <span class="agent-editor-slug-prefix">/</span>
                <input class="stg-input agent-editor-slug-input" id="skill-editor-slug" type="text" autocomplete="off" spellcheck="false" maxlength="100" placeholder="summarize-page">
              </div>
              <span class="agent-editor-hint">Lowercase letters, numbers and hyphens only. Used as a /command.</span>
            </div>
            <div class="agent-editor-field">
              <label class="agent-editor-label" for="skill-editor-title-input">Title</label>
              <input class="stg-input agent-editor-full" id="skill-editor-title-input" type="text" maxlength="100" placeholder="Short, descriptive name">
            </div>
            <div class="agent-editor-field">
              <label class="agent-editor-label" for="skill-editor-body">Instructions</label>
              <textarea class="stg-input stg-textarea agent-editor-textarea" id="skill-editor-body" placeholder="Numbered steps for the agent, e.g.&#10;1. Find the comment box&#10;2. Click it to reveal the editor&#10;3. Fill in the text&#10;4. Stop; let the user click Post"></textarea>
              <span class="agent-editor-hint">Write self-contained, numbered steps the agent can follow on its own later: be specific about each action and why, and stop before anything that submits, sends, or deletes so it can be confirmed first.</span>
            </div>
            <div class="agent-editor-error" id="skill-editor-error"></div>
          </div>
        </div>
      </div><!-- /view-skills -->

      <!-- ===================================================
           MEMORY VIEW
      =================================================== -->
      <div class="view hidden" id="view-memory">
        <div class="logs-topbar">
          <button class="logs-back-btn" data-action="set-tab" data-tab="settings">&#8592; Settings</button>
          <span class="logs-topbar-title">Memory</span>
          <button class="btn-ghost btn-sm agent-add-btn" data-action="memory-new">${icForPanelTemplate.plus12} Add</button>
        </div>
        <div class="agent-manage-list" id="memory-list-container">
          <div class="logs-empty" id="memory-empty-state">Nothing remembered yet. Memory entries are facts the agent keeps across chats.</div>
        </div>
        <div class="agent-editor hidden" id="memory-editor-overlay">
          <div class="logs-topbar">
            <button class="logs-back-btn" data-action="memory-editor-cancel">&#8592; Back</button>
            <span class="logs-topbar-title" id="memory-editor-heading">New entry</span>
            <button class="btn-primary btn-sm" data-action="memory-editor-save">Save</button>
          </div>
          <div class="agent-editor-body">
            <div class="agent-editor-field">
              <label class="agent-editor-label" for="memory-editor-input">Entry</label>
              <textarea class="stg-input stg-textarea agent-editor-textarea" id="memory-editor-input" maxlength="280" placeholder="e.g. The user prefers concise answers."></textarea>
              <span class="agent-editor-hint">One fact per entry. Keep it short.</span>
            </div>
            <div class="agent-editor-error" id="memory-editor-error"></div>
          </div>
        </div>
      </div><!-- /view-memory -->

      <!-- ===================================================
           QUIZ VIEW
      =================================================== -->
      <div class="view hidden" id="view-quiz">

        <!-- Question List -->
        <div class="quiz-main" id="quiz-main">
          <div class="quiz-header">
            <div class="quiz-row1">
              <button class="sec-btn" data-action="open-quiz-editor">
                ${icForPanelTemplate.plus12}
                New question
              </button>
              <button class="session-btn" data-action="start-session">
                ${icForPanelTemplate.play11}
                Start session
                <span class="due-count-badge" id="session-due-count">0</span>
              </button>
            </div>
            <div class="quiz-filter-tabs">
              <button class="qftab active" data-qfilter="all" data-action="set-quiz-filter" data-filter="all">All</button>
              <button class="qftab" data-qfilter="due" data-action="set-quiz-filter" data-filter="due">Due <span class="due-count-badge" id="filter-due-count">0</span></button>
              <button class="qftab" data-qfilter="paused" data-action="set-quiz-filter" data-filter="paused">Paused</button>
            </div>
          </div>
          <div class="questions-list" id="questions-list">
          </div><!-- /questions-list -->
        </div><!-- /quiz-main -->

        <!-- Quiz Editor / Answer Pane -->
        <div class="quiz-editor-pane" id="quiz-editor-pane">

          <button class="qep-back-btn" data-action="back-from-quiz">
            ${icForPanelTemplate.chevronLeft12}
            All questions
          </button>

          <!-- Empty state -->
          <div class="pane-empty-state" id="quiz-pane-empty">
            ${icForPanelTemplate.question28}
            <p>Select a question to answer it,<br>or create a new one.</p>
          </div>

          <!-- Editor form (hidden by default) -->
          <div id="quiz-editor-form" class="hidden" style="display:flex;flex-direction:column;overflow:hidden;flex:1">
            <div class="qep-header">
              <span class="qep-pane-title" id="qep-form-title">New Question</span>
            </div>
            <div class="qep-body">

              <!-- Title -->
              <div class="form-row">
                <label class="form-label">Title <span class="required-dot">*</span></label>
                <input class="form-input" id="qep-title-input" type="text" placeholder="Short label for this question">
              </div>

              <!-- Question text -->
              <div class="form-row">
                <label class="form-label">Question <span class="required-dot">*</span></label>
                <textarea class="form-ta" id="qep-question-text" placeholder="Write the question..." style="min-height:72px"></textarea>
              </div>

              <!-- Type toggle -->
              <div class="form-row">
                <label class="form-label">Type</label>
                <div class="type-toggle">
                  <button class="type-btn active" id="type-mcq-btn" data-action="set-question-type" data-question-type="mcq">MCQ</button>
                  <button class="type-btn" id="type-fitb-btn" data-action="set-question-type" data-question-type="fitb">Fill in the blank</button>
                </div>
              </div>

              <!-- MCQ options -->
              <div id="mcq-fields">
                <div class="form-row">
                  <label class="form-label">Options <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">— select the correct one</span></label>
                  <div class="mcq-options">
                    <div class="mcq-option-row is-correct">
                      <input type="radio" name="mcq-correct" class="mcq-correct-radio" checked data-action="update-correct-option">
                      <input class="mcq-option-input" type="text" value="A function that retains access to its outer scope after the outer function returns" placeholder="Option A">
                    </div>
                    <div class="mcq-option-row">
                      <input type="radio" name="mcq-correct" class="mcq-correct-radio" data-action="update-correct-option">
                      <input class="mcq-option-input" type="text" value="A function that is defined inside a class" placeholder="Option B">
                    </div>
                    <div class="mcq-option-row">
                      <input type="radio" name="mcq-correct" class="mcq-correct-radio" data-action="update-correct-option">
                      <input class="mcq-option-input" type="text" value="A function that runs immediately after being defined" placeholder="Option C">
                    </div>
                    <div class="mcq-option-row">
                      <input type="radio" name="mcq-correct" class="mcq-correct-radio" data-action="update-correct-option">
                      <input class="mcq-option-input" type="text" value="A function that accepts another function as an argument" placeholder="Option D">
                    </div>
                  </div>
                </div>
              </div>

              <!-- FITB fields (hidden by default) -->
              <div id="fitb-fields" class="hidden">
                <div class="form-row">
                  <label class="form-label">Correct answer <span class="required-dot">*</span></label>
                  <input class="form-input" id="fitb-answer" type="text" placeholder="The exact correct answer">
                </div>
                <div class="form-row">
                  <label class="form-label">Accepted alternatives</label>
                  <div class="alt-answers-wrap" id="alt-answers-wrap">
                    <span class="alt-pill">lexical<span class="ic-remove" data-action="remove-alt-pill">${icForPanelTemplate.x10}</span></span>
                    <span class="alt-pill">outer<span class="ic-remove" data-action="remove-alt-pill">${icForPanelTemplate.x10}</span></span>
                    <input class="alt-input" id="alt-input" type="text" placeholder="Type and press Enter...">
                  </div>
                </div>
                <div class="form-row">
                  <label class="form-label">Case sensitive</label>
                  <div class="cs-row">
                    <span class="cs-label">Match must be case-exact (e.g. for variable names)</span>
                    <label class="ts"><input type="checkbox" id="fitb-case-sensitive"><span class="ts-slider"></span></label>
                  </div>
                </div>
              </div>

              <!-- Explanation -->
              <div class="form-row">
                <label class="form-label">Explanation <span style="font-size:11px;font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-muted)">— shown after a wrong answer</span></label>
                <textarea class="form-ta" id="qep-explanation" placeholder="Optional: explain why the correct answer is right..." style="min-height:56px"></textarea>
              </div>

            </div><!-- /qep-body -->
            <div class="qep-footer">
              <button class="btn-primary btn-sm" data-action="save-question">Save</button>
              <button class="btn-ghost btn-sm" data-action="cancel-quiz-editor">Cancel</button>
              <button class="btn-danger btn-sm" id="qep-delete-btn" data-action="delete-question" style="display:none">Delete</button>
              <span class="qep-error-msg hidden" id="qep-error-msg"></span>
            </div>
          </div><!-- /quiz-editor-form -->

          <!-- Answer view (hidden by default) -->
          <div id="quiz-answer-view" class="hidden" style="display:flex;flex-direction:column;overflow:hidden;flex:1">

            <!-- Header: single-question mode -->
            <div class="qav-header" id="qav-header-single">
              <span class="qav-progress" id="qav-single-title">Closure definition</span>
              <button class="qav-exit-btn" title="Close" data-action="close-answer-view">${icForPanelTemplate.x13}</button>
            </div>

            <!-- Header: session mode (hidden initially) -->
            <div class="qav-header hidden" id="qav-header-session">
              <span class="qav-session-label">Session</span>
              <span class="qav-progress" id="qav-session-progress">Question 1 of 2</span>
              <button class="qav-exit-btn" title="End session" data-action="close-answer-view">${icForPanelTemplate.x13}</button>
            </div>

            <div class="qav-body" id="qav-body">

              <div class="qav-meta">
                <span class="qav-type-chip qi-badge-mcq qi-badge" id="qav-type-chip">MCQ</span>
                <span class="qav-question-title" id="qav-qtitle">Closure definition</span>
              </div>

              <div class="qav-question-text" id="qav-qtext">
                Which of the following best describes what a closure is in JavaScript?
              </div>

              <!-- MCQ options (shown for MCQ questions) -->
              <div class="qav-options" id="qav-mcq-options">
                <button class="qav-option" data-action="select-option">
                  <span class="qav-letter">A</span>
                  A function that retains access to its outer scope after the outer function returns
                </button>
                <button class="qav-option" data-action="select-option">
                  <span class="qav-letter">B</span>
                  A function that is defined inside a class constructor
                </button>
                <button class="qav-option" data-action="select-option">
                  <span class="qav-letter">C</span>
                  A function that runs immediately after being defined (IIFE)
                </button>
                <button class="qav-option" data-action="select-option">
                  <span class="qav-letter">D</span>
                  A function that accepts another function as an argument
                </button>
              </div>

              <!-- FITB input (hidden for MCQ) -->
              <div class="qav-fitb-row hidden" id="qav-fitb-row">
                <input class="qav-fitb-input" id="qav-fitb-input" type="text" placeholder="Type your answer...">
                <button class="btn-primary btn-sm" data-action="submit-fitb">Check</button>
              </div>

              <!-- Feedback (hidden until answer submitted) -->
              <div class="qav-feedback" id="qav-feedback"></div>

            </div><!-- /qav-body -->

            <div class="qav-footer" id="qav-footer">
              <!-- Submit button for MCQ -->
              <button class="btn-primary btn-sm" id="qav-submit-btn" data-action="submit-mcq" disabled>Submit</button>
              <!-- Next button (shown after answering) -->
              <button class="btn-ghost btn-sm hidden" id="qav-next-btn" data-action="next-question">Next →</button>
              <!-- Skip (session mode only) -->
              <button class="qav-skip-btn hidden" id="qav-skip-btn" data-action="skip-question">Skip</button>
              <!-- Pause / Resume button -->
              <button class="qav-pause-btn hidden" id="qav-pause-btn" data-action="open-pause-dialog">
                ${icForPanelTemplate.pause11}
                <span id="qav-pause-label">Pause</span>
              </button>
            </div>

          </div><!-- /quiz-answer-view -->

          <!-- Pause dialog overlay -->
          <div class="pause-dialog hidden" id="pause-dialog">
            <div class="pause-dialog-card">
              <div class="pause-dialog-hdr">Pause question</div>
              <p class="pause-dialog-desc">Choose a date to resume. The question will be excluded from sessions until then.</p>
              <input class="pause-date-input" type="date" id="pause-date-input">
              <div class="pause-dialog-actions">
                <button class="btn-primary btn-sm" data-action="confirm-pause">Confirm pause</button>
                <button class="btn-ghost btn-sm" data-action="close-pause-dialog">Cancel</button>
              </div>
            </div>
          </div>

        </div><!-- /quiz-editor-pane -->

      </div><!-- /view-quiz -->

    </div><!-- /panel-content -->
  </div><!-- /panel -->
</div><!-- /panel-host -->

<!-- ============================================================
     INLINE CHAT OVERLAY
============================================================ -->
<div id="inline-overlay" class="hidden" data-theme="light">
  <div class="inline-modal">
    <div class="im-header">
      <span class="im-title">Quick Question</span>
      <button class="im-close" data-action="close-inline-chat">${icForPanelTemplate.x13}</button>
    </div>
    <!-- Highlighted text snippet -->
    <div class="im-snippet">
      <div class="im-snippet-label">Selected text</div>
      "closures are created every time a function is created, at function creation time."
    </div>
    <!-- Conversation (hidden until first message sent) -->
    <div class="im-conversation empty" id="im-conversation"></div>
    <!-- Input area -->
    <div class="im-body">
      <textarea class="im-ta" id="im-ta" placeholder="Ask about the selected text..." rows="2">What is the difference between a closure and a callback?</textarea>
    </div>
    <div class="im-footer">
      <span class="im-footer-note">Esc to close · saved to Quick Questions log</span>
      <div style="display:flex;gap:6px">
        <button class="im-cancel-btn" data-action="close-inline-chat">Cancel</button>
        <button id="im-send-btn" data-action="send-inline-message" style="border:1px solid #2563eb;border-radius:6px;padding:6px 13px;background:#2563eb;color:#fff;font-family:inherit;font-size:13px;cursor:pointer;display:flex;align-items:center;gap:6px">
          Ask
          ${icForPanelTemplate.send12}
        </button>
      </div>
    </div>
  </div>
</div>

<!-- ============================================================
     PICKER OVERLAY (note / chat selection)
============================================================ -->
<div id="picker-overlay" class="hidden" data-theme="light">
  <div class="picker-modal">
    <div class="pk-header">
      <span class="pk-title" id="pk-title">Select Note</span>
      <button class="pk-close" data-action="close-picker-modal">${icForPanelTemplate.x13}</button>
    </div>
    <div class="pk-search-wrap">
      <span class="pk-search-icon">
        ${icForPanelTemplate.search12}
      </span>
      <input class="pk-search" id="pk-search" type="text" placeholder="Search...">
      <button class="s-clear pk-search-clear" data-action="clear-search" data-search-id="pk-search" title="Clear">${icForPanelTemplate.x10}</button>
    </div>
    <div class="pk-list" id="pk-list"></div>
  </div>
</div>

<!-- ============================================================
     ATTACHMENT PREVIEW OVERLAY
============================================================ -->
<div id="attach-preview-overlay" class="hidden" data-theme="light">
  <div class="ap-modal">
    <div class="ap-header">
      <div class="ap-header-left">
        <span class="ap-icon">
          ${icForPanelTemplate.file13}
        </span>
        <span class="ap-title" id="ap-title"></span>
      </div>
      <button class="ap-close" data-action="close-attach-preview">${icForPanelTemplate.x13}</button>
    </div>
    <div class="ap-body ne-preview" id="ap-content"></div>
  </div>
</div>

<!-- ============================================================
     FEATURE TOUR OVERLAY
============================================================ -->
<div id="feature-tour-overlay" class="ft-overlay hidden" data-theme="light">
  <div class="ft-card">
    <div class="ft-illustration"></div>
    <div class="ft-content">
      <h2 class="ft-title"></h2>
      <p class="ft-desc"></p>
      <ul class="ft-bullets"></ul>
    </div>
    <div class="ft-footer">
      <div class="ft-dots"></div>
      <div class="ft-nav">
        <button class="ft-btn-skip" data-action="tour-skip">Skip tour</button>
        <div class="ft-nav-btns">
          <button class="ft-btn-back" data-action="tour-back">Back</button>
          <button class="ft-btn-next" data-action="tour-next">Next &rarr;</button>
        </div>
      </div>
    </div>
  </div>
</div>`;

  contentNamespaceForPanelTemplate.ui = contentNamespaceForPanelTemplate.ui || {};
  contentNamespaceForPanelTemplate.ui.panelTemplate = {
    buildMarkup: function buildMarkupForPanelTemplate() {
      return panelMarkupForPanelTemplate;
    }
  };

  globalScopeForPanelTemplate.ABChatContent = contentNamespaceForPanelTemplate;
})();
