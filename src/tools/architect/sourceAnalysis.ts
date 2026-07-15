import fs from "node:fs";
import path from "node:path";

import ts from "typescript";

import { AppError } from "../../utils/errors.js";
import {
  assertVerifiedRepositoryRoot,
  completedResult,
  type ArchitectToolResult
} from "./common.js";

export type SourceAnalysisInput =
  | { operation: "find_symbol"; symbol: string }
  | { operation: "find_references"; symbol: string }
  | { operation: "import_graph"; file: string; maxDepth: number }
  | { operation: "get_callers"; symbol: string }
  | { operation: "get_callees"; symbol: string }
  | { operation: "mcp_registrations" }
  | { operation: "duplicate_mcp_tool_names" };

interface SourceLocation {
  file: string;
  line: number;
  column: number;
}

const MAX_FILES = 800;
const MAX_MATCHES = 250;
const MAX_GRAPH_NODES = 250;
const MAX_GRAPH_EDGES = 600;
const MAX_ANALYSIS_MS = 15_000;
const SOURCE_EXTENSIONS = new Set([".ts", ".tsx", ".js", ".jsx", ".mts", ".cts", ".mjs", ".cjs"]);

function normalizeRelative(root: string, fileName: string): string {
  return path.relative(root, fileName).replaceAll("\\", "/");
}

function assertSourcePath(root: string, relativePath: string): string {
  if (!relativePath || path.isAbsolute(relativePath) || relativePath.includes("\0")) {
    throw new AppError("PATH_DENIED", "Source-analysis paths must be repository-relative.");
  }
  const normalized = relativePath.replaceAll("\\", "/");
  if (normalized.split("/").some((segment) => segment === ".." || segment === "." || !segment)) {
    throw new AppError("PATH_DENIED", "Source-analysis paths must not contain traversal or empty segments.");
  }
  if (!SOURCE_EXTENSIONS.has(path.extname(normalized).toLowerCase())) {
    throw new AppError("PATH_DENIED", "Source analysis supports TypeScript and JavaScript source files only.");
  }
  const absolute = path.resolve(root, ...normalized.split("/"));
  const relative = path.relative(root, absolute);
  if (relative.startsWith("..") || path.isAbsolute(relative)) {
    throw new AppError("PATH_DENIED", "Source-analysis path escapes the repository.");
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) {
    throw new AppError("PATH_DENIED", "Source-analysis file does not exist.");
  }
  return absolute;
}

function location(root: string, sourceFile: ts.SourceFile, node: ts.Node): SourceLocation {
  const position = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
  return {
    file: normalizeRelative(root, sourceFile.fileName),
    line: position.line + 1,
    column: position.character + 1
  };
}

function containingDeclaration(node: ts.Node): string {
  let current: ts.Node | undefined = node.parent;
  while (current) {
    if (
      ts.isFunctionDeclaration(current) ||
      ts.isMethodDeclaration(current) ||
      ts.isClassDeclaration(current) ||
      ts.isInterfaceDeclaration(current) ||
      ts.isTypeAliasDeclaration(current) ||
      ts.isVariableDeclaration(current)
    ) {
      const named = current as ts.NamedDeclaration;
      return named.name && ts.isIdentifier(named.name) ? named.name.text : ts.SyntaxKind[current.kind];
    }
    current = current.parent;
  }
  return "source_file";
}

function isDefinitionIdentifier(node: ts.Identifier): boolean {
  const parent = node.parent;
  if (!parent) {
    return false;
  }
  if ("name" in parent && (parent as ts.NamedDeclaration).name === node) {
    return true;
  }
  return ts.isImportSpecifier(parent) || ts.isImportClause(parent) || ts.isNamespaceImport(parent) || ts.isBindingElement(parent);
}

function exported(node: ts.Node): boolean {
  let current: ts.Node | undefined = node;
  while (current && !ts.isSourceFile(current)) {
    if (ts.canHaveModifiers(current) && ts.getModifiers(current)?.some((modifier) => modifier.kind === ts.SyntaxKind.ExportKeyword)) {
      return true;
    }
    current = current.parent;
  }
  return false;
}

