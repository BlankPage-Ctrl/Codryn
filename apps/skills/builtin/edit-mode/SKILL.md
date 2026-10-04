---
name: edit-mode
description: Use this skill when starting file edits. Proper tips for create_file and edit_file.
---

# Edit Mode

Use this skill before creating or modifying files. It covers the correct
usage of `create_file` and `edit_file`.

## What You(AI/LLM) supposed to be like?

- Do what this codebase already does. Don’t invent a new way of doing something the codebase already has a way to do.
- If you wish to add a comment to a line of code, use ASCII characters only; Do not use any non-ASCII Unicode characters
  such as em dashes, arrows, and the like.

## Which tool to use

- `create_file`: only for files that do not exist yet. Parent directories are created automatically.
- `edit_file`: only for files that already exist. Never recreate an existing file with `create_file`.

## create_file tips

- One file per call. Use parallel calls for multiple files.
- Keep `content` under 200k chars.
- If the file exists you get `ALREADY_EXISTS`. Then either call `edit_file` or retry with `overwrite: true`.
- Verify with `read_file` or `list_files` after creating.

## edit_file format

The input is a single `raw` string:

```
<workspace-relative-path>
<<<<<<< SEARCH [lines <start>[-<end>]]
<exact original text>
=======
<replacement text, may be empty to delete>
>>>>>>> REPLACE
```

Rules:

- First line is the workspace-relative file path, for example `src/foo.ts`.
- One file per call. For other files, make additional calls.
- You can send up to 50 blocks for the same file in one call. Batch all edits to the same file into a single call instead of spamming the tool.
- SEARCH must match the file content exactly, including indentation. Copy it from `read_file`. Do not retype from memory.
- An empty replacement deletes the matched text.
- Do not wrap the whole message in extra prose. A surrounding markdown code fence is allowed, nothing else.

Example, single edit:

```
src/utils/greet.ts
<<<<<<< SEARCH lines 8-9
export function greet(name: string) {
  return "hi " + name;
=======
export function greet(name: string) {
  return `hi ${name}`;
>>>>>>> REPLACE
```

Example, two edits to the same file in one call:

```
src/auth/middleware.py
<<<<<<< SEARCH lines 19
    if not validate_token(token):
=======
    log_request(request)
    if not validate_token(token):
>>>>>>> REPLACE
<<<<<<< SEARCH lines 13-14
    if not validate_token(old_token):
        raise ValueError("Invalid token")
=======
    if not validate_token(old_token):
        raise AuthenticationError("Token validation failed")
>>>>>>> REPLACE
```

## lines hint tips

- The `lines <start>[-<end>]` hint after SEARCH is optional but strongly
  recommended when the text may repeat.
- Take the numbers from the `read_file` header (`lines X-Y of Z`).
- If the hint points at the wrong place you get `NOT_FOUND_IN_HINT`.
  Fix the numbers or drop the hint.

## If an error occurs, do this

- `VALIDATION_FAILED`: a block is malformed. Check that every block has
  `<<<<<<< SEARCH`, then `=======`, then `>>>>>>> REPLACE`. The first line
  must be a file path, not a delimiter.
- `NOT_FOUND`: SEARCH text was not found. The file may be stale. Re-read
  with `read_file` and copy the SEARCH text exactly.
- `AMBIGUOUS`: SEARCH matches several locations. Add a `lines` hint that
  points at exactly one of the listed locations.
- `NOT_FOUND_IN_HINT`: the text exists but not inside the hinted range.
  Fix the `lines` numbers to one of the listed locations, or drop the hint.
- `OVERLAP`: two blocks in the same call overlap. Merge them into one
  block, or split them into separate `edit_file` calls.
- `ALREADY_EXISTS` (create_file): use `edit_file` instead, or retry with
  `overwrite: true`.
- `PATH_NOT_FOUND`: the path does not exist. Check it with `list_files`.
- `PATH_TRAVERSAL`: the path escapes the workspace. Use a relative path
  inside the project, for example `src/foo.ts`.

Never repeat a failed call without changing something first.
