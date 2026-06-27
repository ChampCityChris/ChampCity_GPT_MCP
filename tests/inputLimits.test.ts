import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { ApplyApprovedPatchInputSchema } from "../src/tools/applyApprovedPatch.js";
import { MAX_PATCH_LENGTH, MAX_PROPOSE_PATCH_TEXT_LENGTH } from "../src/tools/inputLimits.js";
import { ProposePatchInputSchema } from "../src/tools/proposePatch.js";

describe("input size limits", () => {
  it("rejects oversized approved patch payloads", () => {
    assert.throws(
      () =>
        ApplyApprovedPatchInputSchema.parse({
          root: process.cwd(),
          patch: "x".repeat(MAX_PATCH_LENGTH + 1),
          approvalToken: "test-write-token"
        }),
      /String must contain at most/
    );
  });

  it("rejects oversized propose patch text fields", () => {
    assert.throws(
      () =>
        ProposePatchInputSchema.parse({
          root: process.cwd(),
          changes: [
            {
              relativePath: "README.md",
              originalText: "x".repeat(MAX_PROPOSE_PATCH_TEXT_LENGTH + 1),
              replacementText: "ok"
            }
          ]
        }),
      /String must contain at most/
    );
  });
});
