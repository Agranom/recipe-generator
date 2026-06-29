# Additional examples

Worked tickets for situations not shown in SKILL.md. Match the structure, not the
exact wording.

---

## Bug

**Input:** "Checkout fails sometimes during busy hours — people get a payment
gateway timeout. Maybe 1 in 10 at peak."

```markdown
---
type: bug
title: Checkout intermittently fails with payment gateway timeout at peak load
priority: Urgent
status: Ready
labels: [checkout, payments]
references: []
---

## Summary
~10% of checkouts fail during peak hours with a "payment gateway timeout" error,
blocking purchases.

## Environment
All platforms; production; observed during peak traffic windows.

## Steps to reproduce
1. Add an item to the cart and proceed to checkout during peak hours.
2. Submit valid payment details.
3. Observe intermittent failure.

## Current behavior
~1 in 10 attempts fail with "Payment gateway timeout." The order is not created
and the customer is left on the payment step with no clear next action.

## Expected behavior
Payment succeeds reliably under peak load; genuine failures show a clear,
actionable message and do not leave the customer stuck.

## Acceptance criteria
Scenario: Payment succeeds under peak load
  Given the system is under peak traffic
  When a customer submits valid payment details
  Then the payment is processed and the order is created

Scenario: Genuine failure is handled gracefully
  Given the payment gateway returns an error
  When a customer submits payment
  Then they see an actionable error message
  And they can retry without re-entering all details

## Notes
Suspected gateway latency under load. Investigate timeout/retry behavior — but the
fix approach is the dev's call; do not assume the root cause.
```

Note: the bug names the symptom and area but does **not** prescribe "increase
timeout to 30s, add 3 retries" — that's a solution, and locking it in could mask
the real cause.

---

## Task

**Input:** "We need to move the user search query off the unindexed path before the
new feature ships."

```markdown
---
type: task
title: Make user search performant ahead of saved-search feature
priority: Medium
status: Ready
labels: [search, performance]
blocks: [STORY-saved-search]
references: []
---

## Objective
User search must perform well enough to support the upcoming saved-search feature,
which will increase query volume.

## Context
Saved search (STORY-saved-search) depends on this; it should not ship on the
current slow path.

## Definition of done
- [ ] p95 user-search response time is under 200ms under representative load.
- [ ] Load test demonstrates the target and is repeatable.
- [ ] No regression in search result accuracy (existing search tests pass).

## Constraints
- Must work against the existing user data store; no schema migration in this task.

## Out of scope
- Any user-facing search UI changes.
```

The task states the *target* (p95 < 200ms) and how it's verified, but leaves
indexing/caching choices to the developer.

---

## Technical story

Use a story (not a task) when the work has a user-perceivable outcome even if the
driver is technical.

```markdown
---
type: story
title: Faster homepage load on mobile and desktop
priority: High
status: Ready
labels: [performance, web]
references: []
---

## User story
As a visitor, I want pages to load quickly, so that browsing feels smooth and I
don't abandon the site.

## Context
Slow loads correlate with bounce; current homepage misses Core Web Vitals targets.

## Acceptance criteria
Scenario: Homepage meets load budget on desktop
  Given a visitor opens the homepage on a desktop connection
  When the page loads
  Then it is interactive within the team's agreed budget (p90)

Scenario: Core Web Vitals pass on mobile
  Given a visitor opens the homepage on a mid-range mobile device
  When the page loads
  Then LCP, INP, and CLS are within Google's "good" thresholds

## Out of scope
- Pages other than the homepage.

## Assumptions
- "Good" thresholds are the current Core Web Vitals definitions.
```

The targets are requirements; "lazy-load images, code-split, use a CDN" are
implementation choices and belong to the developer, not the ticket.

---

## Epic slicing

**Input:** "I want a comprehensive dashboard so users can monitor all their metrics."

Too big for one ticket. Make it an epic and slice into independently shippable
stories, each delivering something demonstrable.

**Epic:** Dashboard for monitoring key metrics

Children (each a full `status: Ready` story with `epic:` pointing to the epic):

1. **View key metrics** — As a user, I want to see core metrics (revenue, active
   users) at a glance, so that I get a high-level read instantly. *(ship first;
   delivers value alone)*
2. **Filter metrics by date range** — so that I can analyze specific periods.
   `blocked_by: [story 1]`
3. **Export dashboard data to CSV** — so that I can analyze it elsewhere.
   `blocked_by: [story 1]`
4. **Customize which metrics display** — so that I can focus on what matters to me.
   `blocked_by: [story 1]`

Each slice is a vertical, demonstrable increment — none of them is "build the
backend" or "build the UI", which would not be independently valuable.
