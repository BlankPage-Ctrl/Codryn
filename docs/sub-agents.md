# Sub-Agents in Codryn

A **sub-agent** is a helper assistant the main assistant can call for exactly
that kind of side job. Think of it like a manager asking a specialist to look
into something and report back. The specialist works on its own, then returns
with a short answer. You only ever see the final conversation; the helper's
scratch work stays out of your way.

> [!NOTE]
> By default, Codryn comes with a built-in Sub-Agent called 'explorer'. If the workspace has a helper with the title 'explorer', the system will use that 'explorer' workspace.

## Making your own helper

Create a folder named `.codryn/agents` inside
your project, then add one file per helper with markdown file extension.Each file has two parts: a small settings block at the top, and the
instructions below it.

> [!NOTE]
> The file name becomes the helper's name. For example, `.codryn/agents/db-expert.md` creates a helper called
`db-expert`.

### Example:

```markdown
---
description: Database specialist for Postgres and Drizzle questions
tools: [read_file, grep, list_files, mcp__postgres__*]
maxSteps: 15
---

You are a database specialist.
Answer with the exact files and queries involved, and say when you are unsure.
```

The settings block supports these options. Everything except `description`
is optional.

| Option | What it does |
| --- | --- |
| `description` | **Required.** One line saying when this helper should be used. The main assistant reads this to decide who to call, so describe the job, not just the title. |
| `mode` | `ask` (default), `plan`, or `edit`. It sets the starting permissions: `ask` helpers can only look, `edit` helpers may also change files and run commands. |
| `tools` | A list of exactly what the helper may use. If you write this list, it replaces the default. You can name tools directly; The list of tools is below. |
| `disallowedTools` | Tools to take away, even if the mode would allow them. |
| `maxSteps` | How long the helper may work before it must stop and report back (default 20, maximum 50). |
| `timeoutMs` | Time limit in milliseconds (default 120000, two minutes). |
| `modelHint` | A preferred AI model for this helper, for example `gpt-6-astra`. This is only a suggestion.|


> [!IMPORTANT]
> If a `modelHint` is set but that model is gone or misspelled, the helper falls back to your chat's model and says so in one line at the top of its answer.

## Skills and plugins come along automatically

A helper is not a stripped-down assistant. It brings the same toolbox:

- **Skills.** Every skill available to the main chat (project skills, global
  skills, and plugin skills) can also be used by the helper through the
  `skill` tool. The helper loads skill content on demand, the same way the
  main assistant does.
- **Plugins and MCP tools.** Plugin tools travel with the helper too. The one
  exception: in the default read-only mode, MCP and plugin tools are not
  included unless you list them in `tools`, exactly like the `db-expert`
  example above does with `mcp__postgres__*`. This keeps research helpers
  safe by default while letting you grant access where it makes sense.

> [!NOTE]
> It cannot ask you questions directly, and it cannot call another helper. The main assistant stays in charge of talking to you, and helpers never chain more than one level deep.

## Tips for good helpers

- **Write the task, not just the title.** The `description` is what the main
  assistant uses to pick a helper. "Postgres and Drizzle specialist for
  query and migration questions" gets picked far more reliably than
  "database helper".
- **Keep helpers small and single-purpose.** One helper that does research
  well beats one helper that does a bit of everything. You can always make
  more files.
- **Let the main assistant write the briefing.** When it calls a helper, it
  passes a self-contained task with the goal, the relevant files, and what
  result it expects. You do not need to prepare anything for the call itself.
- **Name MCP tools with wildcards.** Tool names from integrations can be long
  and hard to guess. `mcp__github__*` grants the whole integration without
  listing every tool.