function loadProgram(root: string): { program: ts.Program; configPath: string; files: ts.SourceFile[]; warnings: string[] } {
  const configPath = path.join(root, "tsconfig.json");
  if (!fs.existsSync(configPath)) {
    throw new AppError("INVALID_INPUT", "TypeScript source analysis requires a repository tsconfig.json.", { sourceUnavailable: true });
  }
  const config = ts.readConfigFile(configPath, ts.sys.readFile);
  if (config.error) {
    throw new AppError("INVALID_INPUT", ts.flattenDiagnosticMessageText(config.error.messageText, " "));
  }
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, root, undefined, configPath);
  const warnings = parsed.errors.map((diagnostic) => ts.flattenDiagnosticMessageText(diagnostic.messageText, " "));
  const program = ts.createProgram({ rootNames: parsed.fileNames.slice(0, MAX_FILES), options: parsed.options });
  const files = parsed.fileNames
    .slice(0, MAX_FILES)
    .map((fileName) => path.resolve(fileName))
    .filter((fileName) => {
      const relative = path.relative(root, fileName);
      return !fileName.endsWith(".d.ts") && !fileName.includes(`${path.sep}node_modules${path.sep}`) && !relative.startsWith("..") && !path.isAbsolute(relative);
    })
    .map((fileName) =>
      ts.createSourceFile(
        fileName,
        fs.readFileSync(fileName, "utf8"),
        parsed.options.target ?? ts.ScriptTarget.ES2022,
        true,
        fileName.endsWith(".tsx") ? ts.ScriptKind.TSX : fileName.endsWith(".jsx") ? ts.ScriptKind.JSX : fileName.endsWith(".js") ? ts.ScriptKind.JS : ts.ScriptKind.TS
      )
    );
  return { program, configPath: normalizeRelative(root, configPath), files, warnings };
}

function visitFiles(files: readonly ts.SourceFile[], visitor: (node: ts.Node, sourceFile: ts.SourceFile) => void, deadline: number): boolean {
  let timedOut = false;
  const visit = (node: ts.Node, sourceFile: ts.SourceFile) => {
    if (Date.now() > deadline) {
      timedOut = true;
      return;
    }
    visitor(node, sourceFile);
    if (!timedOut) {
      ts.forEachChild(node, (child) => visit(child, sourceFile));
    }
  };
  for (const sourceFile of files) {
    visit(sourceFile, sourceFile);
    if (timedOut) {
      break;
    }
  }
  return timedOut;
}

function findSymbols(root: string, files: ts.SourceFile[], symbol: string, deadline: number) {
  const matches: unknown[] = [];
  const timedOut = visitFiles(files, (node, sourceFile) => {
    if (matches.length >= MAX_MATCHES || !ts.isIdentifier(node) || node.text !== symbol || !isDefinitionIdentifier(node)) {
      return;
    }
    matches.push({
      symbolName: symbol,
      symbolKind: node.parent ? ts.SyntaxKind[node.parent.kind] : "Identifier",
      ...location(root, sourceFile, node),
      containingDeclaration: containingDeclaration(node),
      exportStatus: node.parent && exported(node.parent) ? "exported" : "not_exported",
      classification: "definition"
    });
  }, deadline);
  return { matches, timedOut, truncated: matches.length >= MAX_MATCHES };
}

function findReferences(root: string, files: ts.SourceFile[], symbol: string, deadline: number) {
  const matches: unknown[] = [];
  const timedOut = visitFiles(files, (node, sourceFile) => {
    if (matches.length >= MAX_MATCHES || !ts.isIdentifier(node) || node.text !== symbol) {
      return;
    }
    const definition = isDefinitionIdentifier(node);
    const alias = node.parent && ts.isImportSpecifier(node.parent) && node.parent.propertyName ? node.parent.propertyName.text : undefined;
    matches.push({
      ...location(root, sourceFile, node),
      referenceType: definition ? "definition" : "reference",
      containingDeclaration: containingDeclaration(node),
      ...(alias ? { importAliasOf: alias } : {})
    });
  }, deadline);
  return { matches, timedOut, truncated: matches.length >= MAX_MATCHES };
}

