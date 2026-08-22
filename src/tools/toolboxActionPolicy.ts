export interface ToolboxActionPolicy {
  requiredScope: "files.read" | "files.write";
  mappedInternalOperation?: string;
}

export interface ToolboxActionParameterContract {
  name: string;
  type: "string" | "number" | "boolean" | "array" | "object";
  required: boolean;
  limit?: number | string;
}

export interface ToolboxActionContract {
  toolboxName: ToolboxName;
  actionName: string;
  requiredOAuthScope: "files.read" | "files.write";
  classification: "read" | "write";
  acceptedParameters: ToolboxActionParameterContract[];
  requiredParameters: string[];
  responseSerializerMode: string;
  mayReturnContent: boolean;
  continuationSupported: boolean;
  deprecated: boolean;
  replacementAction: string | null;
}

export const TOOLBOX_ACTION_POLICY = {
  repo_toolbox: {
    status: { requiredScope: "files.read" },
    list_files: { requiredScope: "files.read" },
    read_file: { requiredScope: "files.read" },
    inspect_text_file: { requiredScope: "files.read" },
    read_text_chunk: { requiredScope: "files.read" },
    read_text_lines: { requiredScope: "files.read" },
    read_markdown_section: { requiredScope: "files.read" },
    search_files: { requiredScope: "files.read" },
    write_markdown_artifact: { requiredScope: "files.write", mappedInternalOperation: "write_markdown_artifact" },
    write_json_artifact: { requiredScope: "files.write", mappedInternalOperation: "write_json_artifact" },
    propose_patch: { requiredScope: "files.write", mappedInternalOperation: "propose_patch" },
    apply_approved_patch: { requiredScope: "files.write", mappedInternalOperation: "apply_approved_patch" }
  },
  git_toolbox: {
    status: { requiredScope: "files.read" },
    diff: { requiredScope: "files.read" },
    pre_commit_scan: { requiredScope: "files.read" },
    readiness_summary: { requiredScope: "files.read" },
    inspect_history: { requiredScope: "files.read" },
    prepare_work_branch: { requiredScope: "files.write", mappedInternalOperation: "prepare_git_work_branch" },
    stage_paths: { requiredScope: "files.write", mappedInternalOperation: "safe_stage_changes" },
    commit_staged: { requiredScope: "files.write", mappedInternalOperation: "commit_validated_changes" },
    push_current_branch: { requiredScope: "files.write", mappedInternalOperation: "push_current_branch" },
    integrate_to_dev: { requiredScope: "files.write", mappedInternalOperation: "integrate_to_dev" }
  },
  artifact_toolbox: {
    builder_report_index: { requiredScope: "files.read" },
    builder_report_summary: { requiredScope: "files.read" },
    release_artifact_summary: { requiredScope: "files.read" },
    release_publication_summary: { requiredScope: "files.read" },
    local_package_summary: { requiredScope: "files.read" },
    create_markdown_artifact: { requiredScope: "files.write", mappedInternalOperation: "write_markdown_artifact" },
    read_image_artifact: { requiredScope: "files.read" },
    list_artifacts: { requiredScope: "files.read" },
    read_artifact_by_id: { requiredScope: "files.read" },
    inspect_artifact_text: { requiredScope: "files.read" },
    read_artifact_text_chunk: { requiredScope: "files.read" },
    latest_artifact: { requiredScope: "files.read" },
    artifact_pair_status: { requiredScope: "files.read" },
    current_action_context: { requiredScope: "files.read" },
    export_planning_corpus: { requiredScope: "files.read" },
    review_queue: { requiredScope: "files.read" }
  },
  diagnostics_toolbox: {
    runtime_status: { requiredScope: "files.read" },
    write_access_status: { requiredScope: "files.read" },
    tool_exposure_status: { requiredScope: "files.read" },
    oauth_scope_status: { requiredScope: "files.read" },
    chatgpt_discovery_status: { requiredScope: "files.read" },
    recent_tool_calls: { requiredScope: "files.read" },
    acknowledge_tool_result: { requiredScope: "files.read" },
    result_delivery_status: { requiredScope: "files.read" },
    list_workspaces: { requiredScope: "files.read" },
    workspace_safety_status: { requiredScope: "files.read" },
    public_safety_status: { requiredScope: "files.read" },
    project_validation: { requiredScope: "files.read" },
    mcp_server_startup: { requiredScope: "files.read" },
    mcp_tool_registration: { requiredScope: "files.read" },
    mcp_tool_inventory: { requiredScope: "files.read" },
    describe_toolbox_action: { requiredScope: "files.read" },
    electron_development_startup: { requiredScope: "files.read" },
    electron_packaged_startup: { requiredScope: "files.read" }
  },
  integration_toolbox: {
    list_supported_services: { requiredScope: "files.read" },
    get_service_status: { requiredScope: "files.read" },
    list_service_capabilities: { requiredScope: "files.read" },
    validate_service_configuration: { requiredScope: "files.read" },
    prepare_external_handoff: { requiredScope: "files.write", mappedInternalOperation: "write_markdown_artifact" }
  },
  browser_toolbox: {
    get_browser_capabilities: { requiredScope: "files.read" },
    validate_public_endpoint: { requiredScope: "files.read" }
  },
  knowledge_toolbox: {
    list_supported_sources: { requiredScope: "files.read" },
    get_project_memory_status: { requiredScope: "files.read" },
    get_reference_capabilities: { requiredScope: "files.read" },
    source_analysis: { requiredScope: "files.read" }
  }
} as const satisfies Record<string, Record<string, ToolboxActionPolicy>>;

