# Coding Standards

Authoritative guide for all code in this repository. Applies to Claude and human contributors alike.

---

## 1. Core Principles

### KISS — Keep It Simple
Write the minimum code that solves the problem. Complexity is a liability.

```ts
// bad — over-engineered
function getUserDisplayName(user: User): string {
  const parts: string[] = [];
  if (user.firstName) parts.push(user.firstName);
  if (user.lastName) parts.push(user.lastName);
  return parts.length > 0 ? parts.join(' ') : user.email;
}

// good
function getUserDisplayName({ firstName, lastName, email }: User): string {
  return [firstName, lastName].filter(Boolean).join(' ') || email;
}
```

### DRY — Don't Repeat Yourself
Every piece of knowledge must have a single, authoritative representation.

```ts
// bad — magic string repeated in three places
await storage.move(`tmp/${id}`, `published/${id}`);

// good — defined once in video-directories.ts
import { STAGING_PREFIX, PUBLISHED_PREFIX } from '@/constants/video-directories';
await storage.move(`${STAGING_PREFIX}${id}`, `${PUBLISHED_PREFIX}${id}`);
```

### YAGNI — You Aren't Gonna Need It
Don't add features, abstractions, or config that wasn't asked for. Three similar lines is better than a premature abstraction.

```ts
// bad — generalized for hypothetical future callers
function buildPrompt(template: string, vars: Record<string, string>, options?: { trim?: boolean; maxLength?: number }): string { ... }

// good — solves the actual problem
function buildRecipePrompt(description: string): string {
  return `Extract a recipe from: ${description}`;
}
```

---

## 2. SOLID

### Single Responsibility
Each class/function does exactly one thing. If you need the word "and" to describe it, split it.

```ts
// bad
class RecipeService {
  async scrapeAndParseAndStoreRecipe(url: string) { ... }
}

// good — each class owns one concern
class InstaScrapperService { async scrape(url: string): Promise<PostData> { ... } }
class RecipeGeneratorService { async generateRecipe(post: PostData): Promise<Recipe> { ... } }
class VideoProcessingService { async preloadVideo(url: string): Promise<VideoFile> { ... } }
```

### Open/Closed
Extend by adding new classes or strategies, not by modifying existing ones.

```ts
// bad — adding a new scraping strategy means editing the existing method
async scrape(url: string) {
  // ... graphql strategy ...
  // ... axios strategy ...
  // new strategy added inline here
}

// good — append a new strategy; existing code untouched
private readonly strategies = [graphqlStrategy, axiosStrategy, puppeteerStrategy];
async scrape(url: string) {
  for (const strategy of this.strategies) {
    const result = await strategy(url);
    if (result) return result;
  }
}
```

### Liskov Substitution
A concrete service must fully honour its interface. Callers must not need to know which implementation they hold.

```ts
// bad — caller checks the concrete type
if (service instanceof GeminiInstructionsService) {
  await service.generateFromVideo(url);
}

// good — caller uses the interface contract
await instructionsService.generateInstructionsFromVideo(url);
```

### Interface Segregation
Define narrow interfaces per consumer. Don't force a caller to depend on methods it never uses.

```ts
// bad — one fat interface forces all consumers to depend on everything
interface StorageService {
  upload(path: string, data: Buffer): Promise<void>;
  move(from: string, to: string): Promise<void>;
  delete(path: string): Promise<void>;
  getSignedUrl(path: string): Promise<string>;
  listFiles(prefix: string): Promise<string[]>;
}

// good — narrow interfaces per use case
interface VideoStager { preloadVideo(url: string): Promise<VideoFile>; }
interface VideoPublisher { publishVideo(file: VideoFile): Promise<PublishedVideo>; }
```

### Dependency Inversion
Depend on abstractions. Inject via TypeDI — never call `new` inside a service.

```ts
// bad
class RecipeGeneratorService {
  private readonly storage = new GoogleStorageService(); // hard-coded concretion
}

// good
@Service()
class RecipeGeneratorService {
  constructor(
    @Inject() private readonly storage: GoogleStorageService,
    @Inject(LOGGER_TOKEN) private readonly logger: Logger,
  ) {}
}
```

---

## 3. Clean Code

### Meaningful Names
Names answer: why it exists, what it does, how it's used.

```ts
// bad
const d = new Date();
const u = await getU(id);
async function proc(r: any) { ... }

// good
const createdAt = new Date();
const user = await findUserById(id);
async function processRecipeMetadata(metadata: RecipeMetadata) { ... }
```

Avoid: abbreviations (`instrSvc`, `recMeta`), noise words (`Manager`, `Data`, `Info`), misleading names.

Boolean variables and functions use `is`/`has`/`can` prefixes:

```ts
const isLoading = true;
const hasVideo = !!post.videoUrl;
function canPublishVideo(file: VideoFile): boolean { ... }
```

### Small Functions
One function = one thing, fits on a screen (< 20 instructions). If a block needs a comment, extract it.

```ts
// bad — does three things
async function handlePost(url: string) {
  // scrape
  const html = await axios.get(url);
  const $ = cheerio.load(html.data);
  const description = $('meta[name="description"]').attr('content') ?? '';
  // validate
  const isRecipe = await llm.validate(description);
  if (!isRecipe) throw new Error('Not a recipe');
  // stage video
  const videoUrl = $('video source').attr('src') ?? '';
  await storage.upload(`tmp/${uuid()}`, await download(videoUrl));
}

// good — each step is named and single-purpose
async function handlePost(url: string) {
  const post = await this.scraper.scrape(url);
  await this.validator.assertIsRecipe(post.description);

  return this.videoProcessor.preloadVideo(post.videoUrl);
}
```

