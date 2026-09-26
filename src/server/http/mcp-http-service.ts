import {createServer, type Server} from "node:http";
import type {McpServer} from "@modelcontextprotocol/sdk/server/mcp.js";
import {StreamableHTTPServerTransport} from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import {logger} from "../utils/logger.js";

/** Stateless MCP connections share the process's scheduler and map/search sessions. */
export function createMcpHttpService(buildServer: () => McpServer): Server {
  return createServer((request, response) => {
    if (request.headers.host !== "127.0.0.1:23337" ||
        (request.headers.origin !== undefined && request.headers.origin !== "http://127.0.0.1:23337")) {
      response.writeHead(403).end();
      return;
    }
    if (request.url !== "/mcp") {
      response.writeHead(404).end();
      return;
    }
    if (request.method !== "POST") {
      response.writeHead(405, {allow: "POST"}).end();
      return;
    }
    const server = buildServer();
    const transport = new StreamableHTTPServerTransport({sessionIdGenerator: undefined});
    response.once("close", () => {
      void server.close().catch((error: unknown) => {
        logger.warning("mcp_http_close_failed", {reason: String(error)});
      });
    });
    void (async () => {
      await server.connect(transport);
      await transport.handleRequest(request, response);
    })().catch((error: unknown) => {
      logger.warning("mcp_http_request_failed", {reason: String(error)});
      if (!response.headersSent) response.writeHead(500).end();
      else response.end();
    });
  });
}

export async function listenMcpHttpService(server: Server): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(23337, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  process.stderr.write("GeoDolly MCP listening at http://127.0.0.1:23337/mcp\n");
}
