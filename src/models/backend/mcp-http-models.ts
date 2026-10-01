/** Node 内存中的 MCP 协议会话模型；与地图 Session 的登记、归档和 TTL 状态独立。 */

import type {NodeStreamableHTTPServerTransport} from "@modelcontextprotocol/node";
import type {McpServer, RequestId} from "@modelcontextprotocol/server";

/** 每个客户端协议会话持有自己的 SDK 实例，Tool handler 使用 index 提供的共享业务服务。 */
export interface McpHttpSession {
  server: McpServer;
  /** 同一会话的 POST、GET/SSE 与 DELETE 请求共用此 transport。 */
  transport: NodeStreamableHTTPServerTransport;
  /** Unix 毫秒；在收到请求、HTTP 响应结束或尝试发送协议消息时更新，用于闲置回收。 */
  lastActivity: number;
  /** 尚未结束的 HTTP 响应数，包含持续的 GET/SSE；有活动响应时不进行闲置回收。 */
  activeResponses: number;
  /** 等待回复的请求 ID；回复发送结束或显式取消时移除，保护断线后仍在执行的工具。 */
  pendingRequests: Set<RequestId>;
}
