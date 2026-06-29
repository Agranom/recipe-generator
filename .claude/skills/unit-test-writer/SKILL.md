---
name: unit-test-writer
description: >-
  Write fast, isolated, deterministic Jest unit tests for TypeScript/JavaScript
  code following best practices. Use this whenever the user wants to add or
  improve unit tests, get a function/class/module "under test", raise coverage,
  or test code that has dependencies (injected services, imported modules, HTTP
  clients, the filesystem, timers, randomness). Trigger this even when the user
  just says "write tests for X", "add a spec", "cover this with tests", "mock
  this dependency", or "test this service". Covers test design, mocking/stubbing
  strategy, async assertions, and determinism — not end-to-end or integration
  tests that hit real external systems.
---

# Writing good Jest unit tests

A **unit test** is fast (milliseconds), isolated (exercises one unit, its
collaborators faked), and deterministic (same result every run — no network, no
real clock, no randomness, no shared state between tests). If a test reaches the
network, a database, or a real cloud/3rd-party service, it isn't a unit test —
that's integration testing, which is out of scope here.

Your goal: choose the smallest amount of mocking that isolates the unit, then
assert the unit's *observable behaviour* — not how it's implemented internally.
Tests coupled to internals break on every refactor and protect nothing.

## Before writing anything

1. **Read the unit in full.** You can't fake a boundary you haven't seen. Note
   its inputs/outputs, which collaborators it calls, and — crucially — *how* it
   gets them: passed in (constructor/params), imported from another module, or
   constructed inside itself. That distinction decides your mocking strategy.
2. **Classify the unit** so you use the least machinery that works:
   - **Pure function** (output depends only on input, no side effects) — no
     mocking at all. These are the cheapest, highest-value tests; cover them
     thoroughly across the input space and edge cases.
   - **Unit with *injected* dependencies** (deps arrive via constructor or
     arguments) — the easy case: pass in fakes. No module mocking needed.
   - **Unit that *imports or constructs* its dependencies itself** (a top-level
     `import`, or `new SomeClient()` inside the body/constructor) — you can't
     inject those, so mock at the module level with `jest.mock(...)`.
3. **Match real shapes.** Build fixtures from the actual types/models the code
   uses, not invented shapes — tests built on guessed shapes rot immediately.

## Prefer injection over module mocking

When a unit receives its collaborators (dependency injection), construct it
directly in the test and hand it test doubles. This is simpler, faster, and
documents the unit's dependencies:

```ts
const repo = { findById: jest.fn(), save: jest.fn() };
const clock = { now: jest.fn().mockReturnValue(1700000000000) };
const service = new OrderService(repo, clock); // real construction, fake deps
```

Reach for `jest.mock('module')` only for dependencies the unit *doesn't* let you
inject — modules it imports directly, or clients it `new`s up internally. The
**`references/jest-mocking-patterns.md`** file has copy-paste patterns for every
case: injected deps, whole-module mocks, partial mocks, single-method spies,
class/constructor mocks, the filesystem and other Node built-ins, HTTP clients,
timers/clocks, and randomness. Read it whenever you're past the pure-function
case — don't reinvent a mock each time.

> If the project resolves dependencies through a **DI container** (TypeDI,
> NestJS, tsyringe, Inversify…), do **not** pull units out of the real container
> in a unit test — it wires up the entire real dependency graph (real network
> clients and all). Construct the unit directly with fakes instead. Decorator-
> based DI also needs `import 'reflect-metadata';` as the very first line of the
> spec, or the decorators throw at import time.

## Writing the test itself

**Name by behaviour.** The `it(...)` string should read as a sentence describing
a scenario and its expected outcome — `it('returns null when the user is not
found')`, not `it('works')` or `it('test getUser')`. Good names make a failing
suite a bug report.

**Arrange–Act–Assert.** Keep the three phases visually distinct: set up
inputs/mocks, perform exactly one action, then assert. One behaviour per `it` —
if you're asserting two unrelated things, that's two tests.

**Reset state between tests.** Add `beforeEach(() => jest.clearAllMocks())` (or
configure `clearMocks: true`) so call counts and implementations don't leak
across tests. Leaked mock state is the most common cause of order-dependent,
flaky suites.

**Assert behaviour, not internals.** Prefer the returned value and the
*meaningful* effects on collaborators (e.g. "it saved the order", "it published
the event") over private fields or that some internal helper ran. Don't reach
into private members to force a path — if you must, treat it as a smell and
prefer restructuring or mocking a real boundary.

**Cover the branches that matter.** Walk the unit's `if`s, early returns,
`catch`/`finally`, and boundary conditions (empty, zero, null, the off-by-one).
The happy path rarely hides bugs; the error and edge branches do. For each
branch, write a test that forces it and asserts what *should* happen there —
including cleanup that must run on failure.

**Test async correctly.** `await` the assertion and use `.resolves`/`.rejects`
for promises (`await expect(fn()).rejects.toThrow(...)`). A forgotten `await` is
a test that passes whether or not the code is correct.

**Keep types honest where it's cheap.** `jest.mocked(fn)` / `jest.Mocked<T>`
keep mock return values type-checked. Don't fight the types on large 3rd-party
objects — a focused `as any` on a partial fake of a big SDK type is acceptable.

## File placement and running

- Co-locate specs with the existing tests and name them `*.spec.ts` (or follow
  whatever suffix the project already uses for unit tests — keep them distinct
  from any integration/`*.server.test.ts` style that hits real systems).
- Iterate by running just your file: `npx jest path/to/file.spec.ts`.
- **Always run the test before calling it done.** A test that doesn't run green
  gives false confidence. If it hangs, a real client or unresolved promise
  likely leaked through your mocks — tighten the fake. The suite must pass and
  exit cleanly.

## A complete example

```ts
import 'reflect-metadata'; // only if the unit uses decorator-based DI

import { OrderService } from '../order.service';

describe('OrderService', () => {
  let repo: { findById: jest.Mock; save: jest.Mock };
  let service: OrderService;

  beforeEach(() => {
    jest.clearAllMocks();
    repo = { findById: jest.fn(), save: jest.fn() };
    service = new OrderService(repo as any);
  });

  describe('cancel', () => {
    it('marks the order cancelled and persists it', async () => {
      repo.findById.mockResolvedValue({ id: '1', status: 'open' });

      const result = await service.cancel('1');

      expect(result.status).toBe('cancelled');
      expect(repo.save).toHaveBeenCalledWith(expect.objectContaining({ status: 'cancelled' }));
    });

    it('throws and does not persist when the order does not exist', async () => {
      repo.findById.mockResolvedValue(null);

      await expect(service.cancel('missing')).rejects.toThrow(/not found/i);
      expect(repo.save).not.toHaveBeenCalled(); // the failure branch must not save
    });
  });
});
```

Notice the second test forces the error branch *and* asserts the negative ("did
not persist") — pairing "the right thing failed" with "no bad side effect
happened" is the coverage that catches real regressions.
