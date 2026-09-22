/** Session 文件 writer 的 Node 进程内调用边界。 */

import {z} from "zod";

import {identifiedOverlayGroupsWithDisplayIdSchema} from "../common/map-data-models.js";
import {interactiveMapArchiveSchema, selectedQueryArchiveSchema} from "./map-session-models.js";

/** 新版最终 Session ID schema 接入前，只确认调用边界收到字符串。 */
export const fileWriterSessionIdSchema = z.string();

/** AbortSignal 只交给实际文件写入，不参与目录检查、创建或删除。 */
export interface FileWriteOptionsType {
  signal?: AbortSignal;
}

/** 已完成序列化、等待并发写入的单个固定产物。 */
export interface PendingFile {
  /** 由 writer 按 cache 与 Session 规则推导的绝对路径。 */
  filePath: string;
  /** JSON/YAML/WebP 最终写盘字节，不在并发阶段再次转换。 */
  data: Uint8Array;
}

/** `interactive-map-url.json` 只保存本次 Session 的完整 Interactive URL。 */
export const interactiveMapUrlSchema = z.object({
  url: z.string(),
}).strict();

/**
 * 一次目录准备后可以并发写入的 Session 产物。
 * selectedQuery 始终存在；其余字段为 null 或缺省时不创建对应文件。
 */
export const sessionFilesInputSchema = z.object({
  selectedQuery: selectedQueryArchiveSchema,
  interactiveMap: interactiveMapArchiveSchema.nullish(),
  aiOutputYaml: z.string().nullish(),
  interactiveMapUrl: interactiveMapUrlSchema.nullish(),
  overlayOutput: identifiedOverlayGroupsWithDisplayIdSchema.nullish(),
}).strict();

/** Buffer 是 Uint8Array 的子类，因此 Playwright 截图可以直接通过该边界。 */
export const imageFileDataSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

export type SessionFilesInputType = z.infer<typeof sessionFilesInputSchema>;
export type ImageFileDataType = z.infer<typeof imageFileDataSchema>;
