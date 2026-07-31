export interface ToolboxActionPolicy {
  requiredScope: "files.read" | "files.write";
  mappedInternalOperation?: string;
}

export const TOOLBOX_ACTION_POLICY = {
  repo_toolbox: {
    status: { requiredScope: "files.read" },
    list_files: { requiredScope: "files.read" },
    read_file: { requiredScope: "files.read" },
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
    list_workspaces: { requiredScope: "files.read" },
    public_safety_status: { requiredScope: "files.read" },
    project_validation: { requiredScope: "files.read" },
    mcp_server_startup: { requiredScope: "files.read" },
    mcp_tool_registration: { requiredScope: "files.read" },
    mcp_tool_inventory: { requiredScope: "files.read" },
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