function importSpecifiers(sourceFile: ts.SourceFile): Array<{ specifier: string; typeOnly: boolean; dynamic: boolean; node: ts.Node }> {
  const imports: Array<{ specifier: string; typeOnly: boolean; dynamic: boolean; node: ts.Node }> = [];
  const visit = (node: ts.Node) => {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier && ts.isStringLiteral(node.moduleSpecifier)) {
      imports.push({
        specifier: node.moduleSpecifier.text,
        typeOnly: ts.isImportDeclaration(node) ? Boolean(node.importClause?.isTypeOnly) : Boolean(node.isTypeOnly),
        dynamic: false,
        node: node.moduleSpecifier
      });
    } else if (
      ts.isCallExpression(node) &&
      node.expression.kind === ts.SyntaxKind.ImportKeyword &&
      node.arguments.length === 1 &&
      ts.isStringLiteral(node.arguments[0])
    ) {
      imports.push({ specifier: node.arguments[0].text, typeOnly: false, dynamic: true, node: node.arguments[0] });
    }
    ts.forEachChild(node, visit);
  };
  visit(sourceFile);
  return imports;
}

function importGraph(root: string, program: ts.Program, rootFile: string, maxDepth: number) {
  const options = program.getCompilerOptions();
  const nodes = new Set<string>();
  const edges: Array<{ from: string; to: string; internal: boolean; typeOnly: boolean; dynamic: boolean }> = [];
  const unresolvedImports: Array<{ from: string; specifier: string }> = [];
  const queue: Array<{ fileName: string; depth: number }> = [{ fileName: rootFile, depth: 0 }];
  const visited = new Set<string>();

  while (queue.length > 0 && nodes.size < MAX_GRAPH_NODES && edges.length < MAX_GRAPH_EDGES) {
    const current = queue.shift()!;
    const canonical = path.resolve(current.fileName);
    if (visited.has(canonical)) {
      continue;
    }
    visited.add(canonical);
    const sourceFile = program.getSourceFile(canonical) ?? program.getSourceFiles().find((file) => path.resolve(file.fileName) === canonical);
    if (!sourceFile) {
      continue;
    }
    const from = normalizeRelative(root, sourceFile.fileName);
    nodes.add(from);
    for (const imported of importSpecifiers(sourceFile)) {
      const resolution = ts.resolveModuleName(imported.specifier, sourceFile.fileName, options, ts.sys).resolvedModule;
      if (!resolution) {
        unresolvedImports.push({ from, specifier: imported.specifier });
        continue;
      }
      const resolvedFile = path.resolve(resolution.resolvedFileName);
      const internal = resolvedFile.startsWith(`${root}${path.sep}`) && !resolvedFile.includes(`${path.sep}node_modules${path.sep}`);
      const to = internal ? normalizeRelative(root, resolvedFile) : imported.specifier;
      nodes.add(to);
      edges.push({ from, to, internal, typeOnly: imported.typeOnly, dynamic: imported.dynamic });
      if (internal && current.depth < maxDepth) {
        queue.push({ fileName: resolvedFile, depth: current.depth + 1 });
      }
    }
  }

  const adjacency = new Map<string, string[]>();
  for (const edge of edges.filter((edge) => edge.internal)) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge.to]);
  }
  const cycles: string[][] = [];
  const stack: string[] = [];
  const active = new Set<string>();
  const complete = new Set<string>();
  const dfs = (node: string) => {
    if (active.has(node)) {
      const start = stack.indexOf(node);
      cycles.push([...stack.slice(start), node]);
      return;
    }
    if (complete.has(node) || cycles.length >= 25) {
      return;
    }
    active.add(node);
    stack.push(node);
    for (const target of adjacency.get(node) ?? []) {
      dfs(target);
    }
    stack.pop();
    active.delete(node);
    complete.add(node);
  };
  for (const node of nodes) {
    dfs(node);
  }
  return {
    rootFile: normalizeRelative(root, rootFile),
    nodes: [...nodes],
    edges,
    internalImports: edges.filter((edge) => edge.internal),
    externalImports: edges.filter((edge) => !edge.internal),
    typeOnlyImports: edges.filter((edge) => edge.typeOnly),
    dynamicImports: edges.filter((edge) => edge.dynamic),
    cycles,
    unresolvedImports,
    truncation: nodes.size >= MAX_GRAPH_NODES || edges.length >= MAX_GRAPH_EDGES
  };
}

