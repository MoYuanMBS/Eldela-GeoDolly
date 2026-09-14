/** 搜索 ID 与所选 candidate.index 的最终 Session ID helper。 */

import {
  type SessionIdType,
  type IndexSessionIdType,
} from "../models/backend/session-id-models.js";

/**
 * 这里仅负责拼接；搜索 ID 和最终 ID 分别由 AI 输入与 Bridge schema 校验。
 * candidateIndex 必须取候选对象自身的 index，不能使用数组位置代替。
 */
export function buildFinalSessionId(sessionId: SessionIdType, candidateIndex: number): IndexSessionIdType {
  return `${sessionId}-${candidateIndex}`;
}
