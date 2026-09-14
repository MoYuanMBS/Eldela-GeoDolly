/** Session 文件 writer 的 Node 进程内调用边界。 */

import {z} from "zod";

import {pyToolReqSchema} from "./bridge-models.js";
import {identifiedOverlayGroupsWithDisplayIdSchema} from "./map-data-models.js";
import {interactiveMapDataSchema} from "../web/interactive-ui-models.js";

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
  selectedQuery: pyToolReqSchema,
  interactiveMap: interactiveMapDataSchema.nullish(),
  aiOutputYaml: z.string().nullish(),
  interactiveMapUrl: interactiveMapUrlSchema.nullish(),
  overlayOutput: identifiedOverlayGroupsWithDisplayIdSchema.nullish(),
}).strict();

/** Buffer 是 Uint8Array 的子类，因此 Playwright 截图可以直接通过该边界。 */
export const imageFileDataSchema = z.custom<Uint8Array>((value) => value instanceof Uint8Array);

/** RAM Session checkpoint 中单条记录的稳定磁盘结构。 */
export const sessionIndexRecordSchema = z.object({
  query: z.string(),
  name: z.string().nullable().optional(),
  created_time: z.number(),
  open_time: z.number(),
  close_time: z.number(),
}).strict();

/** sessions.json 以最终 Session ID 为 key；新版 ID schema 接入前暂按字符串 key 处理。 */
export const sessionsJsonSchema = z.record(z.string(), sessionIndexRecordSchema);

export type SessionFilesInputType = z.infer<typeof sessionFilesInputSchema>;
export type ImageFileDataType = z.infer<typeof imageFileDataSchema>;
export type SessionsJsonType = z.infer<typeof sessionsJsonSchema>;
