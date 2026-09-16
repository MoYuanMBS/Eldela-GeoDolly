/** 预发布 Snapshot 页面使用的一次性内存授权。 */

import {randomBytes} from "node:crypto";
import type {SnapshotMapDataType} from "../models/web/snapshot-ui-models.js";
import {AppError} from "../utils/app-error.js";

const SNAPSHOT_TOKEN_BYTES = 32;

/**
 * token 与唯一 Snapshot payload 绑定；HTML 只调用 has()，真正的数据请求才通过 consume() 原子取走。
 * Node 单线程事件循环保证同步 Map.delete 与 Map.get 之间不会插入另一个请求。
 */
export class SnapshotTokenStore {
  private readonly payloads = new Map<string, SnapshotMapDataType>();

  /** 保存已在 Snapshot service 边界校验过的 payload，并返回仅供内部 route 使用的授权。 */
  issue(payload: SnapshotMapDataType): string {
    try {
      // 256-bit 随机 token 已足够不可预测；循环只处理理论上的随机碰撞，不借 token 生成 session ID。
      let token: string;
      do token = randomBytes(SNAPSHOT_TOKEN_BYTES).toString("hex");
      while (this.payloads.has(token));
      this.payloads.set(token, payload);
      return token;
    } catch (error) {
      throw AppError.fromUnknown(error, "snapshot_token_generation", "Snapshot authorization token could not be generated");
    }
  }

  /** HTML route 只做存在性验证，不能通过本方法读取 payload。 */
  has(token: string): boolean {
    return this.payloads.has(token);
  }

  /** data route 的唯一读取入口；返回 payload 的同一步先删除授权。 */
  consume(token: string): SnapshotMapDataType | null {
    const payload = this.payloads.get(token);
    if (payload === undefined) return null;
    this.payloads.delete(token);
    return payload;
  }

  /** 截图完成、失败或取消后幂等撤销仍未消费的授权。 */
  revoke(token: string): boolean {
    return this.payloads.delete(token);
  }

  /** 服务关闭时撤销全部未完成任务。 */
  clear(): void {
    this.payloads.clear();
  }
}
