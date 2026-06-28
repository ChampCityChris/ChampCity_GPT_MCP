import { AppError } from "../utils/errors.js";

export interface FigmaClientOptions {
  token: string;
  fetchImpl?: typeof fetch;
}

export interface FigmaImagesResponse {
  images: Record<string, string | null>;
  err?: string | null;
}

const FIGMA_API_BASE = "https://api.figma.com/v1";
const MAX_ERROR_TEXT_BYTES = 2000;

function fetcher(options: FigmaClientOptions): typeof fetch {
  return options.fetchImpl ?? fetch;
}

export function redactFigmaToken(value: string, token: string): string {
  return token ? value.split(token).join("[REDACTED_FIGMA_TOKEN]") : value;
}

function sanitizeErrorText(text: string, token: string): string {
  return redactFigmaToken(text.slice(0, MAX_ERROR_TEXT_BYTES), token);
}

async function readJsonResponse(response: Response, token: string): Promise<unknown> {
  const text = await response.text();
  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new AppError("APPROVAL_REQUIRED", "Figma token invalid or unauthorized.");
    }

    if (response.status === 404) {
      throw new AppError("INVALID_INPUT", "Figma file/frame not found or not shared with token.");
    }

    throw new AppError("PROCESS_FAILED", `Figma API request failed with HTTP ${response.status}.`, {
      response: sanitizeErrorText(text, token)
    });
  }

  try {
    return JSON.parse(text) as unknown;
  } catch (error) {
    throw new AppError("PROCESS_FAILED", "Figma API returned invalid JSON.", {
      cause: error instanceof Error ? sanitizeErrorText(error.message, token) : sanitizeErrorText(String(error), token)
    });
  }
}

async function figmaGet(pathname: string, options: FigmaClientOptions): Promise<unknown> {
  const response = await fetcher(options)(`${FIGMA_API_BASE}${pathname}`, {
    headers: {
      Authorization: `Bearer ${options.token}`
    }
  });
  return readJsonResponse(response, options.token);
}

export async function fetchFigmaFile(fileKey: string, options: FigmaClientOptions): Promise<unknown> {
  return figmaGet(`/files/${encodeURIComponent(fileKey)}`, options);
}

export async function fetchFigmaNode(fileKey: string, nodeId: string, options: FigmaClientOptions): Promise<unknown> {
  const query = new URLSearchParams({ ids: nodeId });
  return figmaGet(`/files/${encodeURIComponent(fileKey)}/nodes?${query.toString()}`, options);
}

export async function fetchFigmaImages(
  fileKey: string,
  nodeIds: string[],
  format: "png" | "svg",
  scale: 1 | 2,
  options: FigmaClientOptions
): Promise<FigmaImagesResponse> {
  const query = new URLSearchParams({
    ids: nodeIds.join(","),
    format,
    scale: String(scale)
  });
  return figmaGet(`/images/${encodeURIComponent(fileKey)}?${query.toString()}`, options) as Promise<FigmaImagesResponse>;
}

export async function downloadFigmaImage(url: string, options: FigmaClientOptions): Promise<Buffer> {
  let response: Response;
  try {
    response = await fetcher(options)(url);
  } catch (error) {
    throw new AppError("PROCESS_FAILED", "Failed to download Figma image export.", {
      cause: error instanceof Error ? sanitizeErrorText(error.message, options.token) : sanitizeErrorText(String(error), options.token)
    });
  }

  if (!response.ok) {
    throw new AppError("PROCESS_FAILED", `Figma image download failed with HTTP ${response.status}.`);
  }

  return Buffer.from(await response.arrayBuffer());
}
