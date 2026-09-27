import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import type {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";

/** MCP transport session 的运行时状态；地图 Session 由独立服务管理。 */
export interface McpSessionEntry {
  server: McpServer;
  transport: StreamableHTTPServerTransport;
  sessionId: string | null;
  activePostRequests: number;
  idleTimer: ReturnType<typeof setTimeout> | null;
  closePromise: Promise<void> | null;
  closed: boolean;
}
