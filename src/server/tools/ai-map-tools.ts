import * as mapAppModels from "../../models/web/map-app-models.js";
import type {AiMapRuntime} from "../map-session/ai-map-runtime.js";
import type {ToolExecutionScheduler} from "./tool-execution-scheduler.js";
import {createErrorToolResult} from "./mcp-tool-handler.js";

export function createAiMapToolHandler(runtime: AiMapRuntime, scheduler: ToolExecutionScheduler) {
  async function run(sessionId: string, command: Parameters<AiMapRuntime["run"]>[1], signal: AbortSignal) {
    try {
      runtime.requireActiveSession(sessionId);
      const result = await scheduler.run((execution) => runtime.run(sessionId, command, execution), signal);
      const state = mapAppModels.aiMapToolViewSchema.parse({session_id: sessionId, ...result.view, ...(result.visual_url === undefined ? {} : {visual_url: result.visual_url})});
      const content = [{type: "text" as const, text: JSON.stringify(state)}];
      if (result.warning !== undefined) content.push({type: "text", text: JSON.stringify({warning: result.warning})});
      return {structuredContent: state, content};
    } catch (error) {
      return createErrorToolResult(error);
    }
  }
  return run;
}
