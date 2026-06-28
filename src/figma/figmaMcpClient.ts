import crypto from "node:crypto";
import path from "node:path";

import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { type Resource, type ResourceContents, type ResourceTemplate, type Tool } from "@modelcontextprotocol/sdk/types.js";

import { AppError } from "../utils/errors.js";
import { type ParsedFigmaMakeUrl } from "./figmaUrl.js";
import { type FigmaMcpConfig } from "./figmaMcpConfig.js";

export interface FigmaMcpInventory {
  endpoint: string;
  mode: FigmaMcpConfig["mode"];
  serverVersion?: unknown;
  serverCapabilities?: unknown;
  resources: Resource[];
  resourceTemplates: ResourceTemplate[];
  tools: Tool[];
  prompts: Array<{ name: string; description?: string }>;
  makeResourceRetrievalAvailable: boolean;
  checkedAt: string;
}

export interface RetrievedFigmaMcpResource {
  uri: string;
  name?: string;
  mimeType?: string;
  kind: "text" | "blob";
  data: string | Buffer;
  source: "resources/read" | "tools/call";
}

export interface FigmaMcpExtractionResult {
  inventory: FigmaMcpInventory;
  resources: RetrievedFigmaMcpResource[];
  failedResources: Array<{ uri: string; error: string }>;
  warnings: string[];
  errors: string[];
}

export interface FigmaMcpConnectionTestResult {
  endpoint: string;
  mode: FigmaMcpConfig["mode"];
  connectionStatus: "reachable" | "failed";
  authStatus: "unknown" | "not-required" | "required";
  makeResourceRetrievalAvailable: boolean;
  resourcesCount: number;
  resourceTemplatesCount: number;
  toolsCount: number;
  promptsCount: number;
  warnings: string[];
  errors: string[];
}

export interface FigmaMcpClientLike {
  connect(): Promise<void>;
  close(): Promise<void>;
  getServerVersion(): unknown;
  getServerCapabilities(): unknown;
  listResources(): Promise<{ resources: Resource[] }>;
  listResourceTemplates(): Promise<{ resourceTemplates: ResourceTemplate[] }>;
  listTools(): Promise<{ tools: Tool[] }>;
  listPrompts(): Promise<{ prompts: Array<{ name: string; description?: string }> }>;
  readResource(uri: string): Promise<{ contents: ResourceContents[] }>;
  callTool(name: string, args: Record<string, unknown>): Promise<unknown>;
}

export interface FigmaMcpClientDeps {
  createClient?: (config: FigmaMcpConfig) => FigmaMcpClientLike;
}

const SECRET_PATTERNS = [
  /figd_[A-Za-z0-9_-]+/gu,
  /Bearer\s+[A-Za-z0-9._~+/=-]+/giu,
  /(authorization|access_token|refresh_token|session|cookie|figmaAccessToken)\s*[:=]\s*["']?[^"'\s,}]+/giu
];

class SdkFigmaMcpClient implements FigmaMcpClientLike {
  private readonly client = new Client({ name: "champcity-gpt-figma-mcp-client", version: "0.1.2" }, { capabilities: {} });
  private readonly transport: StreamableHTTPClientTransport;

  constructor(config: FigmaMcpConfig) {
    this.transport = new StreamableHTTPClientTransport(new URL(config.endpoint));
  }

  async connect(): Promise<void> {
    await this.client.connect(this.transport);
  }

  async close(): Promise<void> {
    await this.transport.close();
  }

  getServerVersion(): unknown {
    return this.client.getServerVersion();
  }

  getServerCapabilities(): unknown {
    return this.client.getServerCapabilities();
  }

  async listResources(): Promise<{ resources: Resource[] }> {
    return this.client.listResources();
  }

  async listResourceTemplates(): Promise<{ resourceTemplates: ResourceTemplate[] }> {
    return this.client.listResourceTemplates();
  }

  async listTools(): Promise<{ tools: Tool[] }> {
    return this.client.listTools();
  }

  async listPrompts(): Promise<{ prompts: Array<{ name: string; description?: string }> }> {
    return this.client.listPrompts();
  }

  async readResource(uri: string): Promise<{ contents: ResourceContents[] }> {
    return this.client.readResource({ uri });
  }

  async callTool(name: string, args: Record<string, unknown>): Promise<unknown> {
    return this.client.callTool({ name, arguments: args });
  }
}

function createDefaultClient(config: FigmaMcpConfig): FigmaMcpClientLike {
  return new SdkFigmaMcpClient(config);
}

export function redactSecrets(value: string): string {
  return SECRET_PATTERNS.reduce((current, pattern) => current.replace(pattern, "[REDACTED_SECRET]"), value);
}

export function redactUnknown(value: unknown): unknown {
  if (typeof value === "string") {
    return redactSecrets(value);
  }

  if (Array.isArray(value)) {
    return value.map(redactUnknown);
  }

  if (value && typeof value === "object") {
    const output: Record<string, unknown> = {};
    for (const [key, entry] of Object.entries(value)) {
      if (/authorization|token|secret|cookie|session/iu.test(key)) {
        output[key] = "[REDACTED_SECRET]";
      } else {
        output[key] = redactUnknown(entry);
      }
    }
    return output;
  }

  return value;
}

function safeError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  return redactSecrets(raw);
}

