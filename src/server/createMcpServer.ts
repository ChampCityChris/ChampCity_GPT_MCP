import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { type AppConfig } from "../config.js";
import { registerTools, type ToolExposureOptions } from "./registerTools.js";

export const MCP_SERVER_NAME = "champcity-gpt";
export const MCP_SERVER_DISPLAY_NAME = "ChampCity GPT MCP";

export function createMcpServer(config: AppConfig, version: string, toolExposureOptions: ToolExposureOptions = {}): Server {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version
    },
    {
      capabilities: {
        tools: {},
        resources: {},
        prompts: {}
      }
    }
  );

  registerTools(server, config, toolExposureOptions);
  return server;
}
