import assert from "node:assert/strict";
import test from "node:test";
import { createPreviewRegistry } from "./registration.js";

test("registers one project-owned React component before initialization", () => {
  const registry = createPreviewRegistry();
  function ProjectPreview() {}
  registry.registerPreview(ProjectPreview);

  assert.equal(registry.lockPreviewRegistration(), ProjectPreview);
});

test("a later registration replaces the previous registration", () => {
  const registry = createPreviewRegistry();
  function InitialPreview() {}
  function ReplacementPreview() {}
  registry.registerPreview(InitialPreview);
  registry.registerPreview(ReplacementPreview);

  assert.equal(registry.lockPreviewRegistration(), ReplacementPreview);
});

test("registration validates and closes when miniCMS initializes", () => {
  const registry = createPreviewRegistry();
  assert.throws(() => registry.registerPreview(null), /React component/);
  assert.throws(
    () => registry.registerPreview({ mount() {} }),
    /React component/
  );

  registry.lockPreviewRegistration();
  assert.throws(
    () => registry.registerPreview(() => null),
    /before miniCMS\.init/
  );
});
