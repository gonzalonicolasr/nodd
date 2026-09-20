import { test } from "node:test";
import assert from "node:assert/strict";
import { isMutation } from "./request.ts";

// ---------------------------------------------------------------------------
// The edge of enforcement, pinned deliberately.
//
// `isMutation` recognises pi's three builtin mutation paths — `write`, `edit`
// and mutating `bash`. Anything else that writes, an MCP server's write tool
// or a tool from another harness, is invisible to every gate. That is a real
// hole, and this test exists so it is a *known* hole: if the coverage ever
// changes, the list changes with it and the README's claim has to follow.
// ---------------------------------------------------------------------------
test("enforcement covers pi's builtin writers, and nothing beyond them", () => {
  const covered = [
    { toolName: "write", input: { file_path: "a.ts" } },
    { toolName: "edit", input: { file_path: "a.ts" } },
    { toolName: "bash", input: { command: "echo x > a.ts" } },
  ];
  for (const request of covered) {
    assert.equal(isMutation(request), true, `${request.toolName} must be gated`);
  }

  // Not gated today. Listed, not accepted: a user running a filesystem MCP has
  // a writer NODD cannot see.
  const uncovered = [
    { toolName: "mcp__filesystem__write_file", input: { path: "a.ts", content: "x" } },
    { toolName: "apply_patch", input: { patch: "..." } },
    { toolName: "str_replace_editor", input: { path: "a.ts" } },
  ];
  for (const request of uncovered) {
    assert.equal(
      isMutation(request),
      false,
      `${request.toolName} is now gated — good, but the README's "Known limitations" must be updated to match`,
    );
  }
});