function callers(root: string, files: ts.SourceFile[], symbol: string, deadline: number) {
  const matches: unknown[] = [];
  let unresolvedDynamicCalls = 0;
  const timedOut = visitFiles(files, (node, sourceFile) => {
    if (!ts.isCallExpression(node)) {
      return;
    }
    const expression = node.expression;
    const direct = ts.isIdentifier(expression) && expression.text === symbol;
    const property = ts.isPropertyAccessExpression(expression) && expression.name.text === symbol;
    if ((direct || property) && matches.length < MAX_MATCHES) {
      matches.push({
        symbol,
        ...location(root, sourceFile, expression),
        caller: containingDeclaration(node),
        resolutionConfidence: direct ? "high" : "medium"
      });
    } else if (ts.isElementAccessExpression(expression) || (!ts.isIdentifier(expression) && !ts.isPropertyAccessExpression(expression))) {
      unresolvedDynamicCalls += 1;
    }
  }, deadline);
  return { matches, unresolvedDynamicCalls, timedOut, truncated: matches.length >= MAX_MATCHES };
}

function callees(root: string, files: ts.SourceFile[], symbol: string, deadline: number) {
  const matches: unknown[] = [];
  let unresolvedDynamicCalls = 0;
  let timedOut = false;
  for (const sourceFile of files) {
    const visitDeclaration = (node: ts.Node) => {
      if (Date.now() > deadline) {
        timedOut = true;
        return;
      }
      const named = node as ts.NamedDeclaration;
      const isTarget = named.name && ts.isIdentifier(named.name) && named.name.text === symbol && ts.isFunctionLike(node);
      if (isTarget) {
        const visitCalls = (child: ts.Node) => {
          if (ts.isCallExpression(child)) {
            const expression = child.expression;
            if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
              matches.push({
                symbol: expression.getText(sourceFile),
                ...location(root, sourceFile, expression),
                containingDeclaration: symbol,
                resolutionConfidence: ts.isIdentifier(expression) ? "high" : "medium"
              });
            } else {
              unresolvedDynamicCalls += 1;
            }
          }
          if (matches.length < MAX_MATCHES) {
            ts.forEachChild(child, visitCalls);
          }
        };
        ts.forEachChild(node, visitCalls);
      }
      if (!timedOut) {
        ts.forEachChild(node, visitDeclaration);
      }
    };
    visitDeclaration(sourceFile);
    if (timedOut || matches.length >= MAX_MATCHES) {
      break;
    }
  }
  return { matches, unresolvedDynamicCalls, timedOut, truncated: matches.length >= MAX_MATCHES };
}

