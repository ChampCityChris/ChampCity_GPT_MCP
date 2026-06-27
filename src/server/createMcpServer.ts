import { Server } from "@modelcontextprotocol/sdk/server/index.js";

import { type AppConfig } from "../config.js";
import { registerTools } from "./registerTools.js";

export const MCP_SERVER_NAME = "champcity-gpt";
export const MCP_SERVER_DISPLAY_NAME = "ChampCity GPT MCP";

export function createMcpServer(config: AppConfig, version: string): Server {
  const server = new Server(
    {
      name: MCP_SERVER_NAME,
      version
    },
    {
      capabilities: {
        tools: {}
      }
    }
  );

  registerTools(server, config);
  return server;
}