### Command / Query Separation
A function either changes state **or** returns a value — never both.

```ts
// bad — returns data AND has a side effect
async function saveAndGetRecipe(data: RecipeInput): Promise<Recipe> {
  await db.save(data);
  return db.findById(data.id); // side effect + query mixed
}

// good — separate
async function saveRecipe(data: RecipeInput): Promise<void> { ... }    // command
async function getRecipeById(id: string): Promise<Recipe> { ... }      // query
```

### Fail Fast
Validate at boundaries (controller, service constructor). Throw early with a descriptive message.

```ts
// bad — bad state propagates deep
@Service()
class RecipeInstructionsService {
  constructor(private readonly apiKey?: string) {}
  async generateInstructionsFromVideo(url: string) {
    // apiKey might be undefined — crash happens here, far from the root cause
    const client = new VertexAI({ apiKey: this.apiKey! });
  }
}

// good — fail at construction
@Service()
class RecipeInstructionsService {
  constructor() {
    if (!process.env.GOOGLE_API_KEY) throw new Error('GOOGLE_API_KEY is required');
  }
}
```

### No Magic Values
All literals belong in `src/constants/`.

```ts
// bad
await storage.move(`tmp/${id}`, `recipes/${id}`);
const model = new ChatOpenAI({ model: 'gpt-4o-mini' });

// good
import { STAGING_PREFIX, PUBLISHED_PREFIX } from '@/constants/video-directories';
import { OPENAI_MODEL } from '@/constants/ai-config';
await storage.move(`${STAGING_PREFIX}${id}`, `${PUBLISHED_PREFIX}${id}`);
const model = new ChatOpenAI({ model: OPENAI_MODEL });
```

---

## 4. TypeScript

### Types
- Always declare parameter and return types; avoid `any` (`no-explicit-any` is a warning).
- Create dedicated types/interfaces instead of using primitives for domain concepts.
- Prefer `readonly` for data that doesn't change; `as const` for literal objects.

```ts
// bad
function processVideo(url: any, options: any): any { ... }

// good
function processVideo(url: VideoUrl, options: VideoProcessingOptions): Promise<VideoFile> { ... }
```

### Naming Conventions
| Construct | Convention | Example |
|---|---|---|
| Class | PascalCase | `RecipeGeneratorService` |
| Interface | PascalCase | `VideoStager` |
| Function / method | camelCase, starts with verb | `generateRecipe`, `isValidUrl` |
| Variable | camelCase | `recipeMetadata` |
| File / directory | kebab-case | `recipe-generator.service.ts` |
| Env variable | UPPERCASE | `GOOGLE_API_KEY` |
| Constant | UPPER_SNAKE or camelCase | `STAGING_PREFIX`, `defaultTimeout` |

Allowed abbreviations: `i`/`j` (loops), `err` (errors), `ctx` (context), `req`/`res`/`next` (middleware).

### Structure
- **One export per file.**
- Use `RO-RO` (receive object, return object) for functions with multiple parameters or return values.
- Prefer early returns over nested `if` blocks.
- No blank lines inside a function body; add one blank line above `return`.
- Use JSDoc only on public class methods — one short line max.

```ts
// bad — multiple params, no early return, nested
function buildMetadata(title, desc, video, lang) {
  if (title) {
    if (desc) {
      return { title, desc, video, lang };
    }
  }
  return null;
}

// good — RO-RO, early return
function buildMetadata({ title, description, videoFile, targetLanguage }: MetadataInput): RecipeMetadata | null {
  if (!title || !description) return null;

  return { title, description, videoFile, targetLanguage };
}
```

### Classes
- Prefer composition over inheritance.
- Declare interfaces to define contracts.
- No `public` keyword on public methods (it's the default).
- Keep classes small: < 200 instructions, < 10 public methods, < 10 properties.

---

## 5. Error Handling

- Use typed custom errors (extend `Error`, set `.name`) so callers can `instanceof`-check.
- Wrap all external I/O in `retry()` from `retry.util.ts`. No ad-hoc retry loops.
- Log with `LOGGER_TOKEN` before re-throwing; include structured context.

```ts
// bad
try {
  await llm.invoke(prompt);
} catch (e) {
  console.error(e);
  throw e;
}

// good
export class LlmInvocationError extends Error {
  readonly name = 'LlmInvocationError';
}

try {
  await retry(() => llm.invoke(prompt), { maxAttempts: 3, useExponentialBackoff: true });
} catch (err) {
  this.logger.error({ err, prompt }, 'LLM invocation failed');
  throw new LlmInvocationError(`LLM call failed after retries: ${(err as Error).message}`);
}
```

---

## 6. Testing

- Unit tests mock at the service boundary (TypeDI / constructor injection), not at the HTTP layer.
- Integration tests (`*.server.test.ts`) hit real external dependencies and load `.env.test`.
- Name tests: `<unit> <scenario> <expected outcome>`.

```ts
// bad test name
it('works correctly', () => { ... });

// good test name
it('getRecipeMetadata returns null when post is not a recipe', async () => { ... });
```

