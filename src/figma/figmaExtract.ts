export interface FigmaFrameSummary {
  name: string;
  nodeId: string;
  pageName?: string;
  width?: number;
  height?: number;
}

export interface FigmaDesignSummary {
  fileName: string;
  pages: string[];
  topLevelFrames: FigmaFrameSummary[];
  components: Array<{ key: string; name: string }>;
  componentSets: Array<{ key: string; name: string }>;
  styles: Array<{ key: string; name: string; styleType?: string }>;
  colorFills: string[];
  textStyles: Array<{ fontFamily?: string; fontSize?: number; fontWeight?: number; nodeName?: string }>;
}

type FigmaNode = Record<string, unknown> & {
  id?: string;
  name?: string;
  type?: string;
  children?: FigmaNode[];
  absoluteBoundingBox?: { width?: number; height?: number };
  fills?: Array<Record<string, unknown>>;
  style?: Record<string, unknown>;
};

function asObjectMap(value: unknown): Record<string, Record<string, unknown>> {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as Record<string, Record<string, unknown>>) : {};
}

function nodeChildren(value: unknown): FigmaNode[] {
  const children = (value as FigmaNode | undefined)?.children;
  return Array.isArray(children) ? children : [];
}

function hexByte(value: unknown): string {
  const numeric = typeof value === "number" ? value : 0;
  return Math.round(Math.max(0, Math.min(1, numeric)) * 255)
    .toString(16)
    .padStart(2, "0");
}

function collectNodeDetails(node: FigmaNode, colors: Set<string>, textStyles: FigmaDesignSummary["textStyles"], limit = 250): void {
  if (colors.size + textStyles.length > limit) {
    return;
  }

  for (const fill of Array.isArray(node.fills) ? node.fills : []) {
    if (fill.type === "SOLID" && fill.color && typeof fill.color === "object") {
      const color = fill.color as Record<string, unknown>;
      colors.add(`#${hexByte(color.r)}${hexByte(color.g)}${hexByte(color.b)}`);
    }
  }

  if (node.type === "TEXT" && node.style && typeof node.style === "object") {
    textStyles.push({
      nodeName: node.name,
      fontFamily: typeof node.style.fontFamily === "string" ? node.style.fontFamily : undefined,
      fontSize: typeof node.style.fontSize === "number" ? node.style.fontSize : undefined,
      fontWeight: typeof node.style.fontWeight === "number" ? node.style.fontWeight : undefined
    });
  }

  for (const child of nodeChildren(node)) {
    collectNodeDetails(child, colors, textStyles, limit);
  }
}

export function extractFigmaDesignSummary(rawFile: unknown, maxFrames = 100): FigmaDesignSummary {
  const file = rawFile && typeof rawFile === "object" ? (rawFile as Record<string, unknown>) : {};
  const documentNode = file.document && typeof file.document === "object" ? (file.document as FigmaNode) : {};
  const pages = nodeChildren(documentNode);
  const topLevelFrames: FigmaFrameSummary[] = [];
  const colors = new Set<string>();
  const textStyles: FigmaDesignSummary["textStyles"] = [];

  for (const page of pages) {
    for (const child of nodeChildren(page)) {
      if (child.type === "FRAME" || child.type === "COMPONENT" || child.type === "INSTANCE") {
        if (topLevelFrames.length < maxFrames) {
          topLevelFrames.push({
            name: child.name ?? "Untitled frame",
            nodeId: child.id ?? "unknown",
            pageName: page.name,
            width: child.absoluteBoundingBox?.width,
            height: child.absoluteBoundingBox?.height
          });
        }
        collectNodeDetails(child, colors, textStyles);
      }
    }
  }

  const components = asObjectMap(file.components);
  const componentSets = asObjectMap(file.componentSets);
  const styles = asObjectMap(file.styles);

  return {
    fileName: typeof file.name === "string" ? file.name : "Untitled Figma file",
    pages: pages.map((page) => page.name ?? "Untitled page"),
    topLevelFrames,
    components: Object.entries(components).map(([key, value]) => ({ key, name: String(value.name ?? key) })),
    componentSets: Object.entries(componentSets).map(([key, value]) => ({ key, name: String(value.name ?? key) })),
    styles: Object.entries(styles).map(([key, value]) => ({
      key,
      name: String(value.name ?? key),
      styleType: typeof value.styleType === "string" ? value.styleType : undefined
    })),
    colorFills: [...colors].sort(),
    textStyles
  };
}