function lowerSearchText(value: { name?: string; description?: string; uri?: string; uriTemplate?: string }): string {
  return [value.name, value.description, value.uri, value.uriTemplate].filter(Boolean).join(" ").toLowerCase();
}

function textMentionsMakeProject(text: string, parsed: ParsedFigmaMakeUrl): boolean {
  const normalized = text.toLowerCase();
  const projectId = parsed.makeProjectId.toLowerCase();
  return normalized.includes("make") || (projectId.length > 0 && normalized.includes(projectId)) || normalized.includes("/make/");
}

function hasMakeSignals(inventory: Pick<FigmaMcpInventory, "resources" | "resourceTemplates" | "tools" | "prompts">): boolean {
  return (
    inventory.resources.some((entry) => lowerSearchText(entry).includes("make")) ||
    inventory.resourceTemplates.some((entry) => lowerSearchText(entry).includes("make")) ||
    inventory.tools.some((entry) => lowerSearchText(entry).includes("make")) ||
    inventory.prompts.some((entry) => lowerSearchText(entry).includes("make"))
  );
}

export function normalizeFigmaMcpInventory(options: {
  config: FigmaMcpConfig;
  parsed?: ParsedFigmaMakeUrl;
  serverVersion?: unknown;
  serverCapabilities?: unknown;
  resources?: Resource[];
  resourceTemplates?: ResourceTemplate[];
  tools?: Tool[];
  prompts?: Array<{ name: string; description?: string }>;
}): FigmaMcpInventory {
  const resources = options.resources ?? [];
  const resourceTemplates = options.resourceTemplates ?? [];
  const tools = options.tools ?? [];
  const prompts = options.prompts ?? [];
  const genericMakeAvailable = hasMakeSignals({ resources, resourceTemplates, tools, prompts });
  const projectAvailable = options.parsed
    ? resources.some((entry) => textMentionsMakeProject(lowerSearchText(entry), options.parsed!)) ||
      resourceTemplates.some((entry) => textMentionsMakeProject(lowerSearchText(entry), options.parsed!)) ||
      tools.some((entry) => textMentionsMakeProject(lowerSearchText(entry), options.parsed!))
    : false;

  return {
    endpoint: options.config.endpoint,
    mode: options.config.mode,
    serverVersion: redactUnknown(options.serverVersion),
    serverCapabilities: redactUnknown(options.serverCapabilities),
    resources: resources.map((entry) => redactUnknown(entry) as Resource),
    resourceTemplates: resourceTemplates.map((entry) => redactUnknown(entry) as ResourceTemplate),
    tools: tools.map((entry) => redactUnknown(entry) as Tool),
    prompts: prompts.map((entry) => redactUnknown(entry) as Array<{ name: string; description?: string }>[number]),
    makeResourceRetrievalAvailable: genericMakeAvailable || projectAvailable,
    checkedAt: new Date().toISOString()
  };
}

async function optionalList<T>(label: string, list: () => Promise<T>, warnings: string[]): Promise<T | undefined> {
  try {
    return await list();
  } catch (error) {
    warnings.push(`${label} unavailable from upstream Figma MCP server: ${safeError(error)}`);
    return undefined;
  }
}

async function inspectInventory(client: FigmaMcpClientLike, config: FigmaMcpConfig, parsed?: ParsedFigmaMakeUrl): Promise<{ inventory: FigmaMcpInventory; warnings: string[] }> {
  const warnings: string[] = [];
  const [resourcesResult, resourceTemplatesResult, toolsResult, promptsResult] = await Promise.all([
    optionalList("resources/list", () => client.listResources(), warnings),
    optionalList("resources/templates/list", () => client.listResourceTemplates(), warnings),
    optionalList("tools/list", () => client.listTools(), warnings),
    optionalList("prompts/list", () => client.listPrompts(), warnings)
  ]);

  return {
    inventory: normalizeFigmaMcpInventory({
      config,
      parsed,
      serverVersion: client.getServerVersion(),
      serverCapabilities: client.getServerCapabilities(),
      resources: resourcesResult?.resources ?? [],
      resourceTemplates: resourceTemplatesResult?.resourceTemplates ?? [],
      tools: toolsResult?.tools ?? [],
      prompts: promptsResult?.prompts ?? []
    }),
    warnings
  };
}

