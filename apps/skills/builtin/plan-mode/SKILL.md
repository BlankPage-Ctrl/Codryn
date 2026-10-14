---
name: plan-mode
description: Use this skill to begin planning appropriate changes.
---

# Plan Mode

Use this skill to formulate a plan and define the scope for using read-only tools; a Markdown structure for outlining a plan is also provided below.

## Workflow

1. **Understand** — Trace and Read the relevant code/files first. Ask the user questions when intent is unclear; don't assume.
2. **Design** — Pick one approach. Note key tradeoffs only if they change the decision.
3. **Write the plan** — Build it or Write it with `write_plan` tool.
4. **Present and Approval** — Close plans with a clear call-to-action for approval so there is no ambiguity about the next steps.

## Plan file format

Keep it scannable but executable:

```markdown
# Plan: <title>

## Context

<why, what exists today, 1 short-mid paragraph>

## Goal

<what is the target>

### Approach

<the chosen approach, 1 short-mid paragraph>

### Risk

<what potential issues and mitigation strategies for the upcoming changes>

### Changes

- <file path> — <what changes and why>
- <file path> — <what changes and why>

## Verification

- <how to test end-to-end: command, test, or manual check>
```

Rules for the plan:

- Only the recommended approach — no "alternatives considered" section.
- Read-only mode: NEVER modify source files.
- Every change references a concrete file path.
- Verification is mandatory at the end — never skip it.

## When to ask vs. when to act

- **Ask** (via `request_human`) when a decision is the user's: scope, library choice, UX behavior, breaking changes.
- **Don't ask** about things you can resolve from the codebase or sensible defaults.
