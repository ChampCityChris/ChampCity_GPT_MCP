import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, it } from "node:test";

import {
  getMcpServerStatus,
  startHttpMcpServer,
  startMcpServer,
  stopMcpServer,
  type ServerHandle
} from "../src/server/serverLifecycle.js";

let tempRoot: string;
let handles: ServerHandle[];

beforeEach(() => {
  tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "champcity-lifecycle-"));
  handles = [];
});

afterEach(async () => {
  await stopMcpServer().catch(() => {
    // Individual tests assert shutdown behavior directly.
  });
  for (const handle of handles.splice(0).reverse()) {
    try {
      await handle.stop();
    } catch {
      // The test may intentionally stop a handle first.
    }
  }
  fs.rmSync(tempRoot, { recursive: true, force: true });
});

async function startTestServer(port = 0): Promise<ServerHandle> {
  const handle = await startHttpMcpServer({
    repoRoot: tempRoot,
    host: "127.0.0.1",
    port,
    version: "0.1.0-test",
    configDir: path.join(tempRoot, "config"),
    logDir: path.join(tempRoot, "logs"),
    generatedDir: path.join(tempRoot, "generated"),
    publicBaseUrl: "https://mcp.example.com",
    allowUnauthLocalHttp: true,
    ensureRootsExist: true
  });
  handles.push(handle);
  return handle;
}

async function startOwnedTestServer(port = 0): Promise<ServerHandle> {
  return startMcpServer({
    repoRoot: tempRoot,
    host: "127.0.0.1",
    port,
    version: "0.1.0-test",
    configDir: path.join(tempRoot, "config"),
    logDir: path.join(tempRoot, "logs"),
    generatedDir: path.join(tempRoot, "generated"),
    publicBaseUrl: "https://mcp.example.com",
    allowUnauthLocalHttp: true,
    ensureRootsExist: true
  });
}

describe("MCP server lifecycle", () => {
  it("starts /health through the importable HTTP lifecycle", async () => {
    const handle = await startTestServer();

    const response = await fetch(handle.healthEndpoint);
    assert.equal(response.status, 200);
    const json = (await response.json()) as Record<string, unknown>;
    assert.equal(json.status, "ok");
    assert.equal(json.transport, "http");
    assert.equal(handle.mcpEndpoint.endsWith("/mcp"), true);
    assert.equal(handle.healthEndpoint.endsWith("/health"), true);
    assert.equal(typeof handle.startedAt, "string");
  });

  it("stops the HTTP server from the lifecycle handle", async () => {
    const handle = await startTestServer();
    await handle.stop();

    await assert.rejects(() => fetch(handle.healthEndpoint));
  });

  it("does not allow the same handle to be stopped twice", async () => {
    const handle = await startTestServer();
    await handle.stop();

    await assert.rejects(() => handle.stop(), /already stopped/i);
  });

  it("returns a controlled error when a port is already in use", async () => {
    const first = await startTestServer();

    await assert.rejects(
      () => startTestServer(first.port),
      /Port \d+ is already in use on 127\.0\.0\.1/i
    );
  });

  it("tracks the owned MCP server at module scope", async () => {
    const handle = await startOwnedTestServer();
    const status = getMcpServerStatus();

    assert.equal(status.state, "running");
    assert.equal(status.pid, process.pid);
    assert.equal(status.mcpEndpoint, handle.mcpEndpoint);
    assert.equal(status.healthEndpoint, handle.healthEndpoint);
  });

  it("skips duplicate starts for an already owned MCP server", async () => {
    const first = await startOwnedTestServer();
    const second = await startOwnedTestServer(first.port);

    assert.equal(second, first);
    assert.equal(getMcpServerStatus().state, "running");
  });

  it("stops the owned MCP server idempotently", async () => {
    const handle = await startOwnedTestServer();

    await stopMcpServer();
    await stopMcpServer();

    assert.equal(getMcpServerStatus().state, "stopped");
    await assert.rejects(() => fetch(handle.healthEndpoint));
  });
});