function selectMakeResources(resources: Resource[], parsed: ParsedFigmaMakeUrl): Resource[] {
  return resources.filter((entry) => textMentionsMakeProject(lowerSearchText(entry), parsed));
}

function schemaProperties(tool: Tool): Record<string, unknown> {
  const properties = tool.inputSchema.properties;
  return properties && typeof properties === "object" && !Array.isArray(properties) ? properties as Record<string, unknown> : {};
}

function makeToolArguments(tool: Tool, parsed: ParsedFigmaMakeUrl): Record<string, unknown> | null {
  const properties = schemaProperties(tool);
  const args: Record<string, unknown> = {};
  for (const key of Object.keys(properties)) {
    if (/^(makeUrl|figmaMakeUrl|projectUrl|url|figmaUrl)$/iu.test(key)) {
      args[key] = parsed.makeUrl;
    } else if (/^(makeProjectId|projectId|id)$/iu.test(key)) {
      args[key] = parsed.makeProjectId;
    }
  }

  const required = Array.isArray(tool.inputSchema.required) ? tool.inputSchema.required : [];
  if (required.some((key) => !(key in args))) {
    return null;
  }

  return args;
}

function findMakeResourceTools(tools: Tool[], parsed: ParsedFigmaMakeUrl): Array<{ tool: Tool; args: Record<string, unknown> }> {
  return tools
    .filter((tool) => textMentionsMakeProject(lowerSearchText(tool), parsed))
    .map((tool) => ({ tool, args: makeToolArguments(tool, parsed) }))
    .filter((entry): entry is { tool: Tool; args: Record<string, unknown> } => entry.args !== null);
}

