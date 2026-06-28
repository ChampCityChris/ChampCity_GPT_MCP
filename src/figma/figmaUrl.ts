import { AppError } from "../utils/errors.js";

export type FigmaUrlType = "design" | "file" | "proto" | "unknown";
export type FigmaUrlClassification = "figmaDesign" | "figmaFile" | "figmaProto" | "figmaMake" | "unsupported";

export interface ParsedFigmaUrl {
  fileKey: string;
  nodeId: string | null;
  urlType: FigmaUrlType;
}

export interface ParsedFigmaMakeUrl {
  makeProjectId: string;
  makeUrl: string;
  slug: string | null;
  urlType: "make";
}

const SUPPORTED_TYPES = new Set(["design", "file", "proto"]);

export function normalizeFigmaNodeId(nodeId: string | null | undefined): string | null {
  if (!nodeId || nodeId.trim() === "") {
    return null;
  }

  const trimmed = nodeId.trim();
  return trimmed.includes(":") ? trimmed : trimmed.replace(/-/gu, ":");
}

export function classifyFigmaUrl(rawUrl: string): FigmaUrlClassification {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return "unsupported";
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "figma.com" && hostname !== "www.figma.com") {
    return "unsupported";
  }

  const [urlType] = parsed.pathname.split("/").filter(Boolean);
  switch (urlType) {
    case "design":
      return "figmaDesign";
    case "file":
      return "figmaFile";
    case "proto":
      return "figmaProto";
    case "make":
      return "figmaMake";
    default:
      return "unsupported";
  }
}

export function parseFigmaUrl(rawUrl: string): ParsedFigmaUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError("INVALID_INPUT", "Invalid Figma URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "figma.com" && hostname !== "www.figma.com") {
    throw new AppError("INVALID_INPUT", "Expected a figma.com URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  const urlType = segments[0] ?? "unknown";
  if (!SUPPORTED_TYPES.has(urlType) || !segments[1]) {
    throw new AppError("INVALID_INPUT", "Expected a Figma /design, /file, or /proto URL with a file key.");
  }

  return {
    fileKey: segments[1],
    nodeId: normalizeFigmaNodeId(parsed.searchParams.get("node-id")),
    urlType: urlType as FigmaUrlType
  };
}

export function parseFigmaMakeUrl(rawUrl: string): ParsedFigmaMakeUrl {
  let parsed: URL;
  try {
    parsed = new URL(rawUrl);
  } catch {
    throw new AppError("INVALID_INPUT", "Invalid Figma Make URL.");
  }

  const hostname = parsed.hostname.toLowerCase();
  if (hostname !== "figma.com" && hostname !== "www.figma.com") {
    throw new AppError("INVALID_INPUT", "Unsupported non-Figma URL.");
  }

  const segments = parsed.pathname.split("/").filter(Boolean);
  if (segments[0] !== "make" || !segments[1]) {
    throw new AppError("INVALID_INPUT", "Expected a Figma /make URL with a Make project id.");
  }

  return {
    makeProjectId: segments[1],
    makeUrl: parsed.toString(),
    slug: segments[2] ?? null,
    urlType: "make"
  };
}
