import assert from "node:assert/strict";

import { chatRoleLabel, parseChatTarget } from "../src/lib/chat-routing.ts";

assert.deepEqual(parseChatTarget("ship this"), {
  role: "product_manager",
  message: "ship this",
  mention: null
});

assert.deepEqual(parseChatTarget("@PM clarify scope"), {
  role: "product_manager",
  message: "clarify scope",
  mention: "PM"
});

assert.deepEqual(parseChatTarget("@architect review the plan"), {
  role: "architect",
  message: "review the plan",
  mention: "architect"
});

assert.deepEqual(parseChatTarget("@devops check deploy"), {
  role: "devops",
  message: "check deploy",
  mention: "devops"
});

assert.deepEqual(parseChatTarget("@qa run cases"), {
  role: "product_manager",
  message: "@qa run cases",
  mention: "qa"
});

assert.equal(chatRoleLabel("product_manager"), "PM");
assert.equal(chatRoleLabel("developer", "Header issue", "web_developer"), "Developer: web_developer");
assert.equal(chatRoleLabel("qa", "QA: main flow"), "QA: main flow");

console.log("chat routing simulation passed");
