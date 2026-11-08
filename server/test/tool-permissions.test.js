import test from "node:test";
import assert from "node:assert/strict";
import { TOOLS, TOOL_CLASSES, needsApproval, planBlocked } from "../tools.js";

test("every assistant tool has a valid permission classification", () => {
  assert.deepEqual(Object.keys(TOOL_CLASSES).sort(), TOOLS.map((tool) => tool.name).sort());
  for (const tool of TOOLS) assert.ok(["read", "change", "risky"].includes(tool.permission), tool.name);
});

test("read, change and risky tools follow ask, auto, dangerous and plan modes", () => {
  const toolOf = (permission) => TOOLS.find((tool) => tool.permission === permission).name;
  const read = toolOf("read"), change = toolOf("change"), risky = toolOf("risky");
  assert.deepEqual(["ask", "auto", "dangerous", "plan"].map((mode) => [needsApproval(mode, read), needsApproval(mode, change), needsApproval(mode, risky)]), [
    [false, true, true], [false, false, true], [false, false, false], [false, true, true],
  ]);
  // Plan mode never creates a proposal: the server refuses a writing tool outright.
  assert.deepEqual(["plan", "auto", "ask", "dangerous"].map((mode) => [planBlocked(mode, read), planBlocked(mode, change), planBlocked(mode, risky)]), [
    [false, true, true], [false, false, false], [false, false, false], [false, false, false],
  ]);
});
