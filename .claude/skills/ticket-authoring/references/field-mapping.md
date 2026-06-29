# Field mapping (tracker-agnostic)

How the canonical artifact maps onto a generic issue tracker. This file is
deliberately free of any specific tool, account, project, or API detail — a
publisher resolves those at runtime through the target tracker's own tools. The
purpose here is only to define the *intent* of each field so a publisher can map it
correctly to whatever tracker is in use (Jira, Linear, GitHub Issues, etc.).

## Field intent

| Artifact field | Maps to | Notes |
|---|---|---|
| `type` | the tracker's issue type | story / bug / task / epic — match to the project's enabled types |
| `title` | summary / title | required |
| body (markdown) | description | most trackers accept markdown or convert it; keep Gherkin fenced so indentation survives |
| `priority` | priority / urgency | via the portable scale below |
| `status` | initial workflow state | usually left to the tracker's default; `Draft` items are not published at all |
| `labels` | labels / tags | only if the project supports them |
| `epic` | parent / epic link | the publisher determines the correct mechanism for the project |
| `estimate` | estimate / points | human triage metadata only; never a constraint on the developer |
| `blocked_by` / `blocks` | dependency links | created after issues exist; see below |
| `references` | links in the description | designs, specs, API docs |

Acceptance criteria live inside the description body unless the tracker has a
dedicated field, in which case the publisher may split the `## Acceptance criteria`
section into it.

## Portable priority scale

The artifact uses four levels. A publisher maps them to whatever the target tracker
exposes — for example a five-level scheme would typically collapse as shown:

| Artifact | Typical 4-level | Typical 5-level |
|---|---|---|
| Urgent | Urgent | Highest |
| High | High | High |
| Medium | Medium | Medium |
| Low | Low | Low |

Never invent levels outside this set in the artifact; let the publisher do any
collapsing or renaming the tracker requires.

## Dependencies

`blocks` / `blocked_by` reference other artifacts in the same batch (by title or a
local id). Because a link needs both issues to exist, the publisher creates issues
first, then the links — this is the publisher's concern, not the author's. The
author's only jobs are to state dependencies correctly and de-duplicate (one
relationship, not two reciprocal ones).

Link direction is a common source of silent errors (trackers and their APIs don't
always agree on which side is the "blocker"). A publisher should verify direction
once against the live tracker rather than assuming, and express each dependency in
plain language ("X is blocked by Y") when previewing for approval so a human can
sanity-check it.

## Resolved at publish time, not here

Everything tracker-specific — exact field names, issue-type ids, link-type names,
project keys, account/workspace identifiers, and which create/link tools to call —
is discovered by the publisher at publish time through the tracker's own read tools.
Nothing of that belongs in this skill, which is why it isn't here.
