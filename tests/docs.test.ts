import fs from "node:fs";
import path from "node:path";
import assert from "node:assert/strict";
import { describe, it } from "node:test";

import { createChatGptSetupNotes } from "../electron/launcherCore.js";

const repoRoot = process.cwd();
const publicEndpoint = "https://mcp.example.com/mcp";

function read(relativePath: string): string {
  return fs.readFileSync(path.join(repoRoot, relativePath), "utf8");
}

describe("ChatGPT HTTP endpoint docs", () => {
  it("documents the example.com HTTPS MCP endpoint", () => {
    assert.match(read("README.md"), new RegExp(publicEndpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(read("docs/CHATGPT_CONNECTION_GUIDE.md"), new RegExp(publicEndpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
    assert.match(read("docs/CHAMPCITY_NET_ENDPOINT.md"), new RegExp(publicEndpoint.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")));
  });

  it("documents OAuth as the ChatGPT authentication path", () => {
    const readme = read("README.md");
    const guide = read("docs/CHATGPT_CONNECTION_GUIDE.md");
    const endpoint = read("docs/CHAMPCITY_NET_ENDPOINT.md");
    const security = read("docs/SECURITY_MODEL.md");

    for (const content of [readme, guide, endpoint, security]) {
      assert.match(content, /OAuth/i);
      assert.match(content, /\/\.well-known\/oauth-authorization-server/i);
      assert.match(content, /\/\.well-known\/oauth-protected-resource/i);
      assert.match(content, /\/oauth\/register/i);
      assert.match(content, /\/oauth\/authorize/i);
      assert.match(content, /\/oauth\/token/i);
      assert.match(content, /files\.read/i);
      assert.match(content, /files\.write/i);
    }
  });

  it("does not claim local STDIO directly connects to ChatGPT.com", () => {
    const guide = read("docs/CHATGPT_CONNECTION_GUIDE.md");
    assert.match(guide, /A local STDIO MCP server is not directly usable by ChatGPT\.com/i);
    assert.doesNotMatch(guide, /local STDIO MCP server is directly usable by ChatGPT\.com/i);
    assert.doesNotMatch(guide, /^Register the local STDIO command as the ChatGPT\.com connection path/im);
  });

  it("documents the Cloudflare Tunnel setup and unauthenticated tunnel warning", () => {
    const cloudflareGuide = read("docs/CLOUDFLARE_TUNNEL_SETUP.md");
    const chatGptGuide = read("docs/CHATGPT_CONNECTION_GUIDE.md");
    const securityModel = read("docs/SECURITY_MODEL.md");

    assert.match(cloudflareGuide, /Cloudflare Tunnel/i);
    assert.match(cloudflareGuide, /http:\/\/127\.0\.0\.1:3333\/mcp/i);
    assert.match(cloudflareGuide, /Do not tunnel unauthenticated local mode/i);
    assert.match(chatGptGuide, /Do not tunnel unauthenticated local mode/i);
    assert.match(securityModel, /Do not tunnel unauthenticated local mode/i);
  });

  it("keeps the Cloudflare config template free of committed secrets", () => {
    const template = read("examples/cloudflared-config.example.yml");

    assert.match(template, /hostname:\s*mcp\.example\.com/i);
    assert.match(template, /service:\s*http:\/\/127\.0\.0\.1:3333/i);
    assert.match(template, /service:\s*http_status:404/i);
    assert.doesNotMatch(template, /credentials-file\s*:/i);
    assert.doesNotMatch(template, /account[_-]?id\s*:/i);
    assert.doesNotMatch(template, /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it("does not write raw HTTP auth tokens into generated ChatGPT notes", () => {
    const sensitiveFixture = ["SENSITIVE", "TEST", "VALUE", "DO", "NOT", "EMIT"].join("_");
    const notes = createChatGptSetupNotes(repoRoot, {
      CHAMPCITY_GPT_HTTP_AUTH_TOKEN: sensitiveFixture,
      CHAMPCITY_GPT_ENABLE_WRITE_TOOLS: "false"
    });

    assert.match(notes, /Legacy\/manual bearer auth configured: yes/i);
    assert.match(notes, /Bearer token value: not displayed or written/i);
    assert.doesNotMatch(notes, new RegExp(sensitiveFixture));
  });

  it("keeps generated ChatGPT notes free of local paths and OAuth store locations", () => {
    const notes = createChatGptSetupNotes(repoRoot, {
      CHAMPCITY_GPT_ENABLE_WRITE_TOOLS: "false"
    });
    const escapedRepoRoot = repoRoot.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

    assert.match(notes, /OAuth store paths: not included/i);
    assert.match(notes, /Allowed root count:/i);
    assert.match(notes, /Local allowed-root paths are not included/i);
    assert.doesNotMatch(notes, new RegExp(escapedRepoRoot, "u"));
    assert.doesNotMatch(notes, /[A-Z]:\\Users\\/iu);
    assert.doesNotMatch(notes, /oauth-(?:admin|clients|tokens)\.local\.json/iu);
    assert.doesNotMatch(notes, /config\\oauth/iu);
  });

  it("does not write raw write approval tokens into generated ChatGPT notes", () => {
    const sensitiveFixture = ["SENSITIVE", "WRITE", "VALUE", "DO", "NOT", "EMIT"].join("_");
    const notes = createChatGptSetupNotes(repoRoot, {
      CHAMPCITY_GPT_WRITE_APPROVAL_TOKEN: sensitiveFixture,
      CHAMPCITY_GPT_ENABLE_WRITE_TOOLS: "true"
    });

    assert.match(notes, /Elevated approval token configured: yes/i);
    assert.match(notes, /Elevated approval token value: not displayed or written/i);
    assert.match(notes, /Elevated approval is still required for scripts/i);
    assert.doesNotMatch(notes, new RegExp(sensitiveFixture));
  });

  it("does not tell ChatGPT that approvalToken is required for all writes", () => {
    const notes = createChatGptSetupNotes(repoRoot, {
      CHAMPCITY_GPT_ENABLE_WRITE_TOOLS: "true"
    });
    const docs = [
      notes,
      read("README.md"),
      read("docs/TOOL_REFERENCE.md"),
      read("docs/SECURITY_MODEL.md"),
      read("docs/CHATGPT_CONNECTION_GUIDE.md"),
      read("docs/DESKTOP_APP_SETUP.md")
    ];

    for (const content of docs) {
      assert.doesNotMatch(content, /approvalToken (?:is )?required for all writes/i);
      assert.doesNotMatch(content, /every write requires (?:a )?(?:local )?approval token/i);
      assert.doesNotMatch(content, /approval token required for every write/i);
    }

    assert.match(notes, /Markdown artifact writes do not require approvalToken/i);
  });

  it("ignores local OAuth secret files", () => {
    const ignore = read(".gitignore");

    assert.match(ignore, /config\/oauth-admin\.local\.json/u);
    assert.match(ignore, /config\/oauth-clients\.local\.json/u);
    assert.match(ignore, /config\/oauth-tokens\.local\.json/u);
    assert.match(ignore, /config\/write-access\.local\.json/u);
  });

  it("keeps the public endpoint verifier from printing the token variable", () => {
    const verifier = read("scripts/verify-public-endpoint.ps1");

    assert.match(verifier, /\[string\]\$Token/);
    assert.doesNotMatch(verifier, /Write-(Host|Output|Information|Warning|Error)\s+.*\$Token/i);
    assert.doesNotMatch(verifier, /Write-Check\s+.*\$Token/i);
  });

  it("excludes local runtime artifacts from packaged app config", () => {
    const builder = read("electron-builder.json");

    assert.ok(builder.includes("!config/*.local.json"));
    assert.ok(builder.includes("!logs/**/*"));
    assert.ok(builder.includes("!generated/**/*"));
    assert.ok(builder.includes("!dist/tests/**/*"));
    assert.ok(builder.includes("!package-lock.zip"));
  });
});

