---
name: ticket-authoring
description: >-
  Author well-formed agile backlog tickets — user stories, bugs, and tasks —
  from a product/PM perspective, ready to import into a ticketing system (Jira,
  Linear, etc.) and hand off to a developer or development agent. Use this
  whenever the user wants to write or refine a story, file or write up a bug,
  define a task, break a feature or epic down into work items, draft acceptance
  criteria, slice a large story, or prepare backlog items for a sprint — even
  when they don't say the word "story" or "ticket" (e.g. "turn this feature into
  work items", "write this up for the devs", "log this bug", "break this down",
  "make a ticket for this"). Produces one canonical, parseable artifact per item
  with frontmatter fields that map directly to ticket fields and Gherkin
  acceptance criteria a developer can turn into tests.
---

# Ticket Authoring

Turn a rough request — a feature idea, a complaint, a fix, a chunk of work — into
one or more **canonical backlog tickets** that import cleanly into Jira/Linear and
are unambiguous enough for a developer (human or agent) to implement without
guessing.

You are acting as the **product/PM side** of a handoff. A separate developer
consumes what you produce. The whole value of this skill is the *contract*: emit
the same parseable shape every time, gated on readiness, so the consumer never
receives a malformed or underspecified ticket.

---

## Workflow

Follow these steps in order for every request.

1. **Classify.** Decide the type of each item: `story`, `bug`, or `task`.
   See *Choosing the type* below. One request may produce several items of
   different types — emit one artifact per item.
2. **Gather.** Pull what you can from the conversation: the user/actor, the
   value, the trigger, known systems/APIs, constraints. Don't re-ask for things
   already stated.
3. **Check readiness.** Run the *Definition of Ready* gate. If a blocking unknown
   remains, either ask the user one focused question or emit the ticket as
   `status: Draft` with an Open Questions section (rule below).
4. **Write the artifact** using the canonical template for that type. Fill the
   frontmatter (maps to ticket fields) and the body (becomes the description).
5. **Slice if too big.** If the item can't plausibly be finished in one sprint,
   split it (see *Slicing*) and emit the pieces instead.
6. **Output.** Present each artifact in its own fenced block so it can be copied
   or parsed directly. Filing the tickets in a tracker is a separate, publisher-owned
   step — this skill stops at producing ready artifacts (see *Output and handoff*).

---

## Choosing the type

- **story** — new or changed user-facing capability framed by who wants it and
  why. Default for "we should let users…", "add the ability to…", a feature idea.
- **bug** — existing behavior is wrong. Use when there's a gap between what
  happens and what should happen. Requires reproduction.
- **task** — necessary work with no direct user-facing behavior change:
  migrations, refactors, infra, spikes, tooling, docs. No "As a… so that…"
  needed; framed by objective and definition of done.

When unsure between story and task, ask: *is there a user or business outcome a
non-engineer would care about?* Yes → story. No → task.

---

## The canonical artifact

Every ticket is **YAML frontmatter** (the fields that map to the ticketing
system) plus a **markdown body** (the ticket description). Keep field names and
order exactly as shown — a downstream import script depends on them.

### Shared frontmatter (all types)

```yaml
---
type: story | bug | task
title: <imperative, specific, < 70 chars>
priority: Urgent | High | Medium | Low      # maps to Linear priority / Jira priority
status: Ready | Draft                        # Draft = readiness gate not yet passed
labels: [<area>, <component>]                # optional
epic: <epic key / parent name, or null>      # optional
estimate: <number, or null>                  # human triage metadata ONLY; the dev ignores it
blocked_by: [<ticket refs>]                  # optional
blocks: [<ticket refs>]                      # optional
references: [<links to designs, API docs, specs>]   # optional
---
```

Notes:
- **priority** uses one portable 4-level scale (see
  `references/field-mapping.md`). Do not invent other levels.
- **estimate** exists only because the ticketing system has the field. Fill it
  only if the user asks. The developer must never treat it as a constraint.