export const TOOLBOX_TOOL_NAMES = [
  "repo_toolbox",
  "git_toolbox",
  "artifact_toolbox",
  "diagnostics_toolbox",
  "integration_toolbox",
  "browser_toolbox",
  "knowledge_toolbox"
] as const satisfies readonly (keyof typeof TOOLBOX_ACTION_POLICY)[];

export type ToolboxName = (typeof TOOLBOX_TOOL_NAMES)[number];
export type ToolboxActionName<T extends ToolboxName = ToolboxName> = keyof (typeof TOOLBOX_ACTION_POLICY)[T] & string;

export const SUPPORTED_TOOLBOX_ACTIONS = Object.fromEntries(
  TOOLBOX_TOOL_NAMES.map((toolbox) => [toolbox, Object.keys(TOOLBOX_ACTION_POLICY[toolbox])])
) as unknown as {
  readonly [K in ToolboxName]: readonly ToolboxActionName<K>[];
};

export const SUPPORTED_REPO_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.repo_toolbox;
export const SUPPORTED_GIT_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.git_toolbox;
export const SUPPORTED_ARTIFACT_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.artifact_toolbox;
export const SUPPORTED_DIAGNOSTICS_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.diagnostics_toolbox;
export const SUPPORTED_INTEGRATION_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.integration_toolbox;
export const SUPPORTED_BROWSER_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.browser_toolbox;
export const SUPPORTED_KNOWLEDGE_ACTIONS = SUPPORTED_TOOLBOX_ACTIONS.knowledge_toolbox;

const TOOLBOX_NAME_SET = new Set<string>(TOOLBOX_TOOL_NAMES);

export function isToolboxName(value: string): value is ToolboxName {
  return TOOLBOX_NAME_SET.has(value);
}

export function getToolboxActionPolicy(toolbox: string, action: string): ToolboxActionPolicy | undefined {
  if (!isToolboxName(toolbox)) {
    return undefined;
  }

  return (TOOLBOX_ACTION_POLICY[toolbox] as Record<string, ToolboxActionPolicy>)[action];
}

export function requiredScopeForPublicToolCall(publicToolName: string, action?: string): "files.read" | "files.write" | undefined {
  if (!isToolboxName(publicToolName)) {
    return undefined;
  }

  return action ? getToolboxActionPolicy(publicToolName, action)?.requiredScope : "files.read";
}

export function mappedInternalOperationForToolboxAction(toolbox: string, action: string): string | undefined {
  return getToolboxActionPolicy(toolbox, action)?.mappedInternalOperation;
}

const BOUNDED_TEXT_LIMITS = {
  maximumBytes: "<=16384",
  maximumLines: "<=1000",
  maximumHeadings: "<=1000",
  cursor: "<=4096 chars",
  relativePath: "<= repository relative path limit"
} as const;