function mcpRegistrations(root: string, files: ts.SourceFile[]) {
  const registrations: Array<{ toolName: string; descriptionPresent: boolean; schemaPresent: boolean } & SourceLocation> = [];
  for (const sourceFile of files) {
    const visit = (node: ts.Node) => {
      if (
        ts.isVariableDeclaration(node) &&
        ts.isIdentifier(node.name) &&
        node.name.text === "tools" &&
        node.initializer &&
        ts.isArrayLiteralExpression(node.initializer)
      ) {
        for (const element of node.initializer.elements) {
          if (!ts.isObjectLiteralExpression(element)) {
            continue;
          }
          const nameProperty = element.properties.find(
            (property): property is ts.PropertyAssignment =>
              ts.isPropertyAssignment(property) && property.name.getText(sourceFile).replace(/["']/gu, "") === "name"
          );
          if (!nameProperty || !ts.isStringLiteral(nameProperty.initializer)) {
            continue;
          }
          const propertyNames = new Set(element.properties.map((property) => property.name?.getText(sourceFile).replace(/["']/gu, "")));
          registrations.push({
            toolName: nameProperty.initializer.text,
            descriptionPresent: propertyNames.has("description"),
            schemaPresent: propertyNames.has("inputSchema"),
            ...location(root, sourceFile, nameProperty.initializer)
          });
        }
      }
      ts.forEachChild(node, visit);
    };
    visit(sourceFile);
  }
  const byName = new Map<string, typeof registrations>();
  for (const registration of registrations) {
    byName.set(registration.toolName, [...(byName.get(registration.toolName) ?? []), registration]);
  }
  return {
    registrations,
    duplicateToolNames: [...byName.entries()]
      .filter(([, entries]) => entries.length > 1)
      .map(([toolName, entries]) => ({ toolName, locations: entries.map(({ file, line, column }) => ({ file, line, column })) })),
    missingDescriptions: registrations.filter((registration) => !registration.descriptionPresent),
    missingSchemas: registrations.filter((registration) => !registration.schemaPresent)
  };
}

export async function runSourceAnalysis(rootInput: string, input: SourceAnalysisInput): Promise<ArchitectToolResult<unknown>> {
  const root = assertVerifiedRepositoryRoot(rootInput);
  const startedAt = new Date().toISOString();
  try {
    const { program, configPath, files, warnings } = loadProgram(root);
    if (files.length === 0) {
      return completedResult({
        tool: "knowledge_toolbox.source_analysis",
        root,
        startedAt,
        status: "source_unavailable",
        warnings: ["No repository TypeScript or JavaScript source files are available in this runtime."],
        errors: [{ code: "source_unavailable", message: "Static source analysis is available only in repository-development mode." }]
      });
    }
    const deadline = Date.now() + MAX_ANALYSIS_MS;
    let result: unknown;
    switch (input.operation) {
      case "find_symbol":
        result = findSymbols(root, files, input.symbol, deadline);
        break;
      case "find_references":
        result = findReferences(root, files, input.symbol, deadline);
        break;
      case "import_graph":
        result = importGraph(root, program, assertSourcePath(root, input.file), input.maxDepth);
        break;
      case "get_callers":
        result = callers(root, files, input.symbol, deadline);
        break;
      case "get_callees":
        result = callees(root, files, input.symbol, deadline);
        break;
      case "mcp_registrations":
      case "duplicate_mcp_tool_names":
        result = mcpRegistrations(root, files);
        break;
    }
    const serialized = JSON.stringify(result);
    const truncated = serialized.length > 1_000_000 || Boolean((result as { truncated?: boolean; truncation?: boolean }).truncated ?? (result as { truncation?: boolean }).truncation);
    return completedResult({
      tool: "knowledge_toolbox.source_analysis",
      root,
      startedAt,
      status: "passed",
      warnings,
      truncated,
      data: {
        operation: input.operation,
        query: input,
        projectConfigurationUsed: configPath,
        filesScanned: files.length,
        limits: {
          maximumFiles: MAX_FILES,
          maximumMatches: MAX_MATCHES,
          maximumGraphNodes: MAX_GRAPH_NODES,
          maximumGraphEdges: MAX_GRAPH_EDGES,
          maximumAnalysisMs: MAX_ANALYSIS_MS
        },
        result
      }
    });
  } catch (error) {
    const sourceUnavailable = error instanceof AppError && error.details?.sourceUnavailable === true;
    return completedResult({
      tool: "knowledge_toolbox.source_analysis",
      root,
      startedAt,
      status: sourceUnavailable ? "source_unavailable" : "analysis_failure",
      errors: [{ code: sourceUnavailable ? "source_unavailable" : "analysis_failure", message: error instanceof Error ? error.message : String(error) }]
    });
  }
}