- Leave optional fields out rather than writing `null` everywhere, except where
  the template marks a field as required for that type.

### Body templates per type

**story**
```markdown
## User story
As a <user/role>, I want <capability>, so that <value>.

## Context
<1–3 sentences of background: the problem, who hit it, why now. Optional.>

## Acceptance criteria
<Gherkin, one scenario per distinct behavior — including at least one failure/edge case.>
Scenario: <name>
  Given <precondition>
  When <action>
  Then <observable outcome>

## Out of scope
- <what this ticket explicitly does NOT cover>

## Assumptions
- <decisions you made on the user's behalf; the dev can challenge these>

## Open questions   <!-- include ONLY when status: Draft -->
- <blocking unknown>
```

**bug**
```markdown
## Summary
<one line: what's broken and impact>

## Environment
<platform / browser / version / user role where it occurs; "all" if unknown-but-broad>

## Steps to reproduce
1. <step>
2. <step>

## Current behavior
<what happens, including exact error text if any, and frequency e.g. "~10% of attempts, peak hours">

## Expected behavior
<what should happen>

## Acceptance criteria
<Gherkin defining "fixed", including the previously-failing path and a regression guard.>
Scenario: <name>
  Given <precondition>
  When <action>
  Then <correct outcome>

## Notes
<links, logs, suspected area — observations, NOT a prescribed fix>
```

**task**
```markdown
## Objective
<what must be true when this is done, and why it's needed>

## Context
<background, dependencies, what depends on this. Optional.>

## Definition of done
- [ ] <verifiable outcome 1>
- [ ] <verifiable outcome 2>
- [ ] <verification step: how we know it worked — test, metric, check>

## Constraints
- <hard requirements the dev MUST honor, e.g. "use the existing AuthService">

## Out of scope
- <explicitly excluded work>
```

---

## Rules that hold for every ticket

**Acceptance criteria are Gherkin (Given/When/Then), not checkboxes.** The
developer turns each scenario into a test, so write observable outcomes, not
intentions. Always include at least one failure or edge case — happy-path-only
criteria are the most common cause of bugs slipping through. Checkboxes are fine
only for a task's Definition of Done, which is a verification list rather than
behavior.

