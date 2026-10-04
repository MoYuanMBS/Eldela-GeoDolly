import type {App} from "@modelcontextprotocol/ext-apps";
import * as mapAppModels from "../src/models/web/map-app-models.js";
import type {AiMapViewCommands} from "../src/browser/web/map-surface-port.js";
import {AppError} from "../src/shared/app-error.js";

// 描述对应当前阶段的完成语义：应用 AI 视口并返回实际状态，不承诺新瓦片或截图已就绪。
const FIT_AI_MAP_BBOX_DESCRIPTION = "Fit the entire target bbox into the current AI map's fixed viewport. Changes only the AI map; does not query more geographic data or take a screenshot.";
const SET_AI_MAP_CENTER_ZOOM_DESCRIPTION = "Set the current AI map's geographic center and integer Leaflet zoom. Changes only the AI map; does not query more geographic data or take a screenshot.";

/**
 * 在 App connect 前注册一次。入口维护当前 Session/ready 绑定，adapter 提供所属实例的视口命令。
 * getter 在每次调用时读取最新绑定，避免注册时的闭包把工具永久绑定到首张地图。
 */
export function registerAiMapTools(app: App, getBinding: () => {sessionId: string; commands: AiMapViewCommands} | null) {
  function runAiViewCommand(sessionId: string, operation: (commands: AiMapViewCommands) => mapAppModels.AiMapViewType) {
    try {
      // SDK 负责严格输入校验和 disabled 分发；这里核对本次调用仍对应当前可操作的地图。
      const binding = getBinding();
      if (binding === null) throw new AppError("ai_map_not_ready", "No AI map is currently ready");
      if (binding.sessionId !== sessionId) throw new AppError("ai_map_session_mismatch", "The requested session does not match the current AI map");
      const state = {session_id: sessionId, ...operation(binding.commands)};
      // adapter 返回 Leaflet 实际采用的状态；两种 MCP 内容使用同一份结果，不返回请求值充当成功状态。
      return {structuredContent: state, content: [{type: "text" as const, text: JSON.stringify(state)}]};
    } catch (error) {
      // 前端工具边界统一整理业务/Leaflet 错误；toJSON 只公开 code、message、details，不带 stack/cause。
      const failure = AppError.fromUnknown(error, "ai_map_view_failed", "AI map view operation failed").toJSON();
      return {isError: true as const, content: [{type: "text" as const, text: JSON.stringify(failure)}]};
    }
  }

  // 两个工具都改变 AI 视口；重复相同输入应得到相同视口目标，因此标注为非只读且幂等。
  const fitAiMapTool = app.registerTool("geomcp_fit_ai_map_bbox", {
    description: FIT_AI_MAP_BBOX_DESCRIPTION,
    inputSchema: mapAppModels.fitAiMapBboxInputSchema,
    outputSchema: mapAppModels.aiMapToolViewSchema,
    annotations: {readOnlyHint: false, idempotentHint: true},
  }, ({session_id, bbox}) => runAiViewCommand(session_id, (commands) => commands.fitBounds(bbox)));
  const setAiMapTool = app.registerTool("geomcp_set_ai_map_center_zoom", {
    description: SET_AI_MAP_CENTER_ZOOM_DESCRIPTION,
    inputSchema: mapAppModels.setAiMapCenterZoomInputSchema,
    outputSchema: mapAppModels.aiMapToolViewSchema,
    annotations: {readOnlyHint: false, idempotentHint: true},
  }, ({session_id, center, zoom}) => runAiViewCommand(session_id, (commands) => commands.setCenterZoom({center, zoom})));

  // 尚未收到 ready 绑定时不向宿主提供可调用工具；后续 enable/disable 和列表通知由 SDK 管理。
  fitAiMapTool.disable();
  setAiMapTool.disable();
  return {fitAiMapTool, setAiMapTool};
}