function extractResourceContentsFromToolResult(result: unknown): RetrievedFigmaMcpResource[] {
  const output: RetrievedFigmaMcpResource[] = [];
  const queue: unknown[] = [result];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    if (record.type === "resource" && record.resource && typeof record.resource === "object") {
      const resource = record.resource as Record<string, unknown>;
      const uri = typeof resource.uri === "string" ? resource.uri : `tool-resource:${crypto.randomUUID()}`;
      const mimeType = typeof resource.mimeType === "string" ? resource.mimeType : undefined;
      if (typeof resource.text === "string") {
        output.push({ uri, mimeType, kind: "text", data: redactSecrets(resource.text), source: "tools/call" });
      } else if (typeof resource.blob === "string") {
        output.push({ uri, mimeType, kind: "blob", data: Buffer.from(resource.blob, "base64"), source: "tools/call" });
      }
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        queue.push(...value);
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return output;
}

function extractResourceLinksFromToolResult(result: unknown): string[] {
  const output: string[] = [];
  const queue: unknown[] = [result];
  while (queue.length > 0) {
    const current = queue.shift();
    if (!current || typeof current !== "object") {
      continue;
    }

    const record = current as Record<string, unknown>;
    if (record.type === "resource_link" && typeof record.uri === "string") {
      output.push(record.uri);
    }

    for (const value of Object.values(record)) {
      if (Array.isArray(value)) {
        queue.push(...value);
      } else if (value && typeof value === "object") {
        queue.push(value);
      }
    }
  }

  return [...new Set(output)];
}

async function readMcpResource(client: FigmaMcpClientLike, resource: { uri: string; name?: string; mimeType?: string }): Promise<RetrievedFigmaMcpResource[]> {
  const result = await client.readResource(resource.uri);
  return result.contents.map((content, index) => {
    const uri = content.uri || resource.uri;
    const name = result.contents.length > 1 ? `${resource.name ?? "resource"}-${index + 1}` : resource.name;
    const mimeType = content.mimeType ?? resource.mimeType;
    if ("text" in content && typeof content.text === "string") {
      return {
        uri,
        name,
        mimeType,
        kind: "text",
        data: redactSecrets(content.text),
        source: "resources/read"
      };
    }

    const blob = "blob" in content && typeof content.blob === "string" ? content.blob : "";
    return {
      uri,
      name,
      mimeType,
      kind: "blob",
      data: Buffer.from(blob, "base64"),
      source: "resources/read"
    };
  });
}

export async function testFigmaMcpConnection(config: FigmaMcpConfig, deps: FigmaMcpClientDeps = {}): Promise<FigmaMcpConnectionTestResult> {
  const client = (deps.createClient ?? createDefaultClient)(config);
  try {
    await client.connect();
    const { inventory, warnings } = await inspectInventory(client, config);
    return {
      endpoint: config.endpoint,
      mode: config.mode,
      connectionStatus: "reachable",
      authStatus: "not-required",
      makeResourceRetrievalAvailable: inventory.makeResourceRetrievalAvailable,
      resourcesCount: inventory.resources.length,
      resourceTemplatesCount: inventory.resourceTemplates.length,
      toolsCount: inventory.tools.length,
      promptsCount: inventory.prompts.length,
      warnings,
      errors: []
    };
  } catch (error) {
    const message = safeError(error);
    return {
      endpoint: config.endpoint,
      mode: config.mode,
      connectionStatus: "failed",
      authStatus: /unauthorized|401|auth|forbidden|403/iu.test(message) ? "required" : "unknown",
      makeResourceRetrievalAvailable: false,
      resourcesCount: 0,
      resourceTemplatesCount: 0,
      toolsCount: 0,
      promptsCount: 0,
      warnings: [],
      errors: [message]
    };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export async function retrieveFigmaMakeResources(
  config: FigmaMcpConfig,
  parsed: ParsedFigmaMakeUrl,
  deps: FigmaMcpClientDeps = {}
): Promise<FigmaMcpExtractionResult> {
  const client = (deps.createClient ?? createDefaultClient)(config);
  const warnings: string[] = [];
  const errors: string[] = [];
  const resources: RetrievedFigmaMcpResource[] = [];
  const failedResources: Array<{ uri: string; error: string }> = [];

  try {
    await client.connect();
  } catch (error) {
    return {
      inventory: normalizeFigmaMcpInventory({ config, parsed }),
      resources: [],
      failedResources: [],
      warnings,
      errors: [
        `Could not connect to upstream Figma MCP server at ${config.endpoint}. Configure Figma MCP (${config.mode}) and authenticate it before rerunning. ${safeError(error)}`
      ]
    };
  }

  try {
    const inspected = await inspectInventory(client, config, parsed);
    warnings.push(...inspected.warnings);
    const inventory = inspected.inventory;
    const selectedResources = selectMakeResources(inventory.resources, parsed);

    for (const resource of selectedResources) {
      try {
        resources.push(...await readMcpResource(client, resource));
      } catch (error) {
        failedResources.push({ uri: resource.uri, error: safeError(error) });
      }
    }

    for (const { tool, args } of findMakeResourceTools(inventory.tools, parsed)) {
      try {
        const result = await client.callTool(tool.name, args);
        resources.push(...extractResourceContentsFromToolResult(result));
        for (const uri of extractResourceLinksFromToolResult(result)) {
          try {
            resources.push(...await readMcpResource(client, { uri }));
          } catch (error) {
            failedResources.push({ uri, error: safeError(error) });
          }
        }
      } catch (error) {
        warnings.push(`Figma MCP Make tool "${tool.name}" could not retrieve resources: ${safeError(error)}`);
      }
    }

    if (resources.length === 0) {
      errors.push(
        "No Make resources/files were retrieved through the official Figma MCP resource path. The upstream server may need authentication, Make support, an opened/selected Make project, or a newer Figma MCP version."
      );
    }

    return { inventory, resources, failedResources, warnings, errors };
  } finally {
    await client.close().catch(() => undefined);
  }
}

export function safeResourceFileName(resource: RetrievedFigmaMcpResource, index: number): string {
  const candidate = resource.name || (() => {
    try {
      const parsed = new URL(resource.uri);
      return parsed.pathname.split("/").filter(Boolean).join("/");
    } catch {
      return resource.uri.replace(/^[a-z]+:/iu, "");
    }
  })();
  const normalized = candidate
    .replace(/\\/gu, "/")
    .split("/")
    .filter(Boolean)
    .map((segment) => segment.replace(/[^A-Za-z0-9._-]+/gu, "-").replace(/^-+|-+$/gu, ""))
    .filter(Boolean)
    .join("/");
  const extension = path.extname(normalized);
  if (extension) {
    return normalized;
  }

  const fallbackExtension = resource.kind === "text" ? ".txt" : ".bin";
  return `${normalized || `resource-${index + 1}`}${fallbackExtension}`;
}
