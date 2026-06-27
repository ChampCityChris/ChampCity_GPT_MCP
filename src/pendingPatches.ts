import { createHash, randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";

import { getRuntimeConfigFilePath } from "./runtimePaths.js";
import { AppError } from "./utils/errors.js";

export const PENDING_PATCHES_FILE = "pending-patches.local.json";
export const PATCH_PROPOSAL_TTL_MS = 2 * 60 * 60 * 1000;

export interface PendingPatchProposal {
  id: string;
  root: string;
  patchHash: string;
  affectedFiles: string[];
  createdAt: string;
  expiresAt: string;
  used: boolean;
}

interface PendingPatchStore {
  proposals: PendingPatchProposal[];
}

function now(): Date {
  return new Date();
}

export function sha256Patch(patch: string): string {
  return createHash("sha256").update(patch).digest("hex");
}

export function getPendingPatchesPath(repoRoot: string): string {
  return getRuntimeConfigFilePath(repoRoot, PENDING_PATCHES_FILE);
}

function writeStore(repoRoot: string, store: PendingPatchStore): void {
  const storePath = getPendingPatchesPath(repoRoot);
  fs.mkdirSync(path.dirname(storePath), { recursive: true });
  fs.writeFileSync(storePath, `${JSON.stringify(store, null, 2)}\n`, "utf8");
}

export function readPendingPatchStore(repoRoot: string): PendingPatchStore {
  const storePath = getPendingPatchesPath(repoRoot);
  if (!fs.existsSync(storePath)) {
    return { proposals: [] };
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(fs.readFileSync(storePath, "utf8"));
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new AppError("INVALID_INPUT", `Invalid JSON in ${storePath}: ${detail}`);
  }

  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new AppError("INVALID_INPUT", `${storePath} must contain a JSON object.`);
  }

  const raw = parsed as { proposals?: unknown };
  if (!Array.isArray(raw.proposals)) {
    return { proposals: [] };
  }

  const proposals = raw.proposals.filter((proposal): proposal is PendingPatchProposal => {
    if (!proposal || typeof proposal !== "object" || Array.isArray(proposal)) {
      return false;
    }
    const entry = proposal as Record<string, unknown>;
    return (
      typeof entry.id === "string" &&
      typeof entry.root === "string" &&
      typeof entry.patchHash === "string" &&
      Array.isArray(entry.affectedFiles) &&
      entry.affectedFiles.every((file) => typeof file === "string") &&
      typeof entry.createdAt === "string" &&
      typeof entry.expiresAt === "string" &&
      typeof entry.used === "boolean"
    );
  });

  return { proposals };
}

export function pruneExpiredPendingPatches(repoRoot: string, currentTime: Date = now()): PendingPatchStore {
  const store = readPendingPatchStore(repoRoot);
  const proposals = store.proposals.filter((proposal) => proposal.used || Date.parse(proposal.expiresAt) > currentTime.getTime());
  if (proposals.length !== store.proposals.length) {
    writeStore(repoRoot, { proposals });
  }
  return { proposals };
}

export function registerPatchProposal(repoRoot: string, root: string, patch: string, affectedFiles: string[]): PendingPatchProposal {
  const currentTime = now();
  const store = pruneExpiredPendingPatches(repoRoot, currentTime);
  const proposal: PendingPatchProposal = {
    id: randomUUID(),
    root: path.resolve(root),
    patchHash: sha256Patch(patch),
    affectedFiles,
    createdAt: currentTime.toISOString(),
    expiresAt: new Date(currentTime.getTime() + PATCH_PROPOSAL_TTL_MS).toISOString(),
    used: false
  };

  writeStore(repoRoot, {
    proposals: [...store.proposals, proposal]
  });
  return proposal;
}

export function getPendingPatchProposalCount(repoRoot: string): number {
  return pruneExpiredPendingPatches(repoRoot).proposals.filter((proposal) => !proposal.used).length;
}

export function clearPendingPatchProposals(repoRoot: string): void {
  writeStore(repoRoot, { proposals: [] });
}

export function assertPatchMatchesPendingProposal(
  repoRoot: string,
  root: string,
  patch: string,
  proposalId?: string,
  patchHash?: string
): PendingPatchProposal {
  const expectedHash = patchHash ?? sha256Patch(patch);
  const actualHash = sha256Patch(patch);
  if (expectedHash !== actualHash) {
    throw new AppError("PATCH_DENIED", "Patch hash does not match the supplied patch content.");
  }

  const resolvedRoot = path.resolve(root);
  const currentTime = now().getTime();
  const store = readPendingPatchStore(repoRoot);
  const proposal = store.proposals.find((entry) => {
    if (proposalId && entry.id !== proposalId) {
      return false;
    }
    return entry.patchHash === actualHash && path.resolve(entry.root) === resolvedRoot;
  });

  if (!proposal) {
    throw new AppError("PATCH_DENIED", "Patch does not match a registered pending proposal.");
  }

  if (proposal.used) {
    throw new AppError("PATCH_DENIED", "Patch proposal has already been used.");
  }

  if (Date.parse(proposal.expiresAt) <= currentTime) {
    throw new AppError("PATCH_DENIED", "Patch proposal has expired.");
  }

  return proposal;
}

export function markPatchProposalUsed(repoRoot: string, proposalId: string): void {
  const store = readPendingPatchStore(repoRoot);
  writeStore(repoRoot, {
    proposals: store.proposals.map((proposal) => (proposal.id === proposalId ? { ...proposal, used: true } : proposal))
  });
}
