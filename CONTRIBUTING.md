# Contributing to n8m

Thanks for your interest in contributing. n8m is an open-source project and
welcomes pull requests, bug reports, feature ideas, and new built-in patterns.

---

## Getting started

```bash
git clone https://github.com/Lee-Holdings-International/n8m.git
cd n8m
npm install
npm run build
./bin/run.js help
```

Run tests:

```bash
npm test
```

Watch mode for development:

```bash
npm run dev
```

---

## What to work on

Check the [open issues](https://github.com/Lee-Holdings-International/n8m/issues)
for things labelled **`good first issue`** or **`help wanted`**. The
[Roadmap](README.md#roadmap) in the README lists near-term features that are
ready to be picked up.

---

## Adding a new command

Commands live in [`src/commands/`](src/commands/). Each file maps to one CLI
command (oclif convention). Copy an existing command as a starting point and
follow the same structure.

---

## Adding built-in patterns

Patterns live in [`docs/patterns/`](docs/patterns/) as Markdown files with a
`<!-- keywords: ... -->` header comment. The `n8m learn` command generates
these automatically from a validated workflow:

```bash
# Generate a pattern from a local workflow
n8m learn ./workflows/my-flow/workflow.json

# Then move the result to docs/patterns/ to make it built-in
mv .n8m/patterns/my-flow.md docs/patterns/
```

Or generate all at once:

```bash
npm run generate-patterns
```

See [`docs/patterns/bigquery-via-http.md`](docs/patterns/bigquery-via-http.md)
for the expected format.

---

## Adding AI provider support

AI calls go through [`src/services/ai.service.ts`](src/services/ai.service.ts).
The service wraps the OpenAI SDK with a custom `baseURL`, so any
OpenAI-compatible provider works without code changes. To add a first-class
preset, add a new entry to the `PROVIDER_DEFAULTS` map in that file.

---

## Pull request checklist

- [ ] `npm test` passes (includes lint)
- [ ] New behaviour is covered by a unit test in `test/unit/`
- [ ] If you added a command, the `oclif` topics in `package.json` are updated
- [ ] If you added a built-in pattern, the keywords comment is present

---

## Code style

- TypeScript strict mode — no `any` unless absolutely necessary
- No hardcoded regex classifiers for AI decisions — delegate to the LLM
- Prefer editing existing files over creating new ones
- Keep commands focused; shared logic belongs in `src/services/` or `src/utils/`

---

## Questions?

Open a [GitHub Discussion](https://github.com/Lee-Holdings-International/n8m/discussions)
or file an issue with the `question` label.
