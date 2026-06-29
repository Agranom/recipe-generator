---
description: Draft agile tickets from rough notes, get approval, then create them in Jira via the Atlassian MCP.
argument-hint: "[rough description of the work] (optionally: project=KEY)"
---

# /file-tickets

Turn the user's request into well-formed tickets and, after explicit approval,
create them in Jira. Authoring is delegated to the `ticket-authoring` skill;
Jira specifics are handled entirely through the Atlassian MCP at runtime. Nothing
about any account or project is hardcoded — it is always discovered or asked for.

Input: `$ARGUMENTS`

## Step 1 — Explore the codebase (conditional)

Decide whether authoring needs project context. **Explore** when the request can't
be turned into accurate, grounded tickets without knowing how the code is structured
— e.g. changes to an existing feature or flow, bug reports whose offending code must
be located, or technical work (refactors, migrations, performance). **Skip** when
the request is a self-contained product idea that needs no codebase grounding, or
when the user already supplied enough context.

When exploration is needed, delegate it to the **`explore`** sub-agent (defined in
`.claude/agents/explore.md`) rather than exploring inline — this keeps the
orchestrator's context focused and prevents the noise of file reads and searches
from crowding out the authoring work. Give it a narrow brief: what feature/flow/bug
to investigate and what the tickets need to be accurate.

The `explore` agent returns a fixed context digest — affected areas, conventions &
patterns, relevant names, dependencies/risks/slicing hints, constraints, and open
questions. It is restricted to read-only tools (`Read`, `Glob`, `Grep`) at the
config level, so it is structurally unable to modify code or make implementation
decisions — its output is context for authoring, not a design.

Exploration is read-only and runs before any approval gate, so it needs no approval
of its own.

## Step 2 — Draft (use the skill, do not touch Jira yet)

Invoke the **ticket-authoring** skill on the input — plus the explore digest from
Step 1, if any — to produce the canonical artifacts (stories / bugs / tasks / epic,
with Gherkin acceptance criteria, the readiness gate, slicing, and
`blocks`/`blocked_by` dependencies). Use the digest to ground acceptance criteria in
real behavior, populate `references`, surface genuine dependencies, and inform
slicing — but carry it as *context and constraints only*, never as prescribed
implementation (the ticket states what and why; the developer owns how). Do not call
any Jira tool in this step.

## Step 3 — Resolve the target (read-only discovery)

Using the Atlassian MCP, discover rather than assume:

1. Get accessible resources to obtain the cloudId / site. If more than one site is
   accessible, ask the user which one.
2. List visible Jira projects (expanding issue types). Pick the project from a
   `project=KEY` argument if given; otherwise, if one obvious project fits, propose
   it; if ambiguous, ask. Confirm the project actually exposes the issue types the
   batch needs (e.g. it has a Bug type if the batch contains bugs) — if not, say so
   and ask how to proceed.
3. Read the project's create-screen field metadata for the relevant issue types so
   priority/labels/parent are only sent if the project accepts them.
4. List issue link types and note the one used for dependencies (e.g. "Blocks").

All of Step 3 is read-only; do it silently as setup.

## Step 4 — Preview and gate (REQUIRED — never skip)

Show a compact summary of what will be created: for each item its type, title,
target project, priority, labels, and any dependency expressed in plain language
("‘Send email notifications’ is blocked by ‘Replace deprecated email library’").
List any `status: Draft` items separately as **will be skipped** (they have open
questions). Then ask for explicit approval.

Do **not** call any create or link tool until the user clearly approves this batch.
Approval is per batch; a later run needs fresh approval. Creating issues is a
side-effectful write — this gate is the safety boundary and is mandatory.

## Step 5 — Create issues (pass 1, automated)

On approval, for each `Ready` artifact, create the issue via the MCP create tool
with: project, issue type (`type`), summary (`title`), description (the markdown
body, sent as markdown), and — only if the project's metadata accepts them —
priority (mapped via the portable scale), labels, and `parent` set to the epic's
key for children. Capture each returned issue key in memory against its artifact.
The user is not involved here and never handles a key.

Skip any `Draft` item.

## Step 6 — Link dependencies (pass 2, automated)

For every `blocks` / `blocked_by` relation, create the link via the MCP link tool
using the keys captured in Step 5 and the dependency link type. Links need both
issues to exist, which is the only reason this is a second pass.

Verify direction on the **first** link: after creating it, read one of the two
issues back and confirm the relationship reads as intended ("X is blocked by Y").
If the tracker stored it reversed, swap the argument order for the remaining links.
De-duplicate reciprocal relations into a single link.

## Step 7 — Report

Return a concise summary mapping each title to its created issue key and URL, and
list any skipped Draft items so the user can resolve and re-run.

## Safeguards

- **Read-only exploration:** the explore sub-agent never modifies code, runs
  side-effectful commands, or makes implementation decisions — it returns context
  only, and that context informs the ticket without dictating the solution.
- **Duplicate guard:** before creating, check whether an artifact was already filed
  in this session (a recorded key); if so, skip or update rather than duplicate. If
  a run is interrupted mid-batch, resume from the uncreated items using captured
  keys — never re-create.
- **Failure handling:** if a create or link call fails, stop, report which items
  succeeded (with keys) and which did not, and let the user decide before
  continuing. Never silently retry into duplicates.
- **No hardcoding:** site, project, field names, and link semantics come from the
  MCP at runtime. If the user points this command at a different Jira account or
  project, it just works — re-discover and proceed.
