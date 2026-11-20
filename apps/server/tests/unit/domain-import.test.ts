import test from "node:test";
import assert from "node:assert/strict";
test("domain module imports without infrastructure dependencies", async () => {
  const module = await import("../../src/domain/errors/configuration-error.js");
  assert.equal(new module.ConfigurationError("x").name, "ConfigurationError");
});
