# regia

**Turn Claude Code into an orchestrator.** Regia ("direction", as in film directing) is a Claude Code mod that makes your main session coordinate instead of doing the work itself, gives every task the model and effort it actually needs, and lets you run real swarms of Claude, Codex, Qoder (Qwen models), Qwen Code and GitHub Copilot CLI agents, all watched from a live pane beside the chat.

It works on its own on any machine and any project, with no other plugin and nothing to add to your `CLAUDE.md`.

Regia is also the orchestration layer of [NONoise](https://github.com/russosalv/NONoise), the AI SDLC bootstrapper: `create-nonoise` installs it for Claude Code, and the two share the same three modes. See [With NONoise](#with-nonoise).

## Why

Left alone, a Claude Code session tends to:

- **do everything itself**, filling the main context with file dumps and test logs;
- **run every subagent on the same settings**, spending an expensive model on a file search;
- **lose track** of what is running once you have more than a couple of agents going;
- **stop halfway** when you leave it alone, or ask you questions that make no sense without the context you no longer have.

Regia addresses each one:

| | What it does |
|---|---|
| **Three modes** | `/regia long` for long developments (the main session orchestrates and acts on your behalf), `/regia medium` (it works and delegates the independent pieces), `/regia quick` (a single agent on a small model). The rule travels with the mod, as a section of the system prompt. |
| **Questions with their context** | Every decision that is yours arrives with where things stand, the options and a recommendation: in the pane, with keys to answer or dig deeper with an agent, and as a notification if you are away from the PC. |
| **The plan as a task list** | Items with the description of the macro-activity, grouped by phase; the finished ones fold into a group you can open. |
| **Per-task model and effort** | No fixed table per agent type. For each `Agent` call a quick Haiku check reads the actual task and picks the model and effort. A failed task retries one step higher. |
| **Swarms** | `sciame_avvia` runs Claude, Codex, Qoder, Qwen Code and GitHub Copilot CLI agents on a board with dependencies, a parallelism limit, an isolated git worktree for each task that writes, and mail between them. |
| **A team you set** | Claude is the development team, as subagents and as swarm tasks. The external executors you have enabled and installed (Codex, Qoder, Qwen Code, Copilot) are reinforcements: with the default policy the mod hands them the swarm tasks that suit them, up to a quota, and the main session does not have to name who does a task. `/regia team` sets the split. See [Team](#team) and [Executors](#executors). |
| **Surveillance and wake** | Stuck agents are detected, and a session left alone overnight is woken up while the plan still has open items. |
| **Compaction that keeps the work going** | When the main session's context passes a threshold (60%), the mod compacts it at the end of the turn, telling the summary what to keep and handing it the plan, the open questions and the swarms from its own stores. In long mode the main session then carries on by itself. See [Compaction](#compaction). |
| **Token savings** | Delegates are told to write the minimum and report briefly (or Ponytail does, if present). The main session sleeps while a swarm runs, and the tools do not weigh on the prompt. |
| **Live pane** | A fixed pane beside the chat: **PER TE** (the questions), **PIANO**, then **IN CORSO**, **IN SCALETTA**, **FATTI**, with model, effort, duration and tokens for each agent. |

## Install

At the prompt of a Claude Code session:

```
/plugin install regia --marketplace russosalv/claude-regia
```

Answer `y` to add the marketplace, choose a scope, then restart the session. Open the pane with `/regia`, and check what is active with `/regia doctor`.

The first interactive session after installing or updating Regia also installs, if they are missing, these Claude Code plugins:

- [Ponytail](https://github.com/DietrichGebert/ponytail), always;
- the Codex plugin (official, from OpenAI: marketplace `openai/codex-plugin-cc`, plugin `codex@openai-codex`), only if the `codex` CLI is on the machine;
- the Qwen Code plugin (there is no official Qwen plugin for Claude Code, so Regia uses the community one: marketplace `josephyaduvanshi/qwen-companion`, plugin `qwen@qwen-companion`), only if the `qwen` CLI is on the machine.

The same rules apply to all three: once per Regia version, loaded from the next session, never updated by Regia. After that each lives its own life: a plugin you disabled by hand is left alone, and one you removed is not put back until Regia's next version. If an installation fails, Regia retries in the next session. `/regia ponytail off`, `/regia codex off` and `/regia qwen off` opt out (config keys `ponytail`, `pluginCodex`, `pluginQwen`, all true by default); the matching `on` installs the plugin now; without a value they show the status.

GitHub Copilot CLI has no Claude Code plugin and needs none: the Copilot executor only uses the `copilot` command on your `PATH`, and `/regia doctor` says whether it is there.

Optional: [Codex CLI](https://github.com/openai/codex) only for Codex jobs, Qwen Code (`qwen`, tested with 1.0.0-preview.1) only for Qwen jobs, [Qoder CLI](https://qoder.com) (`qodercli`, signed in; tested with 1.1.93, see [its section](#qoder-cli-qoder_avvia-and-qoder_riprendi)) for the same Qwen models, the preferred way to use them, [GitHub Copilot CLI](https://github.com/github/copilot-cli) (`copilot`, already signed in; written against the documentation of 1.0.112, see [its section](#github-copilot-cli-copilot_avvia-and-copilot_riprendi)) only for Copilot jobs, `python3` only for the `posta` mail CLI. No other plugin is required.

## Commands

| Command | |
|---|---|
| `/regia` | Open the pane on this **session**, with a short text summary |
| `/regia long [goal]` | Mode for long developments; with a goal it starts right away |
| `/regia medium [goal]` | Default mode: the main session works and delegates the independent pieces |
| `/regia quick [goal]` | A single agent; the main session switches to `quickModello` (sonnet), and the previous model comes back when you leave |
| `/regia away` / `/regia here` | You are away from the PC: questions and a stopped or finished plan reach you as notifications |
| `/regia all` | The pane for the **whole machine** |
| `/regia doctor` | What is active right now: mode, version, Ponytail, Codex, Qwen, Copilot, Qoder, which executors are usable, config |
| `/regia team` | The team policy, the quota of the external executors and what they mean |
| `/regia team claude\|mixed\|external` | Who develops: Claude only, Claude with the external executors as reinforcements (default), or the external executors for every self-contained swarm task (config key `squadra`) |
| `/regia team <number>` | The quota for `mixed`: the largest share of the tasks the mod assigns in one swarm that may go to external executors, a whole percentage from 0 to 100 (config key `squadraQuota`, default 50) |
| `/regia executors` | The three external executors: enabled or not, CLI found or not, and which are usable now |
| `/regia executors codex\|qwen\|copilot\|qoder on\|off` | Enable or disable an executor (config key `esecutori`). A disabled one is never picked and is refused when named |
| `/regia ponytail [on\|off]` | Whether Ponytail is active; `on` installs it now, `off` stops Regia installing it |
| `/regia codex [on\|off]` | The Codex **plugin** for Claude Code; `on` installs it now, `off` stops Regia installing it. It does not enable or disable the Codex executor: that is `/regia executors codex on\|off` |
| `/regia qwen [on\|off]` | The Qwen Code **plugin** for Claude Code; `on` installs it now, `off` stops Regia installing it. The Qwen executor is `/regia executors qwen on\|off` |
| `/regia swarm` | The boards of this session's swarms |
| `/regia wake [on\|off]` | Surveillance of stuck agents and wake of the main session while the plan is open |
| `/regia compact` | Compaction: on or off, the threshold, how full the context is now, and when the mod last compacted in this session |
| `/regia compact on\|off` | Turn the mod's compaction and its instructions for every compaction on or off (config key `compatta`) |
| `/regia compact <number>` | Set the threshold, a whole percentage from 30 to 90 (config key `compattaSoglia`) |
| `/regia compact now` | Compact right away with Regia's instructions, as soon as the command has ended |
| `/regia orchestra [strict\|guide\|off]` | How firmly the main session must delegate |
| `/regia models [on\|off]` | Model and effort decided per task |
| `/regia savings [on\|off]` | Savings rules in delegates' prompts |

The earlier Italian names (`medio`, `via`, `qui`, `tutti`, `sciame`, `sveglia`, `modelli`, `risparmio`, `stretta`, `guida`) still work as aliases, and so do `esecutori` for `executors`, `compatta` for `compact`, and `squadra` for `team` with its values `mista` and `esterni`.

Without a value, the on/off commands show the current state; `/regia` also sums up the settings in one line, for example `Mode medium · orchestra guide · team mixed 50% · models on · savings on · wake on · compact 60%`. The modes (`long`, `medium`, `quick`, `away`, `here`) apply to the session and stay even if you resume it; the other options apply at once to every session.

## The modes

| | long | medium (default) | quick |
|---|---|---|---|
| The main session | orchestrates and acts on your behalf; quick things it does itself | works itself, delegates independent pieces and broad searches | works alone, no subagents |
| Independent work | several `Agent` calls in one message; three or more tasks, or tasks with dependencies, go in a swarm | several `Agent` calls in one message | none |
| External executors (team `mixed`, the default) | reinforcements: in a swarm the mod hands them the tasks that suit them, within the quota, and keeps the development on Claude | the same, if the pieces go in a swarm | not used, unless you ask |
| Plan in the list | mandatory, with description and phase | if the work has more steps | no |
| Surveillance | stuck agents and wake of the main session | stuck agents only | off |
| After a compaction by the mod | resumes by itself from the first open item of the plan | waits for you | waits for you |
| Questions | `domanda_scrivi`, in the pane, notification if you are away | as long | in chat, with context |
| Main session's model | yours | yours | `quickModello` (default `sonnet`, in config) |

The row on external executors follows the [team](#team) policy: with `claude` the rule says they are used only when you name them, with `external` it is the 0.15 rule (they are part of the team, and two or more self-contained tasks go in a swarm that spreads them). Quick is the same with every policy.

In every mode the rule asks that each question stand on its own: never "for question 1, what do we do?", but where things stand, what is being decided, the options with their consequences and the recommendation, in two or three lines.

The model switch in quick is a `/model` that the mod issues as soon as the command ends; if the engine does not accept it, a toast tells you to type it by hand.

### With NONoise

[NONoise](https://github.com/russosalv/NONoise) scaffolds a project with skills, a docs hierarchy, a context file for each AI tool and an advisor, Polly, that reads the project's SDLC flow in `.nonoise/sdlc-flow.md`. Regia is its orchestration layer for Claude Code: `create-nonoise` installs the plugin `regia@claude-regia` in the project (and declares it in `.claude/settings.json` when it works offline), and from version 1.9 NONoise no longer ships its own delegation skills (`swarm-router`, `copilot-delegate`, `gemini-delegate`, `codex-delegate`). Routing work to a swarm and delegating to Codex and to GitHub Copilot CLI are done here (`sciame_avvia`, `codex_avvia`, `copilot_avvia`); Gemini CLI is not one of Regia's executors, so `gemini-delegate` has no counterpart.

The two share the same three modes. In the flow file each SDLC phase lists the modes it belongs to, and when the file is there the rule of the current mode tells the main session to follow it:

- **long**: the phases the file assigns to `long` go into the plan in that order, each with its `fase`, and each runs the skill the file names;
- **medium**: short spec, plan, development, verification, with no requirements or architecture phases;
- **quick**: no phases and no documents.

In every mode the formal FPF validation (`arch-decision`) is proposed only for a decision that is costly to reverse and has more than one viable option, or when you ask for it. Polly works the other way round too: `/polly long <goal>` hands back a prompt that starts with `/regia long`, so the mode is chosen once.

Regia stays independent: it needs nothing from NONoise and works the same in a project that has never seen it. NONoise's other tools (Codex, Copilot, Cursor, Gemini CLI) do not run Regia; they read the same mode table from their context file.

## Questions for you

`domanda_scrivi` (id, titolo, contesto, opzioni, raccomandazione) records a decision that is yours, in `~/.claude/regia/domande.json`. In the pane, section **PER TE**, the `▸` key opens the question with its context and these keys:

- one per option: the answer goes to the main session as a message and the question closes;
- **answer in words**: a field at the top of the pane;
- **dig deeper with an agent**: a subagent that knows the question starts, explains the options (read-only, without deciding) and its conversation opens beside the pane so you can ask it questions;
- **let the main session decide**: it follows its own recommendation.

If you answer in chat, the main session closes the question itself. While a question waits, the main session carries on with whatever does not depend on it; the wake reminds it.

## Notifications

They go out through `$.ui.notify` (your notification channel, or the connected app) only when you are not in front of the session: after `/regia away`, or when the session is also open on another surface (remote-control, app). They arrive for a new question, for a finished plan, and for a plan stopped after 5 wakes without progress. `/regia here` turns them off.

## The plan

`scaletta_scrivi` accepts `descrizione` (the macro-activity explained to you) and `fase`. In the pane, section **PIANO**: open items grouped by phase, finished ones folded into `▸ N fatte`; `▸` on an item opens its description. An updated item stays in place. With the plan in its own box, its items are not repeated in the agents' tables.

## The main session delegates

`/regia orchestra`:

- **`guide`** (default): the mode's rule in the prompt.
- **`strict`**: in addition, in long mode, a refusal of `Edit`, `Write` and `NotebookEdit` from the main session on files inside the repository. The refusal message tells the model to delegate. Subagents, files outside the repository and `.claude/` (settings, memory) stay free.
- **`off`**: no rule.

It does not apply without a surface (`claude -p`, SDK: scripts and services work for themselves), without the `Agent` tool, or to subagents. Commands run through Bash cannot be told apart: the main session should not run tests or make a commit, but only the prompt says so.

## Model and effort, task by task

On each `Agent` call (a hook on `tool.call`) Haiku reads the description and prompt of the task and answers with a model (`haiku`, `sonnet`, `opus`), an effort (`low`, `medium`, `high`) and a reason. That costs one short call and a second or two, and it is not counted in the session's costs. If Haiku does not answer, Regia uses Sonnet and a heuristic on the words of the prompt.

Regia never overrides what the call states, the `model:` and `effort:` in the agent's file (`.claude/agents/<type>.md`), or forks. If only one of the two is set, it picks the other. To pin a type, use `"modelli": { "my-agent": "opus", "other": "inherit" }` in the config (`inherit`: the model is left alone).

The effort each subagent really runs with is read from `turn.step`, as Vitals does: the pane shows it as bars (`▰▱▱`), for Claude as well. If a task fails, the first choice is corrected from the result: the main session retries with an explicit model and effort one step higher, and a swarm does it by itself.

For Codex: `codex_avvia` without `sforzo` asks Haiku for the same judgment; the model, if it is neither in the call nor in the config (`codexModello`), is decided by Codex's own configuration.

For Copilot: the model is passed (`--model`) only if the call or the config (`copilotModello`) gives one, otherwise Copilot uses its own default; the effort is passed (`--effort`) only if the call gives `sforzo`, with no Haiku judgment. Qwen works the same way, without a config key for the model. Qoder too, with `qoderModello` and a default of `Qwen4-Max` (see [its section](#qoder-cli-qoder_avvia-and-qoder_riprendi)).

## Team

Claude is the development team, as subagents (the `Agent` tool) and as swarm tasks. The external executors (Codex, Qwen Code, Copilot) are reinforcements, and the team policy says how much of the work they get. Version 0.15 sent every self-contained swarm task to an external executor and told the main session to use them without being asked: that is now one of three policies, and not the default.

| Policy | Who develops | When external executors are used |
|---|---|---|
| `claude` | Claude only: the subagents, and every swarm task that states no `esecutore` | Only when you name one: `esecutore` on a swarm task, or `codex_avvia` / `qoder_avvia` / `qwen_avvia` / `copilot_avvia`. The mod makes no Haiku call for executors and does not probe the CLIs |
| `mixed` (default) | Claude: subagents for independent work, and in a swarm the development that needs understanding of the project | In a swarm, for the tasks that suit them, up to the quota (50% by default); and when you name one |
| `external` | The external executors for every self-contained swarm task; Claude keeps what is tied to the session | Always, with no cap: the 0.15 behaviour, described in [Executors](#executors) |

In every policy `esecutori` (`/regia executors`) still decides which external executors exist at all: a disabled one is refused even when named. A task with an explicit `esecutore` is left alone and does not count in the quota. Direct `Agent` calls are always Claude: no policy sends them to an external executor.

**The quota** (`squadraQuota`) applies to `mixed` only. Among the tasks the mod assigns in one swarm (the ones with no `esecutore`, `n` of them), at most `floor(n × quota / 100)` go to external executors, but at least one when `n` is two or more, the quota is above zero and at least one task was judged suitable for an external executor. With the default 50%: a single task stays with Claude, two tasks give one place, five give two, six give three. `0` keeps everything on Claude without asking Haiku; `100` is no cap.

**How the mod assigns in `mixed`**, for the tasks of one `sciame_avvia` call that state no `esecutore`:

1. **Constraints**, with no model call: a task with `tipo` stays with Claude; with no usable external executor everything stays with Claude; and if the quota leaves no place (a single task, quota 0, a swarm that has already used its places) everything stays with Claude and the board says `scelto dalla mod: quota esterni raggiunta`.
2. **One Haiku call** for the remaining tasks. Haiku is told that Claude is the main development team and keeps the development that needs understanding of the project (features touching several modules, design, anything that depends on the conversation or on this session's tools, MCP servers, skills and agent types; when in doubt, Claude), and that the external executors receive only what suits them: Qwen, mechanical or bulk edits, reading and summarising a lot of code, documentation, tests (the cheapest); Codex, independent review, audit, debugging, a well-specified isolated implementation; Copilot, a second implementation or a second opinion from another model family, a well-specified isolated implementation. The prompt ends with the cap, `Al massimo K compiti su N agli esecutori esterni`, and asks for the same one line of JSON.
3. **Fallback**, for the tasks Haiku left undecided: only a task that *looks* suitable can go out. That is a read-only task (`scrive` false), or one whose prompt says so in its first 240 characters: an obvious keyword for documentation, tests, review or mechanical work, in Italian or English (`documenta…`, `docs`, `readme`, `changelog`, `test`, `coverage`, `review`, `rivedi`, `audit`, `rename`, `rinomina`, `replace`, `sostituisci`, `lint`, `typo`, `bulk`, `in blocco`, `translate`, `summarize`, `riassumi`, a `second implementation` or `second opinion`), with no development word next to it (`implement`, `develop`, `design`, `refactor`, `feature` and their Italian forms). The suitable ones are spread least loaded first, with the same order of preference as in `external`. Everything else stays with Claude (`ripiego: sviluppo, resta a Claude`), and so does a prompt under 200 characters (`ripiego: compito breve`).
4. **The cap**, applied in code after Haiku's answer and after the fallback. When more tasks are headed out than there are places, the ones that stay external are, in order: the read-only ones, then the ones Haiku gave to Qwen or Qoder (bulk work, documentation, tests), then the order of the call. The others go back to Claude and the board says why: `scelto dalla mod: quota esterni raggiunta` (`ripiego: quota esterni raggiunta` for a task of the fallback). The mod never fills the quota: where Haiku said Claude, it is Claude.

`sciame_aggiungi` counts what the swarm already has: the cap is computed on all the tasks the mod has assigned in that swarm, old and new, whatever their state, and the places already taken by external executors are subtracted. Adding one task to a swarm whose quota is full asks nothing and gives it to Claude.

**What the main session is told.** The orchestration rule depends on the mode and on the policy, and each of the nine texts is fixed, so the section of the system prompt stays identical turn after turn (the quota is named, not its number).

| | `claude` | `mixed` | `external` |
|---|---|---|---|
| long | Independent work: several `Agent` calls. Three or more tasks, or dependencies: a swarm. The development team is Claude; the external executors only when the person names them | The same two lines, and in a swarm leave `esecutore` out: the mod keeps the main development on Claude and hands the enabled executors the tasks that suit them, within the quota. The external executors are reinforcements, not a replacement | The 0.15 rule: `Agent` calls for work tied to the session, a swarm from two self-contained tasks (or one long one), the external executors are part of the team |
| medium | Nothing about swarms or executors | Independent pieces go to `Agent` calls; in a swarm without `esecutore` the mod hands the suitable ones to the executors, within the quota | Independent self-contained pieces can go in a swarm, spread over Claude and the executors |
| quick | Works alone | Works alone | Works alone |

**Command and config.** `/regia team` shows the policy, the quota and what they mean; `/regia team claude|mixed|external` sets the policy and `/regia team <number>` the quota. They write the config keys `squadra` (`claude`, `mixed` or `external`; the Italian `mista` and `esterni` are accepted) and `squadraQuota` (a whole number from 0 to 100). Defaults: `mixed` and 50. A wrong value gives a warning and the default. The change applies at once to every session; tasks already assigned keep their executor. `/regia` shows it in its one-line summary (`team mixed 50%`) and `/regia doctor` has a `Squadra` line.

## Executors

A task can be done by five executors: **Claude** (a subagent of the session) and four external CLIs that run detached from it, **Codex** (`codex`), **Qoder** (`qodercli`, Qwen models), **Qwen Code** (`qwen`) and **GitHub Copilot CLI** (`copilot`). Qoder and Qwen Code serve the same models; Qoder is the one to prefer (the mod puts it before `qwen` in every order and tells Haiku so), and `qwen` stays for whoever has it working. How much of the work the external ones get is the [team](#team) policy; this section says which of them can be used and how the mod picks one for a swarm task that does not state it.

**Which executors can be picked.** An external executor is *usable* when it is enabled in the config and its CLI answers on this machine (`<cli> --version`, or, for `codex` and `copilot`, a copy under `~/.nvm/versions/node/*/bin`, where their launch scripts also look). The answer of the CLIs is remembered for five minutes, so a running swarm does not probe them at every tick. `/regia executors` and `/regia doctor` always look again and show, for each of the four, enabled or not and CLI found or not.

- Config key `esecutori`: a list among `codex`, `qwen`, `copilot`, `qoder`; all four by default. Unknown names are dropped with a warning; an empty list means Claude only.
- `/regia executors codex off` (and `on`, and the same for `qwen` and `copilot`) rewrites that list. This is not `/regia codex on|off`, which only decides whether Regia installs the Codex plugin for Claude Code.
- `/regia models off` does not turn the executor choice off: `/regia team claude` does, and so does `"esecutori": []`.

**How the mod chooses with the team `external`**, for the tasks of one `sciame_avvia` call that state no `esecutore` (a task added later with `sciame_aggiungi` is decided the same way, on its own). With `mixed` the steps are the same, but Haiku is told to keep the development on Claude, the fallback sends out only the tasks that look suitable and a cap applies: see [Team](#team). With `claude` there is nothing to choose.

1. **Constraints**, with no model call: a task with `tipo` (a Claude agent type) stays with Claude; with no usable external executor everything stays with Claude.
2. **One Haiku call per swarm**, for all the remaining tasks together. Haiku sees each task's name, whether it writes and the first 600 characters of its prompt, plus one line on what each usable executor is good for: Claude for work that needs this session's tools, MCP servers, skills or agent types, short lookups and anything tied to the conversation; Codex for autonomous implementation of a well-specified task, debugging, code review and audits; Qwen for mechanical or bulk edits, reading and summarising a lot of code, documentation and tests (the cheapest); Copilot for autonomous implementation and as a different model family for a second implementation or opinion. It is told to spread the work and to send self-contained tasks to an external executor, and it answers with one line of JSON, task name to executor. Only usable executors and only the tasks asked are accepted.
3. **Fallback**, for the tasks Haiku left undecided (no answer, an unknown name): the ones whose prompt is at least 200 characters long are spread in rotation over the usable external executors, each time to the least loaded one, preferring `codex`, `copilot`, `qoder`, `qwen` for a task that writes and `qoder`, `qwen`, `codex`, `copilot` for a read-only one. Shorter prompts are not taken as self-contained and stay with Claude.

The board says who chose, next to the executor: `indicato` (the call named it), `scelto dalla mod: …` (a constraint, the team policy, Haiku or the quota: `squadra claude`, `tipo di agente Claude`, `nessun esterno usabile`, `dal compito`, `quota esterni raggiunta`), `ripiego: …` (the fallback). `sciame_stato`, `/regia swarm` and the final summary print it; in the pane a waiting task shows `sciame <id> · indicato|mod|ripiego`.

**Forcing one.** State `esecutore` on the task (`"claude"` included) and the mod leaves it alone; the main session does this when you ask for a specific executor. For a single job outside a swarm there are still `codex_avvia`, `qoder_avvia`, `qwen_avvia` and `copilot_avvia`.

**A disabled executor** is refused with `esecutore <name> spento in config: /regia executors <name> on`, by its `*_avvia` tool and by `sciame_avvia` / `sciame_aggiungi` when a task names it (the whole call is refused, nothing starts).

**A missing CLI.** The mod never picks an executor whose CLI it cannot find. If you name one anyway, nothing changes from before: the job starts, the script ends with exit 127, and in a swarm the task retries once and then fails. If the mod picked the executor and its CLI turns out to be missing at launch (exit 127), or the executor was disabled while the task was waiting, the task goes to Claude instead of failing twice, and the board says `ripiego: CLI <name> non trovata`.

Swarm support is per executor, and all four external ones support it today: each has its own launch script, permission handling and log, described in the sections on [Codex](#starting-codex-the-codex_avvia-tool), [Qoder](#qoder-cli-qoder_avvia-and-qoder_riprendi), [Qwen Code](#qwen-code-qwen_avvia-and-qwen_riprendi) and [Copilot](#github-copilot-cli-copilot_avvia-and-copilot_riprendi).

## Swarms

```
sciame_avvia({
  obiettivo: "Migrate authentication",
  parallelo: 3,
  compiti: [
    { nome: "map",    prompt: "Find every use of the old API..." },
    { nome: "core",   prompt: "...", scrive: true, dopo: ["map"] },
    { nome: "client", prompt: "...", scrive: true, dopo: ["map"] },
    { nome: "doc",    prompt: "...", dopo: ["map"] },
    { nome: "tests",  prompt: "...", scrive: true, esecutore: "copilot", dopo: ["core"] },
    { nome: "review", prompt: "...", tipo: "code-reviewer", dopo: ["core", "client", "tests"] }
  ]
})
```

Five of these tasks state no `esecutore`: the mod assigns them according to the [team](#team). With the default `mixed`, the development (`core`, `client`) stays with Claude and at most two of the five can go to an external executor, the ones that suit it (here `map`, which only reads, and `doc`); `review` has an agent type, so it stays with Claude. `tests` forces Copilot, because the person asked for it, and does not count in the quota. The answer shows the board with the choice:

```
○ core (claude · scelto dalla mod: dal compito)
○ doc (qwen · scelto dalla mod: dal compito)
○ tests (copilot · indicato)
```

- **Ready tasks start**, up to `parallelo` (default 4, `sciameParallelo` in config, maximum 16). Up to 40 tasks per swarm; duplicate names, unknown dependencies and cycles are refused before anything launches.
- **Tasks that write** get their own worktree in `<repo>/.worktrees/<swarm>-<task>`, on branch `sciame/<swarm>/<task>`. The folder is excluded through `.git/info/exclude`, so your `.gitignore` is not touched.
- **Each agent knows** the goal, its teammates and the reports of the tasks it depends on. They write to each other with `posta_invia` and can add work with `sciame_aggiungi`.
- **A failed task retries once**, one step higher, on the same executor and knowing why it failed. If it fails again, whatever depends on it is blocked and the rest carries on. The one exception: a task whose executor the mod picked and whose CLI is missing goes to Claude, and that launch does not count as an attempt.
- **An agent waiting on its own command has not finished.** If a subagent ends its turn with a background command of its own still running (for example a test suite started with `run_in_background`), the engine notifies a provisional completion ("is waiting on its own background work", with a one-line report). The swarm recognizes it from the `waiting` state in `$.agent.list()`: the task stays in progress (the board says "in attesa di un suo comando"), dependents do not start, and it closes only on the definitive notification of the same agent. If it does not resume within `attesaMinuti` (default 45, in config), the task is marked failed, "stuck, to be checked", with no retry, and the main session is told at once. Every agent also receives the fixed line to run long commands in the foreground.
- **The main session spends nothing while it waits**: the swarm answers at once and wakes it with a single turn at the end, with the summary. Full reports are in `~/.claude/regia/sciami/<id>/<task>.md`.
- `sciame_stato` and `/regia swarm` show the board; `sciame_ferma` cancels what is waiting, and what is running finishes its job. Waiting tasks show in the plan list in the pane.

Limits: `turn.complete` does not say whether an ending is provisional; the signal is the agent's `waiting` state, which also holds for a plan to approve or an `Agent` call (that is why the task times out anyway). Merging the branches is left to a delegate of the main session; if the session closes, Claude subagents die with it (Codex, Qwen and Copilot jobs do not); a task that finishes while the mod reloads counts as completed, without its report.

## Surveillance and wake

A session left alone (overnight) must not stop halfway through the plan. Every minute the mod looks at the session:

- **Stuck agents.** A job in progress with no sign of life for `stalloMinuti` (default 30, in config) is stuck. For Codex, what counts is the last write of its log or, if the log is silent (during a long command Codex does not write to stderr), of its session file `~/.codex/sessions/.../rollout-*-<id>.jsonl`, which Codex updates at every wait for the command: if both are silent, the mod kills the `codex exec`, the script writes `fine` with a non-zero exit and, if it belonged to a swarm, the swarm relaunches it one step higher. For a Claude subagent, what counts is the last step (`turn.step`): a mod cannot stop it, so it tells the main session to use `TaskStop` and relaunch the task. Each stall is reported once.
- **Wake of the main session** (long mode only; in medium the surveillance looks only at stuck agents, in quick it is off). Event-driven: with agents at work the mod stays quiet, because the main session has nothing to decide and every wake costs it context. The plan in the list must have open items (`scaletta` or `in_corso`) and the main session must not have had a turn in progress for 3 minutes; then:
  - **no agent is working**: the mod sends it a turn to carry on by itself, marking `bloccato` what it cannot do;
  - **agents at work and news for it** (a job finished or failed, an unread mail message arrived): a single wake that groups everything. Swarms have their own summary at the end, and a person's answer to a question arrives by itself as a turn: the mod does not duplicate them;
  - **agents at work and nothing new**: only a parachute check with growing waits, `controlloMinuti` (default `[15, 30, 60]`: then it stays at 60). It restarts from the first value when the main session takes a turn for other reasons (its own turn after a mod wake does not reset it).

  The message is short: what changed since the main session last looked (jobs finished or failed, by name, unread mail), the counts (open items, agents running, open questions) and one line of instructions; the list of items it reads from the tools. If the last turn ended on an API error (limits, network), the message says so and it resumes.
- **No idle laps.** With nobody at work and no progress (no item or job changing state) the wait doubles at each wake, 3, 6, 12, 24, 48 minutes; after 5 the mod stops and warns with a toast. Progress reopens it. If there is a draft in the prompt field, the mod does not step in front of the person. If you stop the main session with Esc, the mod no longer wakes it (nor reports stalls to it) until you write to it yourself.

For this to work the plan must be in the list: the orchestrator rule asks for it (every item with `scaletta_scrivi`, updated at every step). It only applies with a surface (not `claude -p`). `/regia wake off` turns it off.

## Compaction

A long session fills its context, and the engine's own compaction arrives late and knows nothing of what Regia keeps outside the conversation. So the mod compacts earlier, with instructions that let the work go on.

- **What triggers it.** After each turn of the main session the mod reads how full the context window is (`$.session.usage()`, the figure of the status line; the call costs nothing). At `compattaSoglia` percent or more (default 60) it compacts the conversation. Only the main session, never a subagent, and only with a surface (not `claude -p` or the SDK). Not after a turn you stopped with Esc: it waits for the end of the next one.
- **What the instructions keep.** The summary is told to keep the goal you gave and every constraint or preference you stated; the decisions taken and why; what was done and verified, apart from what was only claimed; the files and branches touched; what is in progress and the very next step; the errors met and how they were solved; what you are waiting for. And to drop tool output dumps and exploration that led nowhere.
- **What Regia adds from its own stores.** Read at that moment, so they do not depend on the summary: the mode and whether you are away; the plan, one line per item with phase, state and description (at most 40 items and about 4000 characters: finished items are left out first, and the text says how many); the open questions for you, with their options; the swarms of this session still running or waiting, as the short board; the usable executors. The summary is told that these are the current facts and must appear as they are. All of it stays under 6000 characters.
- **Every compaction gets them.** The same instructions are added to `/compact` (after your own, which stay first), to the engine's automatic compaction and to another mod's. A subagent's compaction is left alone.
- **Afterwards.** After a compaction the mod made:
  - in **long**, if the plan has items to do (`scaletta` or `in_corso`), the mod sends the main session one short message: the context was compacted, the open items and the open questions (from the stores), continue from the first open item and re-read the files rather than trust the summary for details. It is not sent while a swarm or an agent of the session is working (when it ends it reaches the main session by itself), when only `bloccato` items are left (they wait for something else, usually your answer), or over a draft in the prompt field. It goes through the same door as the [wake](#surveillance-and-wake), so the two never both fire, and it follows `compatta`, not `sveglia`;
  - in **medium** and **quick** nothing is sent: your next message continues on the summary.

  A compaction you asked for (`/compact`, `/regia compact now`) never makes the main session resume.
- **No loops.** If the context is still at the threshold or above at the end of the turn that follows a compaction by the mod, and has not gone below it since, something that a summary cannot shrink is filling it (the system prompt, the tools, the memory files). The mod does not compact again until the context has grown by another 10 points, and tells you once, with a toast, to raise the threshold. It never compacts twice at the end of the same turn.

`/regia compact` shows the state, `/regia compact on|off` and `/regia compact <number>` change it (config keys `compatta` and `compattaSoglia`, from 30 to 90), `/regia compact now` compacts right away; `/regia doctor` has a line with the setting, the threshold and the current fill. A toast tells each compaction, for example `regia: contesto compattato, era al 63%; la conversazione ora pesa circa 9k token`.

Limits, stated plainly:

- **Only between turns.** The engine refuses to compact while a turn runs (and inside a command), and the mod never interrupts a turn. A context that passes the threshold in the middle of a long turn is compacted when that turn ends; in the meantime `/regia compact` says "Da compattare". If the next turn starts at once (a queued message), the mod tries again at its end. Past its own limit the engine compacts by itself, with the same instructions.
- **A context that cannot go below the threshold.** See "No loops": the mod stops and says so; raise `compattaSoglia`.
- **The summary is written by the model.** The instructions say what to keep and hand it Regia's facts, but nothing checks what it writes. The plan, the questions and the swarms do not depend on it: they stay in Regia's files and in the pane.
- **No "from 63% to 21%".** Right after a compaction the engine has no fill to report (it comes with the next response), and the size it gives for the result is not the fill of the window (on 2.1.325 it counts the conversation alone, without the system prompt and the tools). So the toast gives the fill before and the size of the conversation after; the fill after shows in `/regia compact` from the next turn.
- The instructions are added to an early summary the engine prepares ahead of time (`precompute`) too, since the engine may reuse it; Regia's facts in it are those of that moment.

## Token savings

- **A short final report** at the end of every delegate: the main session rereads every report at every turn, and it is the cost that grows most.
- **A sobriety rule** (write the minimum, reuse, no abstractions nobody asked for; never cut validation, security or tests of risky logic). If [Ponytail](https://github.com/DietrichGebert/ponytail) is active the mod does not repeat it: Ponytail already carries its own to subagents. There is no need to install it separately: when the mod is new or updated, the first interactive session installs it if it is missing (`claude plugin marketplace add` and `install`), once per version, and it loads from the next session. Then it lives its own life: the mod does not update it and, if you remove it, does not put it back until the next version. `/regia ponytail off` stops the mod installing it; one disabled by hand stays as it is; if the installation fails the mod uses its own rule and retries in the next session. The same goes for the Codex and Qwen plugins (see Install).
  Codex, Qwen, Copilot and Qoder jobs always receive the mod's rule.
- **The minimum model and effort** that suffice for the task (see above).
- **Deferred tools**: the schemas do not weigh on every request of every session. The model loads them with ToolSearch when needed.
- **The swarm** does not keep the main session busy while it waits.

## The pane

- The status line always concerns the session, for example `● 3 codex · 2 claude · 4 da fare`. The engine prefixes it with `⚠ regia:`: that prefix cannot be removed.
- **Talk to a subagent**: `▸ apri` brings its conversation into the main view; `[ ← principale ]` or `/regia` go back. In a narrow pane the job's name becomes clickable (`▸`).
- **A Codex, Qwen, Copilot or Qoder log**: `▸ log` shows the last 30 lines, `[ ↻ ]` rereads them.
- **Write**: `✉ scrivi` opens a field at the top of the pane; Enter sends as `utente`. `↻ riprendi` resumes a finished Codex, Qwen, Copilot or Qoder job.
- **Adaptive columns**: when space runs short they give way, in order: tokens, activity indicator, executor, keys, model and Dove/Esito. Lavoro and Durata stay. No row wraps.
- Sources are reread every 15 seconds (configurable) and at every `/regia`; while something is running the pane redraws every second. A source that fails gives a warning line, the others carry on.

## Starting Codex: the `codex_avvia` tool

The model loads it with ToolSearch as `mcp__regia__codex_avvia`. Parameters:

| Parameter | | |
|---|---|---|
| `nome` | required | slug of the job: letters, digits, `.`, `_`, `-`, at most 64, no `..` or `/` |
| `cartella` | required | the worktree, absolute or with `~`; it must exist and be a folder (the real path is used) |
| `prompt` | required | the task |
| `regole` | optional | a file to append to the prompt (must exist); if missing, `<project>/.regia/regole.md` when present (the project is the session's main repository) |
| `sforzo` | optional | `low`, `medium` or `high`; if missing the mod picks it |
| `modello` | optional | if missing, `"codexModello"` in config; without that too, Codex decides |

What it does:

1. checks the arguments and refuses (with the reason, as a tool error) a name already in progress: a live `codex exec` with that name, or the script waiting to retry (its pid is in `<nome>.pid`);
2. writes `~/.claude/regia/codex/<nome>/<nome>.prompt.md` (prompt + rules);
3. copies the plugin's `script/codex-esegui` script into `~/.claude/regia/bin/` (if missing or changed) and launches it with `setsid nohup`, detached: it survives the session. It launches it with the session's `CLAUDE_CODE_SESSION_ID` in the environment, so the job is attributed to the session;
4. answers at once with pid, paths, model and effort with the reason, and remembers the launch for the session in `$.store` (`regia.agenti.<id>`): the job belongs to the session even if it finishes before the mod sees it alive.

The script runs `nice -n 10 codex exec --dangerously-bypass-approvals-and-sandbox [-m <model>] -c model_reasoning_effort=<effort> -C <folder> -o <nome>.esito.md - < <nome>.prompt.md > <nome>.log 2>&1`, up to 4 attempts with `sleep 180` if the log says "at capacity" and the outcome is empty, and writes to `~/.claude/regia/codex/esegui.log`:

```
19:21 inizio prova-regia
19:24 prova-regia, riprovo (1)
19:30 fine prova-regia (exit 0, commit 2)
```

`commit` is `git rev-list --count main..HEAD` in the worktree (`?` if there is no `main` branch). That log is always among the sources, even with `codexLogs` in config, and until it exists it gives no warnings; `▸ log` opens `<nome>/<nome>.log`.

**Automatic effort.** Without `sforzo`, the mod asks Haiku (`$.model.complete`, one line of JSON) whether the task is `low` (mechanical or small), `medium` (normal development) or `high` (architecture, investigations, many files). If Haiku does not answer, a heuristic applies: words like design/investigate/analysis/refactor or a prompt over 6000 characters give `high`; mechanical tasks or under 400 characters give `low`; the rest `medium`. The tool's answer states effort, reason and who chose it (call, classification, heuristic).

## How much each subagent uses

For each subagent the mod remembers in `$.store` (`regia.agenti.<session>`) the real model and effort, the reason and who decided them: **chosen by regia**, **explicit** or **inherited**. The pane shows them in the Modello column and, for running ones, next to the type in the Dove column. The summary of `/regia` lists them too.

**Tokens.** At each `turn.complete` of a subagent the mod adds up input, output, cache reads and cache writes in that same memory. The pane, if there is room, has a Token column (`12k`, `1.4M`, cache included): it is the first to give way.

## Mail between agents

A single mailbox, `~/.claude/regia/posta/posta.jsonl`: one JSON line per message (`id`, `da`, `a`, `testo`, `ora`, `sessione`, `stato`, `via`) and one for each change of state (`nuovo` → `consegnato` → `letto`, or `errore` with a note). It is written only through the `posta` CLI (a `flock` lock), so the mod and the Codex jobs do not overwrite each other.

**Addresses.** `principale` (the session that owns the agent), `utente`, the name (`Agent({ name })`) or id of a running Claude subagent, the name of a running Codex job. A finished subagent, a finished Codex job or a name that does not exist gives an error that explains why and which addresses are valid now; the message does not enter the mailbox.

**From Claude**: the tools `posta_invia(a, testo)` and `posta_leggi()`, in the prompt from the start and available to subagents too. The sender is derived from the `agentId` of the call: `principale` for the main conversation, the name (or id) for a subagent.

**Delivery:**

- to a running Claude subagent: `$.session.append({ agentId, message: { type: 'user', ... } })`, so it really arrives in its loop (from the next turn), with an invitation to reply with `posta_invia`;
- to the main session: the same line in the main conversation plus a notice (toast). If the session is idle, the model reads it at the next turn: the mod does not start turns by itself;
- to the person: a notice and the line in the POSTA section of the pane;
- to a Codex job: it stays in the mailbox and Codex reads it by itself.

**From Codex**: the `posta` CLI (python3 `-I`, standard library only) lives in the plugin (`script/posta`) and `session.start` copies or updates it in `~/.claude/regia/bin/posta`.

```
~/.claude/regia/bin/posta leggi <my-name>                         # prints the new ones for me and marks them read
~/.claude/regia/bin/posta invia principale "text" --da <my-name>
~/.claude/regia/bin/posta elenco                                  # the last 20, for whoever looks
```

`codex_avvia` appends to the prompt a paragraph "Posta della regia" that explains to Codex how to read mail between steps and how to write to the main session. The message's session comes from `CLAUDE_CODE_SESSION_ID`, which the launch script exports. Every 5 seconds the mod looks at the mailbox and delivers to the session's own Claude agents the new messages written by Codex (or marks them `errore` if the recipient is gone).

**SendMessage.** Messages between Claude agents sent with SendMessage end up in the mailbox as a mirror (`via: SendMessage`, already delivered or in error): the mod observes the `tool.call` of SendMessage after `next`.

**In the pane:**

- a **POSTA** section with the last 5 messages: state (`●` new, `✓` delivered, dimmed `✓` read, `✗` error), time, `from → to`, truncated text;
- each running agent has `✉ scrivi`, which opens a text field (`Input`) at the top of the pane: Enter sends as `utente`, `✕ annulla` closes it. On the mobile surface, which has no text fields, the box says so;
- `▸ apri` stays for Claude subagents.

## Resuming a finished Codex job: `codex_riprendi`

`codex exec resume <session id> [PROMPT]` exists (codex-cli 0.163), so there is the tool `codex_riprendi(nome, messaggio)` and, in FATTI, the `↻ riprendi` key on every Codex job with a log. The Codex session id is read from `<nome>.sessione` (which the script writes at the end of a round) or from the log header (`session id: …`), where folder, model and effort are too. The launch is that of `codex_avvia` (detached, `esegui.log`, attempts on "at capacity") with `REGIA_RIPRENDI` in the environment: the script enters the job's folder (`resume` has no `-C`) and sends the message from `<nome>.riprendi.md`. The previous round's log and outcome go at the end of `<nome>.storico.log`. It also works for jobs from the logs in `codexLogs`: the log is searched next to the configured ones. A job still running is refused: you write to it with `posta_invia`.

## Qwen Code: `qwen_avvia` and `qwen_riprendi`

The same idea and the same code as Codex, with `qwen` in place of `codex exec`. `qwen_avvia(nome, cartella, prompt, regole?, sforzo?, modello?, scrive?)` writes prompt, log and outcome in `~/.claude/regia/qwen/<nome>/` and the `inizio`/`fine` lines in `~/.claude/regia/qwen/esegui.log` (always among the pane's sources, like Codex's). The `script/qwen-esegui` script runs, from the job's folder and with `nice`:

```
timeout 14400 qwen [-m <model>] [--reasoning-effort <effort>] --permission-mode <auto|default> --strict-mcp-config --session-id <uuid> -n <nome> -w <folder> -p < <nome>.prompt.md > <nome>.esito.md 2> <nome>.log
```

- **`--strict-mcp-config`**: always, also on resume. With a `.mcp.json` in the project, `qwen -p` loads its MCP servers and the provider always answers `provider_error`; this way it loads none. A `provider_error` in the outcome or the log counts as a failure (exit 1) even with exit 0.
- **Prompt from stdin**: no argument limit and no prompt in `ps`. The stdout of `qwen -p` is the final answer: it is the outcome (`<nome>.esito.md`). An empty answer with exit 0 counts as a failure (exit 1).
- **Permission**: `scrive` (default `true`) uses `--permission-mode auto`, `scrive: false` uses `default`. Tried on qwen 1.0.0-preview.1 with a task that creates a file, launches a shell, does `git commit` and `python3`: `accept_edits` writes files but refuses shell commands that are not read-only; `dont_ask` refuses everything; `auto` and `bypass_permissions` succeed, and `auto` is the less permissive. `default` reads and runs `ls`, but refuses writes. Whoever needs more (installing packages, commands that `auto` refuses) has no way out: the mod does not use `bypass_permissions`.
- **Effort**: if you do not give it, Qwen decides (no Haiku judgment). **Model**: the one you give, otherwise Qwen's default (there is no `qwenModello` in config).
- **A single attempt**: no repeats on "at capacity"; in a swarm the mod retries once, as for every task. A safety cap of 4 hours (`REGIA_QWEN_TIMEOUT`, seconds); the surveillance stops one that is silent for `stalloMinuti`, watching the log and the session file `~/.qwen/projects/<folder>/<id>.jsonl`.
- **The pane** shows Qwen jobs like Codex ones (a `qwen` row, `▸ log`, `✉ scrivi`, `↻ riprendi`, count `● 1 qwen`): the live ones are the `qwen -p` processes (name from `-n`, folder from `-w`, model from `-m`), the finished ones come from `esegui.log`. An interactive `qwen` session does not count.
- **`qwen_riprendi(nome, messaggio)`** (and the `↻ riprendi` key) uses `qwen --resume <id>`: the id is chosen by the script (`--session-id`) and written to `<nome>.sessione`, with folder and permission in `<nome>.cartella` and `<nome>.permesso`. Tried: the session remembers the previous round.
- **In a swarm**: the mod can pick Qwen for a task that states no executor (team `mixed` or `external`); `esecutore: "qwen"` forces it. `scrive: true` has its own worktree and the `auto` permission; `scrive: false` works read-only on the repository (`default`). The `posta` CLI requires a shell command: read-only, Qwen cannot use it.

## Qoder CLI: `qoder_avvia` and `qoder_riprendi`

The same idea and the same code as Qwen Code, with [Qoder CLI](https://qoder.com) (`qodercli`) in place of `qwen`: it serves Qwen models (`qodercli --list-models` lists, among others, `Qwen4-Max`, `Qwen3.8-Max` and `Qwen3.8-Flash`) and it is the preferred way to use them, because Qwen Code's own launch does not work well. `qoder_avvia(nome, cartella, prompt, regole?, sforzo?, modello?, scrive?)` writes prompt, log and outcome in `~/.claude/regia/qoder/<nome>/` and the `inizio`/`fine` lines in `~/.claude/regia/qoder/esegui.log` (always among the pane's sources). The `script/qoder-esegui` script runs, from the job's folder and with `nice`:

```
timeout 14400 qodercli [-m <model>] [--reasoning-effort <effort>] --permission-mode <auto|default> --session-id <uuid> -n <nome> -w <folder> -p < <nome>.prompt.md > <nome>.esito.md 2> <nome>.log
```

- **Model**: the one in the call, otherwise `qoderModello` in config, otherwise **`Qwen4-Max`**, the strongest Qwen model Qoder offers for code (the others are smaller or older). A name Qoder does not know is not an error for it: it warns on stderr (so in the log) and falls back to its own `Auto`, so check the log if the model matters.
- **Effort**: `--reasoning-effort low|medium|high` only if the call gives `sforzo`, with no Haiku judgment.
- **Permission**: `scrive` (default `true`) uses `--permission-mode auto`, `scrive: false` uses `default`, the same words as Qwen. Tried on qodercli 1.1.93 with a task that creates a file and runs `uname` and `python3`: `auto` does everything, `accept_edits` writes the file but refuses the commands, `default` and `dont_ask` refuse both (a read-only job still reads files). The mod does not use `bypass_permissions` or `--dangerously-skip-permissions`.
- **Prompt from stdin** (tried): no argument limit and no prompt in `ps`; the stdout of `qodercli -p` is the final answer, so it is the outcome. An empty answer with exit 0 counts as a failure (exit 1). No `--strict-mcp-config`: with a project `.mcp.json` that fails to start, `qodercli -p` still answers.
- **`qoder_riprendi(nome, messaggio)`** (and the `↻ riprendi` key) uses `qodercli --resume <id>`: the id is a UUID chosen by the script (`--session-id`) and written to `<nome>.sessione`, with folder and permission in `<nome>.cartella` and `<nome>.permesso`. Tried: the resumed session remembers the previous round. Qoder looks for the session in the project of the current folder, so the job is resumed from the same folder; a resume from a folder that no longer exists is refused. Without the launch memory (another Claude session) the resume uses `qoderModello` or `Qwen4-Max`, not the model of the first round.
- **A single attempt**, and a safety cap of 4 hours (`REGIA_QODER_TIMEOUT`, seconds) where `timeout` exists. The script looks for `qodercli` in `~/.local/bin` when it is not on the `PATH`; the detection in `/regia executors` and `/regia doctor` only uses the `PATH` of the session. A missing `qodercli` is exit 127 in `esegui.log`.
- **Surveillance**: a job silent for `stalloMinuti` is stopped, watching the log and the session file `~/.qoder/projects/<folder>/<id>.jsonl`.
- **The pane** shows Qoder jobs like Codex ones (a `qoder` row, `▸ log`, `✉ scrivi`, `↻ riprendi`, count `● 1 qoder`): the live ones are the `qodercli -p` processes (name from `-n`, folder from `-w`, model from `-m`), the finished ones come from `esegui.log`. An interactive `qodercli` session does not count.
- **In a swarm**: the mod can pick Qoder for a task that states no executor (team `mixed` or `external`) and prefers it to `qwen` when both are usable; `esecutore: "qoder"` forces it. `scrive: true` has its own worktree and the `auto` permission; `scrive: false` works read-only on the repository (`default`). The `posta` CLI requires a shell command: read-only, Qoder cannot use it.
- **Limits**: only the Qwen models were looked at, no other model Qoder serves; `qodercli` needs a signed-in account (`qodercli status`) and a model may stop being offered, so `qoderModello` can pin another one.

## GitHub Copilot CLI: `copilot_avvia` and `copilot_riprendi`

The same idea and the same code again, with [GitHub Copilot CLI](https://github.com/github/copilot-cli) in place of `qwen`. `copilot_avvia(nome, cartella, prompt, regole?, sforzo?, modello?, scrive?)` writes prompt, log and outcome in `~/.claude/regia/copilot/<nome>/` and the `inizio`/`fine` lines in `~/.claude/regia/copilot/esegui.log` (always among the pane's sources). The `script/copilot-esegui` script runs, from the job's folder and with `nice`:

```
timeout 14400 copilot [--model <model>] [--effort <effort>] <permission flags> --no-ask-user -s --log-dir <job folder>/log --session-id <uuid> -C <folder> < <nome>.prompt.md > <nome>.esito.md 2> <nome>.log
```

**Not tried on a real `copilot`.** Every flag comes from the official documentation (the [command reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference) and the [programmatic reference](https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-programmatic-reference), as of Copilot CLI 1.0.112) and from NONoise's retired `copilot-delegate` skill, which ran `copilot -p … --allow-all-tools --allow-all-paths` in production. The script itself is tested with a fake `copilot` (`tests/copilot-esegui.sh`). What the documentation does not state is marked below.

- **Prompt from stdin**: the documented alternative to `-p` ("pipe a prompt to the `copilot` command"), so there is no argument limit and no prompt in `ps`. **`-s`** (`--silent`) leaves only the agent's response on stdout: it is the outcome (`<nome>.esito.md`). An empty answer with exit 0 counts as a failure (exit 1). **`--no-ask-user`**: nobody is there to answer the `ask_user` form.
- **Permission**: `scrive` (default `true`) is `--allow-all-tools --allow-all-paths`: every tool without approval, and paths outside the folder (the `posta` CLI lives in `~/.claude/regia/bin`). URLs are not opened up (`--allow-all-urls` is not passed). `scrive: false` is `--deny-tool=write` and no allow flag at all: file creation and modification are denied outright (deny rules win over everything), and in a run with nobody to approve, whatever needs an approval is denied, so what is left is reading inside the folder and the shell commands Copilot itself judges read-only. That last part is Copilot's own analysis, not a guarantee, and it has not been measured here: a read-only job that needs a command Copilot wants approved (the `posta` CLI among them) will be refused it. There is no stricter mode in the mod: `--deny-tool=shell` would also take away `git diff`.
- **Model**: the one in the call, otherwise `copilotModello` in config, otherwise Copilot's own (`COPILOT_MODEL`, its `settings.json`, its default). Copilot writes Claude models with a dot (`claude-sonnet-4.6`). **Effort**: `--effort low|medium|high` only if you give `sforzo` (in a swarm, only on the retry one step higher); going by Copilot's changelog, a level the model does not offer is reported with a warning and left unapplied.
- **A single attempt**, and a safety cap of 4 hours (`REGIA_COPILOT_TIMEOUT`, seconds) where `timeout` exists (not on a stock macOS). A missing `copilot` is exit 127 in `esegui.log`; in a swarm a task that named Copilot retries once, as every task does, while one the mod had given to Copilot goes to Claude. Like `codex-esegui`, the script also looks for a `copilot` installed under nvm.
- **Surveillance**: a job silent for `stalloMinuti` is stopped. Since stderr stays quiet, the mod also looks at the outcome file and at the session's event log, `~/.copilot/session-state/<id>/events.jsonl` (`$COPILOT_HOME` is honoured). Not measured: how often Copilot writes that file during a long command; if it writes it only at the end, a job that works in silence for more than `stalloMinuti` would be stopped by mistake, and `stalloMinuti` is the knob.
- **The pane** shows Copilot jobs like Codex ones (a `copilot` row, `▸ log`, `✉ scrivi`, `↻ riprendi`, count `● 1 copilot`). With the prompt on stdin there is no `-p` to recognize a job by, so the live ones are the `copilot` processes with `--log-dir ~/.claude/regia/copilot/<nome>/log`: that is where the name comes from (folder from `-C`, model from `--model`), and it keeps Copilot's own logs in the job's folder. A `copilot -p` you launch by hand counts too, an interactive session does not.
- **`copilot_riprendi(nome, messaggio)`** (and the `↻ riprendi` key) runs the same command with `--resume=<id>` in place of `--session-id <uuid> -C <folder>`: the id is a UUID chosen by the script (the documentation says an unknown UUID given to `--session-id` starts a new session with that id, and that `--resume=SESSION-ID` is the way to continue one without a terminal) and written to `<nome>.sessione`, with folder and permission in `<nome>.cartella` and `<nome>.permesso`. Not tried: that the resumed session really remembers the previous round.
- **In a swarm**: the mod can pick Copilot for a task that states no executor (team `mixed` or `external`); `esecutore: "copilot"` forces it. `scrive: true` has its own worktree and the write permission; `scrive: false` works read-only on the repository.

## The to-do list

The tool `scaletta_scrivi(id, titolo, stato, descrizione, fase, note)` writes to `~/.claude/regia/registro.json`, which the pane reads: `stato` is `scaletta`, `in_corso`, `fatto`, `bloccato`, or `rimossa` to remove the item. Each item remembers the session that wrote it; those added by hand in the file, without a session, are valid for all.

## The "this session" view: how "mine" is decided

- **Claude subagents**: `$.agent.list()` is already the session's alone.
- **Codex jobs started with `codex_avvia`**: they belong to the session from the moment of launch (memory `regia.agenti.<id>`).
- **Codex**: `codex exec` processes inherit the environment variables of Claude's Bash, among them `CLAUDE_CODE_SESSION_ID`. The mod reads them from `/proc/<pid>/environ` (a single `grep -az` for all pids) and compares them with `$.session.id()`. It works even if the process was re-adopted by init after `nohup`/`setsid`, which walking up the parent processes does not survive.
- **Finished jobs**: `esegui.log` is shared and does not say who launched what. Each time the mod sees a session's codex alive it remembers its name in `$.store` (`regia.sessione.<id>`); when it ends, outcome and commit come from the `fine` line of the log. Memories idle for over 30 days are removed.
- **To-do list**: the items of this session and those without a session; the "all" view shows every item.

Where it can be wrong:

- a Codex job that is born and dies between two reads (under 15 seconds) is never seen alive and does not end up in the session's history, but it stays in the "all" view;
- a process launched outside Claude's Bash (a separate terminal) or whose environment is unreadable cannot be attributed: it shows only in "all";
- after `--resume` or `/clear` the session id changes: processes launched before stay with the session of that time;
- if two sessions launch a job with the same name, that name's history appears in both.

For each row: job name, executor (`claude`, `codex`, `qwen`, `copilot` or `qoder`), model (with the effort for Codex), duration, folder or agent type, a short outcome (exit code, number of commits). The `.esito.md` file is no longer shown.

## Sources

1. **Claude subagents** of the session, from `$.agent.list()`. In progress only `running`, `pending` and `waiting` (and `idle` for a teammate, who waits for messages); `completed` and an `idle` subagent go in FATTI as completed, `failed` and `killed` as failed and stopped.
2. **Running Codex**: `ps -ww -eo pid,etime,args`, `codex exec` lines. It extracts `-m` (model), `-c model_reasoning_effort=...`, `-C` (folder) and `-o` (the job's name is the basename without `.esito.md`). Processes duplicated by the npm launcher (same `-o`) count once. Qwen `qwen -p` processes are read the same way, and so are the `copilot` processes started by `copilot_avvia`.
3. **Codex history**: `~/.claude/regia/codex/esegui.log`, written by `codex_avvia`, plus the logs in `codexLogs` if you have others, with lines like:
   ```
   14:14 inizio job-alpha
   13:10 fine job-beta (exit 0, commit 5)
   ```
   An `inizio` with no `fine` and a live process is in progress; with no live process it is `interrotto`. A non-zero exit code is `fallito`.
4. **The to-do registry**: `~/.claude/regia/registro.json` (created by `scaletta_scrivi`; if missing the list stays "(vuota)"):
   ```json
   {
     "lavori": [
       {
         "id": "job-alpha",
         "titolo": "The job to do",
         "stato": "scaletta",
         "esecutore": "codex",
         "worktree": "~/project/.worktrees/job-alpha",
         "ramo": "feat/job-alpha",
         "note": "after job beta",
         "aggiornato": "2026-10-29T12:00:00Z"
       }
     ]
   }
   ```
   `id`, `titolo` and `stato` are required; `stato` is `scaletta`, `in_corso`, `fatto` or `bloccato` (blocked ones stay in the list, marked). Invalid items are skipped and the pane shows how many.
5. **Optional config** `~/.claude/regia/config.json`:
   ```json
   {
     "codexLogs": ["~/path/to/esegui.log"],
     "aggiornamentoSecondi": 15,
     "instradamento": true,
     "modelli": { "my-agent": "opus" },
     "orchestra": "guide",
     "risparmio": true,
     "ponytail": true,
     "pluginCodex": true,
     "pluginQwen": true,
     "sciameParallelo": 4,
     "sveglia": true,
     "stalloMinuti": 30,
     "attesaMinuti": 45,
     "controlloMinuti": [15, 30, 60],
     "quickModello": "sonnet",
     "esecutori": ["codex", "qwen", "copilot", "qoder"],
     "squadra": "mixed",
     "squadraQuota": 50,
     "compatta": true,
     "compattaSoglia": 60,
     "codexModello": "model-name",
     "copilotModello": "model-name",
     "qoderModello": "Qwen4-Max"
   }
   ```
   `orchestra` accepts `strict`, `guide` or `off` (and the Italian `stretta`, `guida`). `instradamento` is `/regia models`, `risparmio` is `/regia savings`, `sveglia` is `/regia wake`, and `ponytail`, `pluginCodex`, `pluginQwen` are the install opt-outs of `/regia ponytail`, `/regia codex` and `/regia qwen`. `esecutori` is `/regia executors`: the external executors the mod may use (`codex`, `qwen`, `copilot`; `[]` for Claude only). `squadra` and `squadraQuota` are `/regia team`: who develops (`claude`, `mixed` or `external`, and the Italian `mista`, `esterni`; default `mixed`) and, for `mixed`, the largest share of the mod-assigned tasks of one swarm that may go to external executors, a whole percentage from 0 to 100 (a value out of range gives a warning and the default, 50). `compatta` and `compattaSoglia` are `/regia compact`: whether the mod compacts and adds its instructions, and the threshold as a whole percentage from 30 to 90 (a value out of range gives a warning and the default, 60). `~` is expanded. `codexLogs` and `aggiornamentoSecondi` are read when the mod starts (after a change it must be reloaded); the others on each use.

If a source fails the pane shows a yellow warning line and the others carry on.

## Known limits

- The pane, the tool names and parameters, the config keys and the messages are still in Italian; only the commands and this README are in English.
- `AgentInfo` exposes neither the model nor the start time of subagents: the model is known only for agents started with the mod already loaded (from the spawn), the others show `—`; the duration starts from when the mod saw them. If a subagent was already there at the first read (mod just loaded, session resumed) the duration is written `≥3m`, a minimum; if it was already finished it is `—`.
- The engine removes finished subagents from `$.agent.list()` after a while: the mod remembers them in `$.store` (session key, next to the Codex names: name, type, outcome, time it saw them finish, at most 50) and keeps them in FATTI, without the `▸ apri` key any more. A subagent that is born and ends between two reads is never seen.
- The script logs have only the time (`HH:MM`), with no date: durations of finished jobs are to the minute and the order of FATTI follows the log, not a calendar. With several logs, Claude subagents' facts come first, then Codex ones, then those of the registry.
- In the log, job names can contain spaces and lines with a time but without `inizio`/`fine` ("18:29 ALL DONE") are annotations: they are ignored without warning. A line without a time counts as unrecognized.
- The selection does not see `model:` and `effort:` of definitions in plugins or in subfolders of `.claude/agents/`: for such a type, if the definition has a model of its own, put it in the config with `"inherit"`.
- The agents of a workflow (`Workflow`) do not pass through the `Agent` tool: model and effort are decided by the script.
- Tokens count only the turns of subagents that finished with the mod loaded.
- A Codex job that finishes in a few seconds goes straight into FATTI (it is never seen alive), but stays with the session thanks to the launch memory.
- Mail: the main session, if idle, reads a message only at the next turn; a message to a subagent arrives at its next loop turn (it does not interrupt a long command). The mailbox grows without pruning: the mod reads its last 4000 lines.
- A message from a Codex job launched outside Claude's Bash has no session: nobody delivers it, and it shows only in the "all" view.
- In a narrow pane the keys column gives way and only the job's name stays clickable (the main key): `✉ scrivi` and `↻ riprendi` need a pane wide enough.
- The executor choice sees only the first 600 characters of each task's prompt, and Haiku gives no reason of its own: the board says `scelto dalla mod: dal compito`. In the pane, who chose is shown only on waiting tasks.
- With the team `mixed`, when Haiku does not answer the mod tells a suitable task from development with a short list of keywords at the start of the prompt: a task described in other words stays with Claude. The quota counts tasks, not their size.
- `qwen-esegui` does not look for `qwen` under nvm, so neither does the detection: a `qwen` outside the `PATH` of the session counts as missing.
- A wrapper that is not `codex exec` directly (for example `bash -c "codex exec ..."`) is not recognized.

## Development

Pure logic lives in the parsers and the board (`hooks/parsers.ts`, `hooks/registro.ts`, `hooks/instradamento.ts`, `hooks/sciame.ts`, `hooks/compatta.ts`) and is tested separately; the swarm engine is in `hooks/sciame-motore.ts`, delegation in `hooks/orchestra.ts`, compaction in `hooks/compatta.ts` (the instructions and the decisions, pure) and `hooks/compatta-motore.ts`, executor detection and choice in `hooks/esecutori.ts` (the rules of the choice, with the team policy, its cap and the keyword check, are pure, in `hooks/instradamento.ts`). Drawing lives in `hooks/tavola.tsx` (table, rules, boxes, pills), `hooks/layout.ts` (cells and columns, pure) and `hooks/vista.tsx` (composition). `tests/resa.ts` turns the drawn tree into lines of text, so the tests check that at 40, 60, 80 and 120 columns no line exceeds the width. Checks:

```sh
claude plugin validate .
claude plugin test .
bash tests/qwen-esegui.sh && bash tests/copilot-esegui.sh && bash tests/qoder-esegui.sh   # the launch scripts, with a fake CLI
claude --plugin-dir .   # try it in a session; edits reload
```

## Credits

Layout techniques adapted from [cc-vitals](https://github.com/naicud/cc-vitals) by naicud (MIT): cell measuring (`cellWidth`), columns that give way by priority (`fitColumns`), a table with `│` and the `─┼─` rule, the section rule, effort bars and the spinner. The adapted code is in `hooks/tavola.tsx`. Regia and Vitals work well together: Vitals shows consumption and limits, Regia coordinates the agents.

## License

MIT, see [LICENSE](LICENSE).
