import assert from "node:assert/strict";
import test from "node:test";
import { requiresAdapterLogin } from "./auth.js";

test("gates GitHub editors until authenticated", () => {
  assert.equal(
    requiresAdapterLogin({ name: "github" }, { authenticated: false }),
    true
  );
  assert.equal(
    requiresAdapterLogin({ name: "github" }, { authenticated: true }),
    false
  );
  assert.equal(
    requiresAdapterLogin({ name: "node" }, { authenticated: true }),
    false
  );
});
