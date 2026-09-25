# Pi evals

Pi evals are behavioral, model-backed checks for Pi workflows. They adapt a real `AgentSession` to `vitest-evals`, run
it in isolated temporary project and agent directories, and attach native Pi session artifacts.
Use them to measure end-to-end behavior and compare prompts, tools, skills, models, or other harness configurations.

## Running evals

Run from the repository root with a default provider and model:

```bash
npm run eval -- --provider openai --model gpt-5.6-sol
```

The equivalent environment variables are:

```bash
PI_PROVIDER=openai PI_MODEL=gpt-5.6-sol npm run eval
```

CLI values take precedence and become defaults for harnesses that do not select a model explicitly. Provider and model must be supplied together. The runner also allows no default when every executed harness configures its own model.
Authentication comes from Pi's normal `ModelRuntime`, including Pi subscription credentials and provider API-key
environment variables.

Additional arguments are forwarded to Vitest:

```bash
npm run eval -- src/extensions.eval.ts
npm run eval -- -t "creates and uses the extension"
npm run eval -- src/docs.eval.ts -t "session-format\.md"
```

Run all comparative customization evals five times in one invocation:

```bash
npm run eval -- \
  src/extensions.eval.ts src/models.eval.ts src/providers.eval.ts \
  --provider openai --model gpt-5.6-sol \
  --repetitions 5
```

`--repetitions` applies to suites declared with `evalHarnessTable(...)`. An explicit `repetitions` value in a suite
overrides the command-line default. `PI_EVAL_REPETITIONS=5` is equivalent to the command-line option. Use one repetition
while developing an eval and five when reporting lift.

## Reports and artifacts

Each invocation prints a compound `Eval Comparisons` report after the Vitest results. When several comparative files run
in the same invocation, this report contains one section for every eval set. For example, with illustrative values:

```text
Eval Comparisons
  Add model to existing provider
     Baseline  system-prompt-without-docs
    Candidate  default-system-prompt (5/5 pairs)
    Pass rate  +60.0 pp (candidate 80.0%, baseline 20.0%)
       Tokens  +1200.0 (candidate 24000.0, baseline 22800.0)
      Latency  -850.0ms (candidate 14000.0ms, baseline 14850.0ms)
    Est. cost  +$0.0100 (candidate $0.1200, baseline $0.1100)

  Add OpenAI-compatible provider
    ...

  Add custom streaming provider
    ...
```

The runner prints the ignored `.eval/` artifact directory at startup. It contains:

- `report.txt`: the terminal comparison report without color codes.
- `report.json`: the same aggregate comparison data as structured JSON.
- `runs.jsonl`: one record for every completed harness run.
- `sessions/`: native Pi session JSONL attachments.
- `sources/`: source attachments recorded by individual evals.

The report covers comparative suites using `evalHarnessTable(...)`. Ordinary evals still appear in the Vitest summary and
in `runs.jsonl`, but not in the baseline-versus-candidate comparison report. Artifacts may contain prompts, responses,
source code, and tool output.

## Writing evals

