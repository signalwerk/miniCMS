import assert from "node:assert/strict";
import test from "node:test";
import { requiresAdapterLogin } from "./auth.js";

test("gates every adapter whose session requires authentication", () => {
  assert.equal(
    requiresAdapterLogin(
      { name: "github" },
      { authenticated: false, authenticationRequired: true }
    ),
    true
  );
  assert.equal(
    requiresAdapterLogin(
      { name: "api" },
      { authenticated: false, authenticationRequired: true }
    ),
    true
  );
  assert.equal(
    requiresAdapterLogin(
      { name: "github" },
      { authenticated: true, authenticationRequired: true }
    ),
    false
  );
  assert.equal(
    requiresAdapterLogin(
      { name: "api" },
      { authenticated: true, authenticationRequired: false }
    ),
    false
  );
});
