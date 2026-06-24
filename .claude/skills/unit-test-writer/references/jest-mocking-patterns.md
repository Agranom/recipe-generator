# Jest mocking patterns (TypeScript)

Generic, library-agnostic techniques for isolating a unit. Pick the one that
matches *how the unit gets its dependency*, not which library the dependency is.

## Contents

1. [Test-double vocabulary](#test-double-vocabulary)
2. [Injected dependency — pass a fake](#injected-dependency)
3. [Whole module — jest.mock](#whole-module)
4. [Partial mock — keep some real](#partial-mock)
5. [Single method — jest.spyOn](#single-method)
6. [Class / constructor mocks](#class-constructor)
7. [Default vs named exports](#exports)
8. [Node built-ins (fs, path, crypto)](#node-builtins)
9. [HTTP clients (axios, fetch)](#http-clients)
10. [Timers, clock, randomness](#time-and-randomness)
11. [Retry / backoff loops](#retry-loops)
12. [Async assertions](#async-assertions)
13. [Typed mocks](#typed-mocks)

---

## Test-double vocabulary

- **Stub** — returns canned values (`mockReturnValue` / `mockResolvedValue`).
- **Mock** — a stub you also assert *was called* a certain way
  (`toHaveBeenCalledWith`).
- **Spy** — wraps a *real* function so you can observe calls while it still runs
  (`jest.spyOn(obj, 'm')`), or override it with `.mockImplementation(...)`.

Reach for the least powerful one that proves the behaviour.

## Injected dependency

If the unit receives a collaborator (constructor arg, function param, setter),
hand it a fake object with just the methods the unit calls. No `jest.mock`.

```ts
const repo = { findById: jest.fn(), save: jest.fn() };
const service = new OrderService(repo as any);

repo.findById.mockResolvedValue({ id: '1' });
```

This is the preferred strategy — simplest, fastest, and it documents what the
unit depends on. Use the patterns below only for dependencies you can't inject.

## Whole module

For a dependency the unit imports directly (or `new`s up internally), replace
the whole module. `jest.mock` calls are **hoisted above the imports**, so they
take effect before the unit is loaded.

```ts
const sendMock = jest.fn();
jest.mock('../mailer', () => ({ sendEmail: sendMock }));

import { signup } from '../signup'; // imports the mocked ../mailer
```

**Hoisting rule:** a factory may only reference outer variables whose names
start with `mock` (e.g. `const mockSend = jest.fn()`). Otherwise Jest throws
"cannot access before initialization". Either prefix the name, or set behaviour
*inside the test* after importing the mocked symbol:

```ts
jest.mock('../mailer');
import { sendEmail } from '../mailer';
const sendEmail = jest.mocked(sendEmail);
beforeEach(() => sendEmail.mockResolvedValue({ ok: true }));
```

## Partial mock

Mock one export, keep the rest real with `jest.requireActual`:

```ts
jest.mock('../config', () => ({
  ...jest.requireActual('../config'),
  getApiUrl: jest.fn(() => 'http://test.local'),
}));
```

## Single method

To override just one method on an otherwise-real object/module, spy:

```ts
const spy = jest.spyOn(dateProvider, 'now').mockReturnValue(0);
// ...
spy.mockRestore(); // or rely on restoreMocks/clearAllMocks
```

`jest.spyOn` without `.mockImplementation` keeps the real method running while
recording calls — useful to assert a call happened without changing behaviour.

## Class / constructor mocks

When the unit does `new Client(...)` from an imported module, mock the
constructor so instances expose controllable methods:

```ts
const query = jest.fn();
jest.mock('../db-client', () => ({
  DbClient: jest.fn().mockImplementation(() => ({ query })),
}));

// later
query.mockResolvedValue([{ id: 1 }]);
expect(query).toHaveBeenCalledWith('SELECT ...');
```

If the constructor returns an object whose method you want to feed into a
fluent/builder chain, have the method return a plain function or a small fake
object that satisfies the next call — match what the real chain expects.

## Exports

- **Named export:** `jest.mock('m', () => ({ thing: jest.fn() }))`.
- **Default export:** include `__esModule: true` and a `default` key:

```ts
jest.mock('../logger', () => ({ __esModule: true, default: { info: jest.fn() } }));
```

## Node built-ins

`jest.mock('fs')` (and `'fs/promises'`, `'path'`, `'crypto'`, etc.) replaces the
module. For stream-based APIs, emulate the events the code listens for:

```ts
import { EventEmitter } from 'events';
jest.mock('fs');
import fs from 'fs';

const writer = new EventEmitter() as any;
(fs.createWriteStream as jest.Mock).mockReturnValue(writer);

const p = downloadTo('/tmp/x');
writer.emit('finish');          // trigger the writer.on('finish', resolve)
await expect(p).resolves.toBeDefined();
```

For callback-style APIs (`fs.unlink(path, cb)`), invoke the callback in your
mock: `(fs.unlink as jest.Mock).mockImplementation((_p, cb) => cb(null))` for
success, or `cb(new Error('boom'))` for the failure branch.

## HTTP clients

Don't hit the network. Mock the client module and resolve canned responses.

```ts
jest.mock('axios');
import axios from 'axios';
(axios.get as jest.Mock).mockResolvedValue({ data: { id: 1 } });
```

For `fetch`: `global.fetch = jest.fn().mockResolvedValue({ ok: true, json: async () => ({...}) } as any)`.
To test error handling, `mockRejectedValue(new Error('network'))` or resolve a
non-2xx shape the code branches on.

## Time and randomness

Determinism means controlling the clock and RNG.

```ts
jest.useFakeTimers().setSystemTime(new Date('2024-01-01T00:00:00Z'));
// ... code that reads Date.now() / new Date()
jest.useRealTimers(); // in afterEach, or set restoreMocks

jest.spyOn(Math, 'random').mockReturnValue(0.42);
```

Advance timers instead of waiting: `await jest.advanceTimersByTimeAsync(1000)`
or `jest.runAllTimersAsync()`.

## Retry loops

Code that retries a flaky call genuinely re-invokes it and may `await` a real
`setTimeout` between attempts. Two cases:

- **Happy path:** the mock succeeds first try — nothing special.
- **Retry path:** make the mock fail then succeed and assert it was called more
  than once:

```ts
op.mockRejectedValueOnce(new Error('transient')).mockResolvedValue('ok');
await expect(withRetry(op)).resolves.toBe('ok');
expect(op).toHaveBeenCalledTimes(2);
```

If the delay is large, drive it with fake timers rather than slowing the test.
Don't assert exact backoff timing in a behaviour test — that belongs in a
dedicated test for the retry helper itself.

## Async assertions

Always `await`. Use the promise matchers so failures read clearly:

```ts
await expect(service.load()).resolves.toEqual({ id: 1 });
await expect(service.load()).rejects.toThrow(NotFoundError);
```

A missing `await` on a rejecting promise makes the test pass regardless of the
code — a silent false positive.

## Typed mocks

Keep mock return values type-checked where it's cheap:

```ts
import { getUser } from '../api';
jest.mock('../api');
const mockedGetUser = jest.mocked(getUser); // typed: return value must match
mockedGetUser.mockResolvedValue({ id: '1', name: 'A' });
```

`jest.Mocked<T>` types a whole mocked object. For large 3rd-party SDK types
where a full fake is wasteful, a focused `as any` on a partial fake is fine —
mock only the surface the unit touches.