**State the *what* and the *why*; leave the *how* to the developer.** Name known
systems, APIs, and data the work touches, and record genuine hard constraints
under Constraints. Do **not** prescribe the implementation (no "add a Redis cache
with 5-minute TTL", no "add an index on users.email"). Prescribing the solution
over-constrains the consumer and hides the actual requirement. If a technical
choice is truly mandatory, it's a constraint — write it as one and say why.

**Record assumptions instead of silently resolving ambiguity.** When you fill a
gap with a reasonable default, put it under Assumptions so the developer can see
and challenge it. This keeps you moving without hiding decisions.

**One artifact per item.** If a request implies several pieces of work, emit
several tickets and use `blocks` / `blocked_by` to express ordering.

---

## Definition of Ready (the gate)

Emit `status: Ready` only when all of these hold:

- Type chosen and title is specific and imperative.
- **story:** the "so that" states real value; ≥ 1 Gherkin scenario incl. an edge case.
- **bug:** reproduction steps + current vs. expected behavior present.
- **task:** objective is clear and Definition of Done is verifiable.
- Dependencies (`blocked_by`/`blocks`) identified.
- No unresolved unknown that would change scope or behavior.

If a blocking unknown remains, choose one:

- **Ask the user one focused question** when the unknown materially changes scope,
  behavior, or which type the item is. Ask only the single most decision-relevant
  question; don't interrogate.
- **Emit `status: Draft`** with an *Open Questions* section when the work is mostly
  shaped but a non-blocking detail is missing, or when the user clearly wants
  drafts now and answers later.

Never emit `Ready` with open questions, and never block the whole batch on one
fuzzy item — ship the ready ones, draft the rest.

---

## Quality bar (INVEST) and slicing

Before finalizing a story, sanity-check it against INVEST: **I**ndependent,
**N**egotiable, **V**aluable, **E**stimable, **S**mall, **T**estable. The two
that fail most often are *Small* and *Testable* — if you can't write crisp
Gherkin, the story isn't understood well enough yet; if it can't fit in a sprint,
slice it.

**Slicing heuristics** (apply in roughly this order): split by workflow step;
by happy path vs. edge/error handling; by user role or segment; by data variation
(one format first); by CRUD operation; by interface (API before UI, or one
platform first). Each slice must independently deliver something demonstrable —
never slice into "build the backend" + "build the frontend".

When you split, the parent becomes an **epic** (frontmatter `epic:` on each child
points to it) and each child is a full ready ticket.

---

## Worked example (round trip)

**Input from user:**
> "Users keep complaining they can't find their old orders. We should let them
> search their order history."

**Output (one story, ready):**

```markdown
---
type: story
title: Search order history by keyword and date
priority: High
status: Ready
labels: [orders, search]
epic: null
estimate: null
references: []
---

## User story
As a returning customer, I want to search my order history by keyword and date
range, so that I can quickly find a past order without scrolling through everything.

## Context
Customers report being unable to locate old orders; the order history page is
currently an unfiltered chronological list.

## Acceptance criteria
Scenario: Find an order by product keyword
  Given I am signed in and on my order history page
  When I enter a product name in the search box
  Then I see only my orders containing a matching item
  And each result shows order date, total, and status

Scenario: Filter by date range
  Given I am on my order history page
  When I select a start and end date
  Then I see only my orders placed within that range

Scenario: No matching orders
  Given I am on my order history page
  When my search matches none of my orders
  Then I see an empty-state message and an option to clear the search

Scenario: Search is scoped to the signed-in user
  Given I am signed in
  When I search my order history
  Then I never see another customer's orders

## Out of scope
- Searching by order ID (separate ticket)
- Exporting search results

## Assumptions
- "Order history" means orders for the signed-in account only.
- Search covers the last 24 months unless a date range is set.
```

**What the developer does with it:** reads frontmatter → creates a High-priority
Story; reads the body → implements against the four scenarios as the test suite;
treats the assumptions as defaults it may flag if wrong. No implementation was
prescribed, so it's free to choose how search is built.

---

## Output and handoff

This skill's job ends at producing approved-ready artifacts. It does **not** file
tickets in any tracker — that is a separate, side-effectful step owned by a
publisher (for example, a command that calls a tracker's MCP). Keeping authoring
and publishing apart is deliberate: it keeps this skill universal across Jira,
Linear, GitHub Issues, or plain markdown, with no account, project, or tool-specific
detail baked in.

Produce each artifact in its own fenced block, in the canonical shape above, so a
publisher can parse it directly. Two contract points the publisher relies on:

- **`status`** tells the publisher what is safe to file. Only `Ready` items should
  be created; `Draft` items carry open questions and must be surfaced for the user
  to resolve first, not published.
- **`blocks` / `blocked_by`** express dependencies by referring to other artifacts
  in the same batch (by title or a local id). The publisher resolves these into
  real links after the tickets exist; this skill only has to state them correctly
  and de-duplicate (if A says `blocks: [B]` and B says `blocked_by: [A]`, that's one
  dependency, not two).

How the artifact's fields map onto a given tracker's fields, and the portable
priority scale, are described in `references/field-mapping.md` — but the exact field
names, link semantics, and project/account details are resolved by the publisher at
publish time through the tracker's own tools, not hardcoded here.

## Reference files

- `references/field-mapping.md` — tracker-agnostic guidance on how each artifact
  field maps onto a generic issue tracker, plus the portable priority scale. The
  publisher resolves tracker-specific names at runtime.
- `references/examples.md` — additional worked tickets: a bug, a task, a technical
  story, a non-functional (performance) story, and a full epic-slicing example.
  Read it when you need a pattern for a type or situation not covered above.