Follow [`vitest-evals`](https://github.com/getsentry/vitest-evals) for general suite, judge, assertion, and normalized
trace guidance. Pi-specific evals use `createPiCodingAgentHarness(...)` from `src/pi-harness.ts`, with one harness bound
to each `describeEval(...)` suite:

```ts
import { expect } from "vitest";
import { describeEval } from "vitest-evals";
import { createPiCodingAgentHarness } from "./pi-harness.ts";

const harness = createPiCodingAgentHarness({ noTools: "all" });

describeEval("Pi smoke", { harness }, (it) => {
	it("answers a factual question", async ({ run }) => {
		const result = await run("What is the capital of France? Reply with only the city name.");
		expect(result.output).toBe("Paris");
	});
});
```

### Configuring the Pi harness

`createPiCodingAgentHarness(...)` accepts:

- `name`: stable harness identity used by reports and comparisons.
- `model`: optional `{ provider, id }` selection. It overrides the runner's default model.
- `noTools`: Pi's tool-disable configuration.
- `tools`: optional allowlist of tool names available to the evaluated agent.
- `customTools`: custom tool definitions to register for the evaluated agent.
- `transformSystemPrompt`: transforms the complete default prompt before the eval starts.
- `output`: transforms the final response and `AgentSession` into a JSON-safe domain result.

An explicitly selected model makes model-comparison harnesses independent of the runner default:

```ts
const harness = createPiCodingAgentHarness({
	name: "claude-opus-4-6",
	model: { provider: "anthropic", id: "claude-opus-4-6" },
});
```

A run accepts either one prompt or a sequence of prompt and reload steps. Reload steps are useful when the preceding
prompt creates or changes Pi resources:

```ts
const result = await run([
	{ type: "prompt", content: "Create a Pi extension." },
	{ type: "reload" },
	{ type: "prompt", content: "Use the extension." },
]);
```

### Transforming harness output

Use `output` to expose scenario-specific, JSON-safe behavior without adding that behavior to the generic Pi adapter:

```ts
const harness = createPiCodingAgentHarness({
	output: ({ response, session }) => ({
		response,
		activeTools: session.getActiveToolNames(),
		extensionErrors: session.resourceLoader.getExtensions().errors,
	}),
});
```

Assert application behavior on `result.output`. Assert model and tool traces on `result.session`, using
`vitest-evals` helpers such as `toolCalls(...)`.

### Writing comparative eval sets

Use `evalHarnessTable(...)` with Vitest's native `describe.for(...)` to run the same inputs against multiple harnesses.
Harnesses may differ by prompt, tools, skills, model, or any other Pi configuration:

```ts
import { describe } from "vitest";
import { createJudge, describeEval } from "vitest-evals";
import { evalHarnessTable } from "./vitest-evals/harness-table.ts";

const TargetTaskJudge = createJudge<string, string>("TargetTaskJudge", ({ output }) => ({
	score: output === "expected result" ? 1 : 0,
}));

const harnessTable = evalHarnessTable(
	"target skill effectiveness",
	{
		baseline: withoutTargetSkillHarness,
		candidate: withTargetSkillHarness,
		repetitions: 6,
	},
);

describe.for(harnessTable)("$name repetition $repetition", ({ harness }) => {
	describeEval("target skill effectiveness", { harness, judges: [TargetTaskJudge], judgeThreshold: null }, (it) => {
		it("completes the target task", async ({ run }) => {
			await run("Complete the target task.");
		});
	});
});
```

Comparative suites should record correctness with deterministic or model-backed judges and set `judgeThreshold: null`.
This keeps a low score as an observation instead of making the Vitest invocation fail. Use hard assertions only for
suite invariants and infrastructure contracts. `expect.soft(...)` still fails the test and is not a scoring mechanism.

The Pi harness snapshots native session JSONL before deleting its temporary workspace. An eval-only `afterEach` hook
registers that snapshot against the explicit Vitest test task before reporters run.

Harness names must be stable and unique within an eval set. The grouping key combines repetition with a non-empty string
`input.id` when available, otherwise with a SHA-256 hash of strict canonical JSON input. Use `candidate` for one treatment
or `candidates` for multiple treatments. Each candidate is compared only with the declared baseline. For each matched
input and repetition, the reporter computes pass-rate lift from each run's recorded average judge score, treating a score
of at least `1` as passing. Lift is the candidate pass rate minus the baseline pass rate, in percentage points. Missing
judge scores are reported as incomplete observations. Tokens, latency, and estimated cost remain separate
candidate-minus-baseline paired deltas; missing telemetry remains unavailable. If execution-order randomization becomes
necessary, use Vitest's built-in sequence shuffling.

See the [`skill-eval-harness`](https://github.com/adewale/skill-eval-harness/) guidance for comparative-eval methodology,
repetition strategy, trustworthy judges, and telemetry interpretation.

## Weavra vs Pi benchmark

`npm run benchmark` asks whether Weavra STANDARD beats plain Pi on the same tasks, with the same model and the same wall-clock limit per run. Each run records whether the agent claimed completion, whether a hidden oracle passed, and whether it was a false completion (claimed, but the oracle failed). It also records duration, model turns, tool calls and provider-reported tokens. Tokens are `UNKNOWN` when a provider does not report them; they are never estimated.

```bash
cd runtime/pi && npm run build
npm run benchmark -- --provider <provider> --model <model> --repeat 3 --out /abs/results --confirm-paid
```

- Arms: `pi` is a plain Pi SDK session with default tools, a fresh isolated HOME and agent directory, and no extensions, skills or context files. `weavra` is STANDARD through the real Worker SDK, Policy, verifier and Kernel. `weavra-advisory` is the same plus `verification.advisory: {mode: developer}`.
- Weavra arms use the C06 Fitness measurement profile (strict mutation and trust, bounded context pack, budget of 4 worker invocations and 100k reported tokens), but with the product revision limit of 1 instead of the Fitness calibration value of 0. A Reviewer REVISE therefore gets one fix attempt, as in a real run.
- Corpus: F01–F10 from C06 Fitness (without the cancellation fixture F08), plus benchmark-only B01–B10. B01–B06 cover a multi-file bugfix, a test addition checked against a hidden mutant, a rename, an off-by-one, input validation and config parsing.
- B07–B10 are discriminative. Their registered check covers only the most visible part of the task, so an agent that stops at a passing check leaves a stated acceptance criterion unmet. Catching the gap takes a careful implementation or a Reviewer that judges every criterion:
  - B07, weak visible test: CSV quoting rules. The repository's own test, which is also the registered check, covers only commas inside quotes. The oracle also checks doubled quotes and empty fields.
  - B08, easy-to-miss second requirement: add a `--limit` option and document it in README.md. The check covers only the option.
  - B09, cross-file consistency: shorten the session lifetime. The check covers only the expiry; the cookie repeats the lifetime as a literal number of seconds. The oracle also changes the constant in a copy to prove that both lifetimes follow it.
  - B10, tempting forbidden shortcut: the one-line fix edits a shared defaults module that the goal says not to change. The oracle requires that file unchanged and downloads to keep 3 attempts.

  `test/benchmark-discriminative.test.ts` shows for each of them that a plausible visible-check-only solution passes the registered check but fails the oracle, and that a differently written correct solution passes both. These solutions live in `src/benchmark-solutions.ts`; the Reviewer efficacy evaluation below reuses them. These four fixtures allow 300k reported tokens per run instead of 100k, so a Reviewer REVISE (four Weavra worker sessions) is not cut off by the token ceiling; both arms get the same ceiling. The corpus revision is `weavra-benchmark-corpus-2`; the per-fixture digests of the earlier fixtures did not change.
- The hidden oracle is Host code only. It is never written into a workspace, HOME or prompt, and it judges the final files and final answer after the agent stops. For the `pi` arm, bash is not OS-sandboxed and can reach the harness source on the same machine.
- Any provider other than `benchmark-faux` is refused without `--confirm-paid`. Without that flag the CLI prints the planned run count (arms × fixtures × repeat), for example 171 runs for all arms, all 19 fixtures and 3 repeats.
- Results are a versioned, typebox-validated JSON record (schema 2) and per-arm Markdown tables. Tests use only the faux provider: `node ../../node_modules/vitest/dist/cli.js run --config vitest.test.config.ts`.
- Stage signals show which stage shaped each outcome. They are payload-free counts from the Runtime's own observations:
  - tool errors, and for Weavra how many were returned to the model within the correctable budget
  - `runtime_request_check` calls and advisory checks that actually ran
  - Reviewer REVISE verdicts and the final verdict
  - verification repair attempts
  - the Evidence Pack failure category when the Kernel did not complete

  Stages the pi arm does not have are `null` (shown as `n/a`).

## Reviewer efficacy evaluation

`npm run reviewer-eval` asks whether an independent Weavra Reviewer stops flawed work that passes the visible registered check. In a real-model benchmark pilot on B07–B10 the model never produced flawed work, so the Reviewer had nothing to catch. This evaluation seeds the work instead: a scripted Developer applies a given solution, and only the Reviewer is a real model.

```bash
cd runtime/pi && npm run build
cd packages/evals && npm run reviewer-eval -- --provider <provider> --model <model> --out /abs/results --confirm-paid
```

- Cases: the 11 seeded solutions in `src/benchmark-solutions.ts`, 7 visible-check-only flawed solutions of B07–B10 (they pass the registered check but fail the hidden oracle) and 4 alternative correct solutions. `--cases` selects some of them and `--repeat` repeats them.
- Each case is one STANDARD run through the real Worker SDK, Policy, verifier and Kernel, with the benchmark's Fitness measurement profile:
  - The coding profile is the scripted Developer `reviewer-eval-developer`, with one faux model per case. It lists, reads and edits exactly the case's files through the Worker tools. Every case hands off with the same summary, "Implemented the requested change.", so only the diff separates flawed from correct work.
  - The reasoning profile, the Reviewer, is the selected provider and model.
  - `max_revision_cycles` is 0, so the first verdict decides. REVISE or BLOCK ends the run BLOCKED; only PASS can reach COMPLETED. The hidden oracle then judges the final files, as in the benchmark.
- Per run the record keeps whether the case is FLAWED or CORRECT, the verdict the Kernel accepted, each criterion's status, issue counts by severity, the Kernel status, the oracle result and false completion. It also keeps the Reviewer session's own reported tokens, turns, tool calls and duration; the scripted Developer's faux usage is excluded. No model text is stored.
- Summary:
  - catch rate = FLAWED runs with REVISE or BLOCK / FLAWED runs with an accepted verdict
  - false-alarm rate = CORRECT runs with REVISE or BLOCK / CORRECT runs with an accepted verdict
  - false completions = COMPLETED runs whose hidden oracle failed
  - runs without an accepted verdict (Reviewer, provider or harness failure) are counted separately
- Any Reviewer provider other than `reviewer-eval-faux` (scripted `PASS` or `REVISE`, no network) is refused without `--confirm-paid`. The launcher refuses and prints the planned run count before any SDK, credential or provider code loads.
- Results are a versioned, typebox-validated JSON record and a Markdown table under `--out` (default `packages/evals/.eval/reviewer-eval`). Tests use only faux providers: `test/reviewer-eval.test.ts`.
