(function () {
  const globalScopeForPanelData = globalThis;
  const contentNamespaceForPanelData = globalScopeForPanelData.ABChatContent || {};

const CHAT_DATA = [

  // ── REGULAR CHATS ──────────────────────────────────────────────────────────

  // 1. Developer
  {
    id: 1,
    title: 'Debug infinite re-render loop',
    summary: 'My useEffect keeps firing even though the dependency array looks right.',
    type: 'chat', isPinned: true,
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
    messages: [
      {
        id: 1, chatId: 1,
        role: 'user',
        chips: [{ type: 'page', label: 'github.com · PR #47' }],
        content: 'My useEffect keeps firing in an infinite loop even though the dependency array looks correct. Can you help me figure out why?',
      },
      {
        id: 2, chatId: 1,
        role: 'assistant',
        md: `The most common cause is an **object or array in the dependency array**. React compares deps by reference, not value — so a new object literal created on every render always looks "different" to the previous one.

\`\`\`js
// ❌ options is recreated on every render → infinite loop
useEffect(() => {
  fetchData(options);
}, [options]); // options = { page: 1 } defined inline above

// ✅ memoize it so the reference only changes when the value actually changes
const options = useMemo(() => ({ page }), [page]);
useEffect(() => {
  fetchData(options);
}, [options]);
\`\`\`

**Other things to check:**
- \`setState\` called inside \`useEffect\` without a guard condition
- A function reference in the deps array — wrap it in \`useCallback\` first
- If you genuinely want it to run once: \`[]\` is correct, but make sure nothing inside reads stale closure values`,
      },
      { role: '_loading' },
    ],
  },

  // 2. Student
  {
    id: 2,
    title: 'Summarise climate change paper',
    summary: 'Plain-language summary with key findings for my exam.',
    type: 'chat', isPinned: false,
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
    messages: [
      {
        id: 3, chatId: 2,
        role: 'user',
        chips: [{ type: 'page', label: 'nature.com · Climate study' }],
        content: 'Can you give me a plain-language summary of this paper and highlight the key findings I should remember for my exam?',
      },
      {
        id: 4, chatId: 2,
        role: 'assistant',
        md: `Here's the breakdown:

**What the study asked:** Whether urban heat island effects amplify regional warming beyond global average projections.

**Key findings:**
1. Cities in temperate zones are warming **1.5–2× faster** than surrounding rural areas.
2. The effect is strongest at night, when concrete and asphalt release stored heat.
3. Green roofs and urban tree canopy reduced local temperatures by up to **3°C** in modelled scenarios.

**Methodology:** Satellite surface temperature data from 2000–2023 combined with ground sensor networks — stronger than earlier studies that relied on sensors alone.

**For your exam, focus on:**
- The **urban heat island** mechanism (heat storage in built surfaces)
- The **1.5–2× amplification** figure
- The mitigation finding: green infrastructure reduces local temps by ~3°C

Want me to generate quiz questions from this to help you revise?

\`\`\`mermaid
flowchart TD
  A["Solar heat hits the city"] --> B["Absorbed by concrete & asphalt"]
  B --> C["Stored during the day"]
  C --> D["Released at night — urban air stays warm"]
  F["Reduced vegetation in cities"] --> G["Less evaporative cooling"]
  G --> D
  D --> E["Urban temps 1.5–2× higher than rural"]
  E --> H["Urban Heat Island Effect"]
\`\`\``,
      },
    ],
  },

  // 3. Finance
  {
    id: 3,
    title: 'Apple Q2 earnings breakdown',
    summary: 'Key takeaways and whether to be concerned about the guidance.',
    type: 'chat', isPinned: false,
    createdAt: '2026-04-17T00:00:00.000Z', updatedAt: '2026-04-17T00:00:00.000Z',
    messages: [
      {
        id: 5, chatId: 3,
        role: 'user',
        chips: [{ type: 'page', label: 'investor.apple.com' }],
        content: 'What are the key takeaways from this Q2 earnings report and should I be concerned about the forward guidance?',
      },
      {
        id: 6, chatId: 3,
        role: 'assistant',
        md: `**Revenue:** $94.8B (+5% YoY), slightly above analyst consensus of $94.0B.

**Segment breakdown:**

| Segment | Revenue | YoY |
|---|---|---|
| iPhone | $46.8B | +2% |
| Services | $23.9B | +14% |
| Mac | $7.5B | +8% |
| iPad | $5.6B | −15% |
| Wearables | $7.9B | −3% |

**Gross margin:** 46.6% — a new record, driven by Services mix.

**On the guidance:** Management guided Q3 to $85–$88B vs the $89B analyst estimate. They cited FX headwinds (~$1.5B impact) and iPad timing (new models ship late Q3). This isn't alarming — the FX drag is mechanical and the iPad timing is known.

**What to watch:** Services revenue crossing $100B annualised (on track for Q4). That's the structural shift that drives long-term margin expansion.`,
      },
    ],
  },

  // 4. Writer
  {
    id: 4,
    title: 'Outline: future of remote work',
    summary: 'Structure and angle suggestions for a general-audience article.',
    type: 'chat', isPinned: false,
    createdAt: '2026-04-17T00:00:00.000Z', updatedAt: '2026-04-17T00:00:00.000Z',
    messages: [
      {
        id: 7, chatId: 4,
        role: 'user',
        chips: [{ type: 'note', label: 'Remote Work Research' }],
        content: 'Help me structure my article on the future of remote work. I want it compelling for a general audience, not just tech workers.',
      },
      {
        id: 8, chatId: 4,
        role: 'assistant',
        md: `Based on your research notes, the strongest angle is the **geography shift** story — remote work isn't just about productivity, it's quietly reshaping where people choose to live and which cities grow or decline.

**Proposed structure:**

1. **Hook** — Open with a specific person: a nurse practitioner who moved from San Francisco to rural Montana, still employed by the same Bay Area health group. Concrete, relatable, not a tech-worker story.

2. **The numbers** — What the data actually shows post-pandemic. Hybrid is the norm; fully remote is shrinking but still 3× pre-2020 levels.

3. **The geography effect** — Midsize cities gaining population; megacities stabilising. Zillow and Census Bureau data supports this.

4. **The counter-narrative** — RTO mandates, the productivity debate, manager trust issues. Acknowledge the tension.

5. **What's next** — Async-first culture, AI as the remote worker's equaliser, the four-day week as the next front.

6. **Close** — Return to your opening character. Where are they now?

**One thing to cut from your notes:** the coworking space growth section — it weakens the geography thesis and muddies the focus.`,
      },
    ],
  },

  // 5. Medical
  {
    id: 5,
    title: 'Hypertension trial explained',
    summary: 'Plain-language breakdown and what it means for practice.',
    type: 'chat', isPinned: false,
    createdAt: '2026-04-17T00:00:00.000Z', updatedAt: '2026-04-17T00:00:00.000Z',
    messages: [
      {
        id: 9, chatId: 5,
        role: 'user',
        chips: [{ type: 'page', label: 'pubmed.ncbi.nlm.nih.gov' }],
        content: 'Break this clinical trial down in plain terms. What does it actually mean for how I should manage hypertension in my patients?',
      },
      {
        id: 10, chatId: 5,
        role: 'assistant',
        md: `**What the trial tested:** Intensive BP target (<120 mmHg systolic) vs standard (<140 mmHg) in adults 50+ with elevated cardiovascular risk, over a 5-year follow-up.

**Primary outcome:** The intensive group had a **25% reduction** in major cardiovascular events (MI, stroke, heart failure hospitalisation, CVD death).

**The trade-off:** Higher adverse events in the intensive group — hypotension, syncope, and AKI — approximately 4% vs 2% in the standard group.

**What this means in practice:**
- **High-risk patients** (prior CVD, CKD, 10-year ASCVD risk >15%): the benefit likely outweighs the risk. A target of 120–130 mmHg is defensible.
- **Older, frail patients** or those on multiple antihypertensives: stick with <140. The AKI and fall risk from hypotension are real.
- **Thiazide-like diuretics and CCBs** achieved better tolerability than ACEi/ARB monotherapy in the intensive arm.

**One caveat:** The trial excluded patients with diabetes and eGFR <20. Don't extrapolate to those populations.

\`\`\`mermaid
flowchart TD
  A["Hypertension confirmed"] --> B{High CV risk?}
  B -->|"Yes — prior CVD, CKD, ASCVD >15%"| C["Target: 120–130 mmHg"]
  B -->|No| D{Older or frail?}
  D -->|Yes| E["Target: <140 mmHg"]
  D -->|No| C
  C --> F["Monitor: AKI, hypotension, syncope"]
  E --> G["Standard monitoring"]
\`\`\``,
      },
    ],
  },

  // 6. Email
  {
    id: 6,
    title: 'Reply to unhappy client',
    summary: 'Professional, empathetic reply that keeps the relationship intact.',
    type: 'chat', isPinned: false,
    createdAt: '2026-04-17T00:00:00.000Z', updatedAt: '2026-04-17T00:00:00.000Z',
    messages: [
      {
        id: 11, chatId: 6,
        role: 'user',
        chips: [{ type: 'shot', label: 'Screenshot' }],
        content: "Help me write a professional, empathetic reply that addresses their concerns without admitting fault or throwing my team under the bus.",
      },
      {
        id: 12, chatId: 6,
        role: 'assistant',
        md: `Here's a draft:

---

**Subject:** Re: Project Delay — Next Steps

Hi [Name],

Thank you for reaching out directly — I understand how frustrating a delay like this is when your own timelines depend on ours.

I want to be straightforward: we hit an unexpected integration issue in the final testing phase that we should have flagged to you earlier. That's on us, and I'm sorry we didn't communicate it sooner.

Here's where we stand:

- The core deliverable is complete and in final QA.
- We're targeting delivery by **[date]**, and I'll personally confirm that by end of day Wednesday.
- I'd like to schedule a 20-minute call this week to walk you through what we're handing over.

Your confidence in us matters. We want to earn it back on this project.

[Your name]

---

**Notes on the draft:**
- "That's on us" owns the communication failure without admitting the underlying issue was negligence.
- No passive-voice hedging — clients read straight through "we regret any inconvenience."
- The concrete date and call offer give them something tangible to hold onto.`,
      },
    ],
  },

  // 7. Social media (with image generation)
  {
    id: 7,
    title: 'Captions and image for new drop',
    summary: 'Caption options with hashtags and a preview image for the launch post.',
    type: 'chat', isPinned: false,
    createdAt: '2026-04-16T00:00:00.000Z', updatedAt: '2026-04-16T00:00:00.000Z',
    messages: [
      {
        id: 13, chatId: 7,
        role: 'user',
        content: "Write 3 Instagram caption options with hashtags for our new streetwear collection drop, and generate a preview image for the launch post. Vibe: urban, premium, limited. Audience is 18–30.",
      },
      {
        id: 14, chatId: 7,
        role: 'assistant',
        md: `Here are three captions — different tones so you can match the visual:

**Option 1 — Minimal / cryptic**
> The drop you've been circling.
> Limited. 📍

\`#newdrop #streetwear #limitededition #urban #exclusive\`

---

**Option 2 — Community-first**
> Made for the ones who move early.
> New collection. Drop date in bio. You know the drill.

\`#streetwear #newcollection #streetfashion #urbanwear #limitedrun\`

---

**Option 3 — Direct / hype**
> Waited long enough. It's here.
> Tap the link. Don't sleep on this one.

\`#newdrop #streetwear #premiumstreet #hypefashion #limitedstock\`

---

**My pick:** Option 1 for a teaser post, Option 3 for launch day.

Here's a generated preview image for the launch post:

![Streetwear launch preview](https://placehold.co/1080x1080/111111/ffffff?text=NEW+DROP)`,
      },
      {
        id: 15, chatId: 7,
        role: 'user',
        content: "Love option 1. Can you write reply templates for the comments I'll get — 'when does it drop?', 'price?', 'do you ship internationally?'",
      },
      {
        id: 16, chatId: 7,
        role: 'assistant',
        md: `Here are ready-to-paste reply templates:

**"When does it drop?"**
> Date's dropping in stories tomorrow 👀 turn on notifications so you don't miss it.

**"Price?"**
> Check the link in bio for full pricing — you won't be disappointed 🖤

**"Do you ship internationally?"**
> Yes! We ship worldwide. Delivery times and rates at checkout.

**Bonus — for hype comments ("NEED THIS", "🔥🔥"):**
> 👀 don't sleep

**Tips:**
- Reply within the first hour while the algorithm is still distributing the post.
- Keep it short — one sentence max. Longer replies feel corporate.
- Pin the most useful comment (e.g. drop date) so latecomers find it fast.`,
      },
    ],
  },

  // ── QUICK CHATS ────────────────────────────────────────────────────────────

  // 8. Developer
  {
    id: 8,
    title: 'Quick Questions · Apr 15',
    summary: 'Should this be === instead of ==? What is the actual difference?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-15T00:00:00.000Z', updatedAt: '2026-04-15T00:00:00.000Z',
    messages: [
      {
        id: 17, chatId: 8,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'if (userId == req.params.id) {\n  return res.json(profile);\n}' }],
        content: 'Should this be === instead of ==? What is the actual difference?',
      },
      {
        id: 18, chatId: 8,
        role: 'assistant',
        md: `Yes, use \`===\` here. \`userId\` is likely a number from the database while \`req.params.id\` is always a **string** — \`==\` coerces the types and hides the mismatch, which can cause subtle auth bugs.

\`===\` (strict) checks both value **and** type. \`==\` (loose) coerces first:

\`\`\`js
1 == '1'   // true  — type coercion masks the mismatch
1 === '1'  // false — correctly different types
\`\`\`

**Rule:** always use \`===\`. The one common exception is \`x == null\`, which checks for both \`null\` and \`undefined\` in one expression — a deliberate, concise pattern.`,
      },
    ],
  },

  // 9. Student
  {
    id: 9,
    title: 'Quick Questions · Apr 14',
    summary: 'What is the difference between correlation and causation?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-14T00:00:00.000Z', updatedAt: '2026-04-14T00:00:00.000Z',
    messages: [
      {
        id: 19, chatId: 9,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'Ice cream sales were strongly correlated with increased drowning rates across all coastal study regions (r = 0.91, p < 0.001).' }],
        content: 'This makes no sense — ice cream causes drowning? What am I missing about correlation vs causation?',
      },
      {
        id: 20, chatId: 9,
        role: 'assistant',
        md: `You've spotted a classic example. Both are driven by a **third variable**: warm weather. That's a confounding variable — it causes both, making them move together with no direct link between them.

**Correlation** means two things move together statistically.
**Causation** means one thing *directly causes* the other.

**How to tell them apart:**
- Correlation: you observe two things happening at the same time
- Causation: you need a plausible mechanism, controlled experiments, and confounders ruled out

**The gold standard for establishing causation** is a randomised controlled trial (RCT) — random assignment eliminates confounders because both groups are identical on average except for the variable being tested. Observational studies can only suggest correlation.

The Pearson \\( r \\) in the selected passage quantifies the strength of that relationship:

$$
r = \\frac{\\sum(x_i - \\bar{x})(y_i - \\bar{y})}{\\sqrt{\\sum(x_i - \\bar{x})^2 \\cdot \\sum(y_i - \\bar{y})^2}}
$$

An \\( r \\) of 0.91 means an extremely strong positive correlation — but as you've spotted, strength of correlation says nothing about causation.`,
      },
    ],
  },

  // 10. Finance
  {
    id: 10,
    title: 'Quick Questions · Apr 13',
    summary: 'What is a P/E ratio and should I be worried about a P/E of 68?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-13T00:00:00.000Z', updatedAt: '2026-04-13T00:00:00.000Z',
    messages: [
      {
        id: 21, chatId: 10,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'NVIDIA currently trades at a P/E of 68, compared to the semiconductor sector average of 24.' }],
        content: 'What does this actually mean and should I be worried about a P/E of 68?',
      },
      {
        id: 22, chatId: 10,
        role: 'assistant',
        md: `**P/E ratio** = Share price ÷ Earnings per share. It tells you how much investors are paying for each $1 of a company's annual earnings.

$$
\\text{P/E} = \\frac{\\text{Market price per share}}{\\text{EPS}}
$$

A P/E of 68 means investors are paying $68 for every $1 of annual earnings.

**What a high P/E signals:** The market expects strong *future* growth — investors are paying a premium for earnings that don't exist yet. For NVIDIA, that expectation is driven by AI chip demand. The risk: if growth disappoints, the stock reprices hard.

**Context matters:** 68 vs a sector average of 24 is elevated, but NVIDIA's growth rate justifies some premium. Compare it against its own historical P/E range and use the PEG ratio (P/E ÷ earnings growth rate) — a PEG below 1 is generally considered undervalued even with a high P/E.`,
      },
    ],
  },

  // 11. Writer
  {
    id: 11,
    title: 'Quick Questions · Apr 12',
    summary: 'Should I flip this sentence to active voice?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-12T00:00:00.000Z', updatedAt: '2026-04-12T00:00:00.000Z',
    messages: [
      {
        id: 23, chatId: 11,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'The findings were compiled by researchers at three universities over a period of two years.' }],
        content: 'Should I flip this to active voice, or does passive work here?',
      },
      {
        id: 24, chatId: 11,
        role: 'assistant',
        md: `Flip it. The actor matters here and the passive buries it:

**Active:** *"Researchers at three universities compiled the findings over two years."*

That's tighter and puts the who front and centre.

**When passive is the right call:**
1. The actor is unknown or irrelevant — *"Three people were killed."*
2. You're protecting a source — *"The documents were leaked."*
3. The receiver of the action is the story — *"The award was given to a 12-year-old refugee."*

**The quick test:** drop "by [actor]" from your sentence. If it still makes sense, the actor wasn't important and passive is fine. Here — *"The findings were compiled over two years"* — you lose meaningful context. So: active.`,
      },
    ],
  },

  // 12. Medical
  {
    id: 12,
    title: 'Quick Questions · Apr 11',
    summary: 'Could this be viral? What is the difference between viruses and bacteria for treatment?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-11T00:00:00.000Z', updatedAt: '2026-04-11T00:00:00.000Z',
    messages: [
      {
        id: 25, chatId: 12,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'Patient was prescribed amoxicillin but returned 5 days later with no improvement. Throat swab pending.' }],
        content: 'Could this be viral? What is the fundamental difference between viruses and bacteria in terms of treatment?',
      },
      {
        id: 26, chatId: 12,
        role: 'assistant',
        md: `Yes, this pattern is a red flag for a viral cause — amoxicillin won't touch a virus.

| | Bacterium | Virus |
|---|---|---|
| Type | Living cell (prokaryote) | Non-living particle |
| Size | 1–10 μm | 20–300 nm |
| Reproduction | Divides independently | Hijacks host cell machinery |
| Treatment | **Antibiotics** | **Antivirals** / supportive care |

**Why antibiotics fail against viruses:** They target bacterial structures — cell walls, ribosomes, DNA gyrase — none of which exist in viruses. Prescribing them for viral illness drives resistance with zero therapeutic benefit.

**Next step:** The pending throat swab is the right call. A rapid Strep test alongside viral PCR (if available) will clarify. If bacterial culture is negative and presentation fits viral pharyngitis, supportive care is the appropriate path.`,
      },
    ],
  },

  // 13. Email
  {
    id: 13,
    title: 'Quick Questions · Apr 10',
    summary: 'How do I follow up on an unanswered email without seeming pushy?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-10T00:00:00.000Z', updatedAt: '2026-04-10T00:00:00.000Z',
    messages: [
      {
        id: 27, chatId: 13,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'I wanted to follow up on the proposal I sent last Tuesday. Please let me know if you have any questions or need additional information.' }],
        content: "I sent this 4 days ago with no reply. How do I follow up without sounding desperate or passive-aggressive?",
      },
      {
        id: 28, chatId: 13,
        role: 'assistant',
        md: `Your current draft is too apologetic and vague — it invites no action. Try this instead:

> *"Hi [name] — just floating this back to the top of your inbox in case it got buried. Happy to jump on a quick call if that's easier than email."*

**What makes this work:**
- "Got buried" assumes positive intent — they're busy, not ignoring you
- No guilt-tripping ("I haven't heard back…")
- Offering a call lowers the friction — some people won't reply to email but will take a call
- Under 30 words: easy to read and act on

**Timing:** 4 days is fine for a warm contact. For cold outreach, wait 5–7 days. Reply to the same thread — don't start a new email. After two follow-ups with no response, try a different channel or move on.`,
      },
    ],
  },

  // 14. Social media
  {
    id: 14,
    title: 'Quick Questions · Apr 9',
    summary: 'Is this posting-time advice accurate for a streetwear brand?',
    type: 'quickq', isPinned: false,
    createdAt: '2026-04-09T00:00:00.000Z', updatedAt: '2026-04-09T00:00:00.000Z',
    messages: [
      {
        id: 29, chatId: 14,
        role: 'user',
        chips: [{ type: 'selection', label: 'Selected text', content: 'Lifestyle accounts see peak engagement between 8–10 am and 6–8 pm on weekdays, with Tuesday and Wednesday performing strongest.' }],
        content: 'Is this accurate for a streetwear brand, or is our audience different?',
      },
      {
        id: 30, chatId: 14,
        role: 'assistant',
        md: `The general benchmark is a reasonable starting point, but streetwear audiences skew younger (18–30) and behave differently from broad lifestyle accounts.

**More relevant windows for fashion/streetwear:**

| Window | Why it works |
|---|---|
| 7–9 am | Morning scroll before school or work |
| 12–1 pm | Lunch break browse |
| 8–11 pm | Prime evening time for under-30s |

**Friday and Saturday evenings** tend to outperform for streetwear specifically — people are in a spending mindset and have more time to explore.

**The real answer:** check your own Instagram Insights under *Audience > Most Active Times*. Your specific followers' behaviour outweighs any benchmark.

**What actually drives reach:** early saves and shares in the first 60 minutes signal the algorithm to push the post wider. A strong post at a mediocre time beats a weak post at peak time, every time.`,
      },
    ],
  },

];