const PARAMS: Record<string, ToolboxActionParameterContract[]> = {
  "repo_toolbox.inspect_text_file": [
    { name: "relativePath", type: "string", required: true, limit: BOUNDED_TEXT_LIMITS.relativePath },
    { name: "includeHeadingIndex", type: "boolean", required: false },
    { name: "maximumHeadings", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumHeadings }
  ],
  "repo_toolbox.read_text_chunk": [
    { name: "relativePath", type: "string", required: false, limit: BOUNDED_TEXT_LIMITS.relativePath },
    { name: "cursor", type: "string", required: false, limit: BOUNDED_TEXT_LIMITS.cursor },
    { name: "maximumBytes", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumBytes },
    { name: "maximumLines", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumLines },
    { name: "expectedSourceSha256", type: "string", required: false, limit: "64 hex chars" },
    { name: "priorResultAttemptId", type: "string", required: false, limit: "<=128 chars" },
    { name: "maxBytes", type: "number", required: false, limit: "<=500000 source-read gate" }
  ],
  "repo_toolbox.read_text_lines": [
    { name: "relativePath", type: "string", required: true, limit: BOUNDED_TEXT_LIMITS.relativePath },
    { name: "startLine", type: "number", required: true, limit: ">=1" },
    { name: "maximumLines", type: "number", required: true, limit: BOUNDED_TEXT_LIMITS.maximumLines },
    { name: "maximumBytes", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumBytes },
    { name: "expectedSourceSha256", type: "string", required: false, limit: "64 hex chars" },
    { name: "priorResultAttemptId", type: "string", required: false, limit: "<=128 chars" },
    { name: "maxBytes", type: "number", required: false, limit: "<=500000 source-read gate" }
  ],
  "repo_toolbox.read_markdown_section": [
    { name: "relativePath", type: "string", required: true, limit: BOUNDED_TEXT_LIMITS.relativePath },
    { name: "sectionId", type: "string", required: false, limit: "<=160 chars from inspect_text_file" },
    { name: "cursor", type: "string", required: false, limit: BOUNDED_TEXT_LIMITS.cursor },
    { name: "maximumBytes", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumBytes },
    { name: "maximumLines", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumLines },
    { name: "expectedSourceSha256", type: "string", required: false, limit: "64 hex chars" },
    { name: "priorResultAttemptId", type: "string", required: false, limit: "<=128 chars" },
    { name: "maxBytes", type: "number", required: false, limit: "<=500000 source-read gate" }
  ],
  "artifact_toolbox.inspect_artifact_text": [
    { name: "artifactId", type: "string", required: true, limit: "<=128 chars" },
    { name: "includeHeadingIndex", type: "boolean", required: false },
    { name: "maximumHeadings", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumHeadings }
  ],
  "artifact_toolbox.read_artifact_text_chunk": [
    { name: "artifactId", type: "string", required: false, limit: "<=128 chars" },
    { name: "cursor", type: "string", required: false, limit: BOUNDED_TEXT_LIMITS.cursor },
    { name: "maximumBytes", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumBytes },
    { name: "maximumLines", type: "number", required: false, limit: BOUNDED_TEXT_LIMITS.maximumLines },
    { name: "expectedSourceSha256", type: "string", required: false, limit: "64 hex chars" },
    { name: "priorResultAttemptId", type: "string", required: false, limit: "<=128 chars" }
  ]
};

function serializerMode(toolboxName: ToolboxName, actionName: string): string {
  if (actionName === "read_markdown_section") {
    return "bounded-markdown-section-v1";
  }
  if (actionName === "read_text_chunk" || actionName === "read_text_lines" || actionName === "read_artifact_text_chunk") {
    return "bounded-text-v1";
  }
  if (actionName === "read_file" || actionName === "read_artifact_by_id" || actionName === "latest_artifact") {
    return "bounded-text-v1 when substantive text exceeds inline threshold; otherwise champcity-tool-response";
  }
  if (toolboxName === "artifact_toolbox" && actionName === "read_image_artifact") {
    return "mcp-image-content";
  }
  return "champcity-tool-response";
}

function mayReturnContent(actionName: string): boolean {
  return [
    "read_file",
    "read_text_chunk",
    "read_text_lines",
    "read_markdown_section",
    "read_artifact_by_id",
    "read_artifact_text_chunk",
    "latest_artifact",
    "read_image_artifact"
  ].includes(actionName);
}

function continuationSupported(actionName: string): boolean {
  return [
    "read_file",
    "read_text_chunk",
    "read_text_lines",
    "read_markdown_section",
    "read_artifact_by_id",
    "read_artifact_text_chunk",
    "latest_artifact",
    "export_planning_corpus"
  ].includes(actionName);
}

export function getToolboxActionContract(toolboxName: ToolboxName, actionName: string): ToolboxActionContract | undefined {
  const policy = getToolboxActionPolicy(toolboxName, actionName);
  if (!policy) {
    return undefined;
  }
  const acceptedParameters = PARAMS[`${toolboxName}.${actionName}`] ?? [];
  return {
    toolboxName,
    actionName,
    requiredOAuthScope: policy.requiredScope,
    classification: policy.requiredScope === "files.write" ? "write" : "read",
    acceptedParameters,
    requiredParameters: acceptedParameters.filter((param) => param.required).map((param) => param.name),
    responseSerializerMode: serializerMode(toolboxName, actionName),
    mayReturnContent: mayReturnContent(actionName),
    continuationSupported: continuationSupported(actionName),
    deprecated: toolboxName === "diagnostics_toolbox" && actionName === "public_safety_status",
    replacementAction: toolboxName === "diagnostics_toolbox" && actionName === "public_safety_status" ? "workspace_safety_status" : null
  };
}

export function listToolboxActionContracts(): ToolboxActionContract[] {
  return TOOLBOX_TOOL_NAMES.flatMap((toolboxName) =>
    Object.keys(TOOLBOX_ACTION_POLICY[toolboxName]).map((actionName) => getToolboxActionContract(toolboxName, actionName)).filter((contract): contract is ToolboxActionContract => Boolean(contract))
  );
}

export const UNSUPPORTED_ACTION_ALTERNATIVES: Record<string, string[]> = {
  "artifact_toolbox.read_markdown_artifact": [
    "repo_toolbox.inspect_text_file plus repo_toolbox.read_text_chunk",
    "artifact_toolbox.list_artifacts plus artifact_toolbox.inspect_artifact_text/read_artifact_text_chunk"
  ]
};