const NOTE_DATA = [
  {
    id: 1,
    title: 'Git Cheatsheet',
    body: '## Everyday Commands\n\n- `git stash` / `git stash pop` — shelve and restore uncommitted changes\n- `git log --oneline --graph` — visual branch history\n- `git bisect start` — binary search for the commit that introduced a bug\n- `git rebase -i HEAD~3` — interactive rebase of the last 3 commits\n\n## Undoing Things\n\n- `git restore <file>` — discard working directory changes\n- `git reset HEAD~1 --soft` — undo last commit, keep changes staged\n- `git revert <hash>` — safe undo: creates a new commit that reverses the target',
    tags: ['git', 'developer'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-18T00:00:00.000Z',
    updatedAt: '2026-04-18T00:00:00.000Z',
  },
  {
    id: 2,
    title: 'How to Read a Research Paper',
    body: "## The Three-Pass Method\n\n**Pass 1 — 5–10 min:** Read title, abstract, intro, headings, and conclusion only. Decide if it's worth reading fully.\n\n**Pass 2 — 1 hour:** Read everything except proofs. Note key figures, tables, and citations to follow up.\n\n**Pass 3 — 4–5 hours (if needed):** Re-implement the work mentally. Question every assumption.\n\n## Questions to Ask\n\n- What claim is being made?\n- What evidence supports it?\n- What limitations do the authors acknowledge?\n- What did they *not* measure?\n\n## Pass Decision Flowchart\n\n```mermaid\nflowchart TD\n  A[\"New paper\"] --> B{\"Relevant and novel?\"}\n  B -->|No| C[\"Skip it\"]\n  B -->|Yes| D[\"Pass 1: skim headings, intro and conclusion\"]\n  D --> E{\"Worth reading fully?\"}\n  E -->|No| C\n  E -->|Yes| F[\"Pass 2: read fully, note figures and citations\"]\n  F --> G{\"Need deep understanding?\"}\n  G -->|No| H[\"Done\"]\n  G -->|Yes| I[\"Pass 3: question every assumption\"]\n  I --> H\n```",
    tags: ['study', 'research', 'academic'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-18T00:00:00.000Z',
    updatedAt: '2026-04-18T00:00:00.000Z',
  },
  {
    id: 3,
    title: 'Investment Principles (Personal)',
    body: "## Rules I Follow\n\n1. **Index first.** 80% of portfolio in low-cost index funds (VWRL, S&P 500 ETF).\n2. **Individual stocks only with a thesis.** If I can't write a paragraph on why I own it, I don't own it.\n3. **No daily price checking.** Monthly review, quarterly rebalance.\n4. **Emergency fund is not an investment.** 6 months of expenses in a high-yield savings account, untouched.\n\n## Metrics I Track per Stock\n\n- P/E vs sector average\n- Revenue growth (3-year CAGR)\n- Free cash flow margin\n- Debt-to-equity ratio\n\n## CAGR Formula\n\nRevenue growth (3-year CAGR) is calculated as:\n\n$$\nCAGR = \\left(\\frac{V_f}{V_i}\\right)^{\\frac{1}{n}} - 1\n$$\n\nWhere \\( V_f \\) = final value, \\( V_i \\) = initial value, \\( n \\) = number of years. A CAGR above 15% over 3 years is the threshold I use to flag a stock as high-growth.",
    tags: ['finance', 'investing'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-17T00:00:00.000Z',
    updatedAt: '2026-04-17T00:00:00.000Z',
  },
  {
    id: 4,
    title: 'Remote Work Research',
    body: "## Key Statistics\n\n- 28% of US workers fully remote as of 2024 (vs 4% pre-2020) — BLS\n- Hybrid is now dominant: 54% of knowledge workers — McKinsey 2024\n- Midsize cities (100k–500k pop) saw 8% net population inflow from metros 2021–2023 — Census Bureau\n\n## Sources to Cite\n\n- Stanford WFH Research Project (Nick Bloom)\n- McKinsey \"Future of Work\" 2024 report\n- Zillow Remote Work Housing Report Q3 2024\n\n## Angles\n\n- Productivity debate (contested — don't lead with this)\n- Geography/migration angle (strongest — use as the spine)\n- RTO backlash and manager trust dynamics\n- Four-day week as the next frontier",
    tags: ['writing', 'research', 'remote-work'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-17T00:00:00.000Z',
    updatedAt: '2026-04-17T00:00:00.000Z',
  },
  {
    id: 5,
    title: 'Antihypertensive Drug Classes',
    body: '## First-Line Agents\n\n| Class | Example | Mechanism | Avoid in |\n|---|---|---|---|\n| ACE inhibitor | Lisinopril | Blocks angiotensin conversion | Pregnancy, bilateral RAS |\n| ARB | Losartan | Blocks AT1 receptor | Pregnancy |\n| Thiazide diuretic | Chlorthalidone | Reduces plasma volume | Gout |\n| CCB (dihydropyridine) | Amlodipine | Vasodilation | — |\n| Beta-blocker | Metoprolol | Reduces HR and cardiac output | Asthma, COPD |\n\n## Combination Therapy Notes\n\n- ACEi/ARB + CCB + thiazide: the classic triple combo\n- **Never** combine ACEi + ARB (ONTARGET trial: harm, no added benefit)\n- Add spironolactone for resistant hypertension (4th-line)',
    tags: ['medical', 'cardiology', 'pharmacology'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  },
  {
    id: 6,
    title: 'Email Templates — Saved',
    body: "## Follow-Up After No Reply\n\n> Hi [name] — just floating this to the top of your inbox in case it got buried. Happy to jump on a quick call if that's easier.\n\n## Declining Politely\n\n> Thanks so much for thinking of me. I'm going to have to pass this time — my plate is full and I wouldn't be able to give it the attention it deserves. Hope we can work together another time.\n\n## Requesting a Decision\n\n> I want to keep things moving on our end. Could you let me know your thoughts by [date]? Totally understand if you need more time — just say the word.\n\n## Cold Outreach (Intro)\n\n> Hi [name] — I'll keep this short. I [specific reason for reaching out]. Would a 15-minute call this week or next be possible?",
    tags: ['email', 'templates', 'communication'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-16T00:00:00.000Z',
    updatedAt: '2026-04-16T00:00:00.000Z',
  },
  {
    id: 7,
    title: 'Content Strategy — Posting Plan',
    body: '## Weekly Content Mix\n\n- **Mon:** Educational carousel (evergreen tip in your niche)\n- **Wed:** Relatable Reel or meme — drives shares\n- **Fri:** Personal story or behind-the-scenes — builds connection\n- **Sun:** Product or service post — audience is warmed up by now\n\n## Caption Formula\n\n1. **Hook** — first line stops the scroll\n2. **Body** — value, story, or question\n3. **CTA** — one action: save, comment, or visit link\n\n## Hashtag Strategy\n\n- 3–5 niche tags (under 500k posts)\n- 2–3 mid-range (500k–2M)\n- 1 broad (2M+)\n- Avoid banned or overused tags — they suppress reach',
    tags: ['social-media', 'content', 'instagram'],
    attachments: [],
    noteType: 'user',
    sourceChatId: null,
    createdAt: '2026-04-15T00:00:00.000Z',
    updatedAt: '2026-04-15T00:00:00.000Z',
  },
];

const TASK_DATA = [
  { id: 1, title: 'Follow up with Jordan on the Q2 proposal',    body: 'Sent Monday — no reply yet. Keep it light, reference the email templates note.',                                   dueAt: '2026-04-20T09:00', reminderAt: '2026-04-20T08:30', isCompleted: false, createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
  { id: 2, title: 'Fix pagination bug on the dashboard',          body: 'Items skip when navigating from page 3+ back to page 1. Happens on filtered views only.',                             dueAt: '2026-04-21T17:00', reminderAt: '2026-04-21T09:00', isCompleted: false, createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
  { id: 3, title: 'Submit draft: "Future of Remote Work"',        body: 'Editor deadline is Friday 5 pm. Send to maya@publications.com.',                                                 dueAt: '2026-04-18T17:00', reminderAt: '2026-04-18T14:00', isCompleted: false, createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
  { id: 4, title: 'Complete 3 remaining CE credit modules',       body: 'Cardiology update modules 4, 5, and 6. License renewal deadline is end of month.',                                   dueAt: '2026-04-30T23:59', reminderAt: '2026-04-28T09:00', isCompleted: false, createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
  { id: 5, title: 'Review and merge auth module PR',              body: '',                                                                                                                    dueAt: '2026-04-10T17:00', reminderAt: '2026-04-10T16:30', isCompleted: true,  createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
  { id: 6, title: 'Fact-check sources — AI ethics article',  body: '',                                                                                                                    dueAt: '2026-04-12T12:00', reminderAt: '2026-04-12T10:00', isCompleted: true,  createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
  { id: 7, title: 'Prepare Q2 portfolio review notes',            body: 'Check allocations vs target. Review Apple, MSCI World, bonds. Update spreadsheet before the Friday call.',           dueAt: '2026-04-19T10:00', reminderAt: '2026-04-18T17:00', isCompleted: false, createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z' },
];

const QUIZ_DATA = [
  {
    id: 1, sourceChatId: null,
    title: 'P/E ratio — high vs low', type: 'mcq', isPaused: false, intervalStage: 1,
    dueAt: '2026-04-18',
    questionText: 'A company trades at a P/E of 65 while the sector average is 22. What does this most likely indicate?',
    options: [
      { text: 'The company is undervalued relative to its peers', isCorrect: false },
      { text: 'Investors expect higher future earnings growth than sector peers', isCorrect: true },
      { text: 'The company carries significantly more debt than its competitors', isCorrect: false },
      { text: 'The stock price has recently fallen sharply', isCorrect: false },
    ],
    correctAnswer: null, alternativeAnswers: [],
    explanation: "A P/E above the sector average signals investors are paying a premium, anticipating faster earnings growth. It doesn't speak directly to debt levels or recent price movements.",
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
  },
  {
    id: 2, sourceChatId: null,
    title: 'Establishing causation', type: 'fitb', isPaused: false, intervalStage: 2,
    dueAt: '2026-04-18',
    questionText: 'A randomised controlled trial can establish _____, while an observational study can only suggest correlation.',
    options: [],
    correctAnswer: 'causation', alternativeAnswers: ['cause', 'causal relationship'],
    caseSensitive: false,
    explanation: 'Random assignment eliminates confounding variables, allowing researchers to attribute changes in the outcome directly to the intervention — establishing causation rather than mere correlation.',
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
  },
  {
    id: 3, sourceChatId: null,
    title: 'Beta-blockers — mechanism', type: 'mcq', isPaused: false, intervalStage: 1,
    dueAt: '2026-04-21',
    questionText: 'Which best describes the primary mechanism of beta-blockers in treating hypertension?',
    options: [
      { text: 'Block calcium channels, causing arterial smooth muscle relaxation', isCorrect: false },
      { text: 'Inhibit angiotensin II production via the renin-angiotensin system', isCorrect: false },
      { text: 'Block adrenergic receptors, reducing heart rate and cardiac output', isCorrect: true },
      { text: 'Increase sodium excretion via the nephron, reducing plasma volume', isCorrect: false },
    ],
    correctAnswer: null, alternativeAnswers: [],
    explanation: 'Beta-blockers (e.g. metoprolol, bisoprolol) competitively block beta-adrenergic receptors, reducing the effect of adrenaline on the heart. This lowers heart rate and myocardial contractility, decreasing cardiac output and therefore blood pressure.',
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
  },
  {
    id: 4, sourceChatId: null,
    title: 'HTTP method — idempotency', type: 'fitb', isPaused: true, intervalStage: 1,
    dueAt: '2026-04-20', pausedUntil: '2026-04-20',
    questionText: 'The HTTP method _____ is idempotent and is the correct choice for a full resource replacement (not a partial update).',
    options: [],
    correctAnswer: 'PUT', alternativeAnswers: ['put'],
    caseSensitive: false,
    explanation: 'PUT is idempotent — calling it multiple times with the same payload produces the same result. PATCH is for partial updates. POST is not idempotent.',
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
  },
  {
    id: 5, sourceChatId: null,
    title: 'Instagram — early engagement signals', type: 'mcq', isPaused: false, intervalStage: 1,
    dueAt: '2026-04-18',
    questionText: "Which type of engagement most strongly signals to Instagram's algorithm to distribute a post more widely?",
    options: [
      { text: 'Profile visits triggered by the post', isCorrect: false },
      { text: 'Comments from followers', isCorrect: false },
      { text: 'Saves and shares within the first hour', isCorrect: true },
      { text: 'Story replies triggered by the post', isCorrect: false },
    ],
    correctAnswer: null, alternativeAnswers: [],
    explanation: 'Saves indicate the content was valuable enough to return to; shares distribute it beyond the original audience. Early velocity on both in the first 30–60 minutes is the strongest predictor of wider reach.',
    createdAt: '2026-04-18T00:00:00.000Z', updatedAt: '2026-04-18T00:00:00.000Z',
  },
];

  contentNamespaceForPanelData.data = {
    CHAT_DATA,
    NOTE_DATA,
    TASK_DATA,
    QUIZ_DATA,
    dbReadyPromise: null,
  };

  const dbReadyPromiseForPanelData = seedAndLoadDbForPanelData();
  contentNamespaceForPanelData.data.dbReadyPromise = dbReadyPromiseForPanelData;

  globalScopeForPanelData.ABChatContent = contentNamespaceForPanelData;

  async function seedAndLoadDbForPanelData() {
    try {
      const repoForPanelData = (globalThis.ABChatShared || {}).panelDataRepo;
      if (!repoForPanelData) return;

      await repoForPanelData.seedIfEmpty({
        chats:     CHAT_DATA,
        notes:     NOTE_DATA,
        tasks:     TASK_DATA,
        questions: QUIZ_DATA
      });

      // listChatsMeta fetches chat rows only (no messages) to keep startup memory low.
      // Messages are loaded lazily by panelRuntime when a chat is first opened.
      // REGRESSION RISK: do not switch this back to listChats(); that would eagerly load
      // all message data for every chat into memory at once.
      // The four list calls are independent, so run them in parallel to cut boot
      // wall-clock by ~3x compared to sequential awaits.
      const liveResultsForPanelData = await Promise.all([
        repoForPanelData.listChatsMeta(),
        repoForPanelData.listNotes(),
        repoForPanelData.listTasks(),
        repoForPanelData.listQuestions()
      ]);
      const liveChatsForPanelData     = liveResultsForPanelData[0];
      const liveNotesForPanelData     = liveResultsForPanelData[1];
      const liveTasksForPanelData     = liveResultsForPanelData[2];
      const liveQuestionsForPanelData = liveResultsForPanelData[3];

      const dataNsForPanelData = (globalThis.ABChatContent || {}).data;
      if (dataNsForPanelData) {
        dataNsForPanelData.CHAT_DATA = liveChatsForPanelData;
        dataNsForPanelData.NOTE_DATA = liveNotesForPanelData;
        dataNsForPanelData.TASK_DATA = liveTasksForPanelData;
        dataNsForPanelData.QUIZ_DATA = liveQuestionsForPanelData;
      }
    } catch (errForPanelDataSeed) {
      // Fall back to seed data already set synchronously above.
    }
  }
})();
