/** 固定 cache 目录下的 Session 产物写入，以及 sessions.json checkpoint 读写。 */

import {randomUUID} from "node:crypto";
import {mkdir, readFile, rename, rm, stat, unlink, writeFile} from "node:fs/promises";
import path from "node:path";

import {
  fileWriterSessionIdSchema,
  imageFileDataSchema,
  sessionFilesInputSchema,
  type FileWriteOptionsType,
  type ImageFileDataType,
  type PendingFile,
  type SessionFilesInputType,
} from "../models/backend/file-writer-models.js";
import {sessionsJsonSchema, type SessionsJsonType} from "../models/backend/session-manager-models.js";
import {AppError} from "./app-error.js";
import {logger} from "./logger.js";

const cacheRootPath = path.resolve(process.cwd(), "cache");
const sessionsJsonPath = path.join(cacheRootPath, "sessions.json");
const requiredSessionFilePaths = [
  ["selected-query.json"],
  ["interactive-map", "interactive-map.json"],
  ["output", "ai-output.yaml"],
  ["output", "interactive-map-url.json"],
  ["output", "snapshot.webp"],
] as const;

function parseSessionFiles(files: SessionFilesInputType): SessionFilesInputType {
  try {
    return sessionFilesInputSchema.parse(files);
  } catch (error) {
    throw AppError.fromUnknown(error, "file_write_input", "Invalid Session files input");
  }
}

function parseImageData(image: ImageFileDataType): Uint8Array {
  try {
    return imageFileDataSchema.parse(image);
  } catch (error) {
    throw AppError.fromUnknown(error, "file_write_input", "Invalid snapshot image data");
  }
}

/**
 * 所有 Session 路径只能是 cache 的直接子目录。这里不定义 Session ID 业务格式，
 * 只守住删除与写盘不能逃逸 cache 根目录的文件系统边界。
 */
function sessionDirectoryPath(sessionId: string): string {
  const sessionPath = path.resolve(cacheRootPath, sessionId);
  if (path.dirname(sessionPath) !== cacheRootPath) {
    throw new AppError("file_session_path", "Session path must be a direct child of cache", sessionId);
  }
  return sessionPath;
}

function errorCode(error: unknown): unknown {
  return error !== null && typeof error === "object" && "code" in error ? error.code : undefined;
}

function errorReason(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isAbortError(error: unknown): boolean {
  return error instanceof Error && (error.name === "AbortError" || errorCode(error) === "ABORT_ERR");
}

function abortError(signal: AbortSignal): AppError {
  if (signal.reason instanceof AppError) return signal.reason;
  const message = signal.reason instanceof Error ? signal.reason.message : signal.reason === undefined ? "File writing was aborted" : String(signal.reason);
  return new AppError("file_write_aborted", message, null, signal.reason instanceof Error ? {cause: signal.reason} : undefined);
}

/** cache 缺失是正常首次运行；已存在时则必须确实是目录。 */
async function ensureCacheDirectory(): Promise<void> {
  try {
    const cacheStats = await stat(cacheRootPath);
    if (!cacheStats.isDirectory()) throw new AppError("file_cache_not_directory", "Cache path is not a directory", cacheRootPath);
  } catch (error) {
    if (error instanceof AppError) throw error;
    if (errorCode(error) !== "ENOENT") throw AppError.fromUnknown(error, "file_cache_check", "Failed to check cache directory");
    try {
      // recursive 仅处理多个 Session 同时发现 cache 缺失并竞争创建的正常情况。
      await mkdir(cacheRootPath, {recursive: true});
    } catch (mkdirError) {
      throw AppError.fromUnknown(mkdirError, "file_cache_create", "Failed to create cache directory");
    }
  }
}

/**
 * 删除指定 Session 目录及其中全部文件。目录不存在同样视为清理成功；
 * Session ID 只决定 cache 的一个直接子目录，不接受调用方传入完整路径。
 */
export async function cleanupSessionFiles(sessionId: string): Promise<boolean> {
  try {
    await rm(sessionDirectoryPath(sessionId), {recursive: true, force: true});
    return true;
  } catch (error) {
    throw AppError.fromUnknown(error, "file_session_remove", "Failed to remove Session directory");
  }
}

/**
 * 固定准备顺序为：确保 cache 存在、删除同 ID 旧目录、创建本次目录树。
 * 删除完成后发生任何建目录错误，都会通过统一清理入口移除本次残留。
 */
async function prepareSessionDirectory(sessionId: string): Promise<void> {
  await ensureCacheDirectory();
  await cleanupSessionFiles(sessionId);

  try {
    const sessionPath = sessionDirectoryPath(sessionId);
    await mkdir(sessionPath);
    await mkdir(path.join(sessionPath, "interactive-map"));
    await mkdir(path.join(sessionPath, "output"));
  } catch (error) {
    await cleanupSessionFiles(sessionId);
    throw AppError.fromUnknown(error, "file_session_prepare", "Failed to prepare Session directory");
  }
}

/** JSON 文件统一使用标准 JSON、两个空格缩进和末尾换行。 */
function serializeJson(value: unknown): Uint8Array {
  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized === undefined) throw new TypeError("JSON value cannot be serialized");
    return Buffer.from(`${serialized}\n`, "utf8");
  } catch (error) {
    throw AppError.fromUnknown(error, "file_json_serialize", "Failed to serialize JSON file");
  }
}

/**
 * 先把所有存在的产物转换成最终字节，再启动并发写入。
 * null 与 undefined 都表示该产物不存在，因此不会创建空文件或 null 文件。
 */
function buildPendingFiles(sessionId: string, files: SessionFilesInputType): PendingFile[] {
  const sessionPath = sessionDirectoryPath(sessionId);
  const pendingFiles: PendingFile[] = [
    {filePath: path.join(sessionPath, "selected-query.json"), data: serializeJson(files.selectedQuery)},
  ];
  if (files.interactiveMap != null) {
    pendingFiles.push({filePath: path.join(sessionPath, "interactive-map", "interactive-map.json"), data: serializeJson(files.interactiveMap)});
  }
  if (files.aiOutputYaml != null) {
    // YAML 已由上游生成，文件层只执行 UTF-8 编码，不重新解析或改变格式。
    pendingFiles.push({filePath: path.join(sessionPath, "output", "ai-output.yaml"), data: Buffer.from(files.aiOutputYaml, "utf8")});
  }
  if (files.interactiveMapUrl != null) {
    pendingFiles.push({filePath: path.join(sessionPath, "output", "interactive-map-url.json"), data: serializeJson(files.interactiveMapUrl)});
  }
  if (files.overlayOutput != null) {
    // Overlay 保留 node/way/area/relation 分组与现有顺序，writer 不再加工业务内容。
    pendingFiles.push({filePath: path.join(sessionPath, "output", "overlay-output.json"), data: serializeJson(files.overlayOutput)});
  }
  return pendingFiles;
}

/** AbortSignal 仅交给 Node 的实际 writeFile；目录生命周期不受它影响。 */
async function writeDirectFile(file: PendingFile, signal: AbortSignal | undefined): Promise<void> {
  try {
    // 普通 Session 产物直接覆盖，不建立逐文件临时文件，也不产生覆盖 warning。
    await writeFile(file.filePath, file.data, {signal});
  } catch (error) {
    if (signal !== undefined && isAbortError(error)) throw abortError(signal);
    throw AppError.fromUnknown(error, "file_write", "Failed to write Session file");
  }
}

/**
 * 用传入的 Session ID 创建 `cache/<session_id>/`，并发写入所有实际存在的快速产物。
 * Promise.allSettled 会等待已经启动的写入全部结束，随后才清理失败批次，避免晚到写入重建残片。
 * 成功返回 true；输入、目录或任一文件失败时清理整个 Session 并抛出 AppError。
 */
export async function writeSessionFiles(sessionId: string, filesInput: SessionFilesInputType, options: FileWriteOptionsType = {}): Promise<boolean> {
  const files = parseSessionFiles(filesInput);
  await prepareSessionDirectory(sessionId);

  let pendingFiles: PendingFile[];
  try {
    pendingFiles = buildPendingFiles(sessionId, files);
  } catch (error) {
    await cleanupSessionFiles(sessionId);
    throw AppError.fromUnknown(error, "file_write", "Failed to prepare Session files");
  }

  const results = await Promise.allSettled(pendingFiles.map((file) => writeDirectFile(file, options.signal)));
  const failedResult = results.find((result): result is PromiseRejectedResult => result.status === "rejected");
  if (failedResult === undefined) return true;

  await cleanupSessionFiles(sessionId);
  throw AppError.fromUnknown(failedResult.reason, "file_write", "Failed to write Session files");
}

/**
 * 单独把 Playwright WebP bytes 写入已经准备好的 Session。该入口不检查或创建目录；
 * 调用方必须先等待 writeSessionFiles 成功。成功返回 true，写入失败抛出 AppError。
 */
export async function writeSnapshotFile(sessionId: string, imageInput: ImageFileDataType, options: FileWriteOptionsType = {}): Promise<boolean> {
  const image = parseImageData(imageInput);
  try {
    await writeFile(path.join(sessionDirectoryPath(sessionId), "output", "snapshot.webp"), image, {signal: options.signal});
    return true;
  } catch (error) {
    if (options.signal !== undefined && isAbortError(error)) throw abortError(options.signal);
    throw AppError.fromUnknown(error, "file_write", "Failed to write Session snapshot");
  }
}

function sessionsTemporaryPath(): string {
  return path.join(cacheRootPath, `.sessions.${randomUUID()}.tmp`);
}

/**
 * 加载并校验上一次 sessions.json checkpoint。cache 或索引不存在表示空部署，
 * 不在读取路径创建目录；存在但无法解析或不符合 schema 时明确失败。
 */
export async function readSessionsJson(): Promise<SessionsJsonType> {
  let rawText: string;
  try {
    rawText = await readFile(sessionsJsonPath, "utf8");
  } catch (error) {
    if (errorCode(error) === "ENOENT") return {};
    throw AppError.fromUnknown(error, "file_sessions_index_read", "Failed to read sessions index");
  }

  try {
    return sessionsJsonSchema.parse(JSON.parse(rawText) as unknown);
  } catch (error) {
    throw AppError.fromUnknown(error, "file_sessions_index_invalid", "Invalid sessions index");
  }
}

async function readOptionalSessionFile(sessionId: string, relativePath: readonly string[]): Promise<Buffer | null> {
  try {
    return await readFile(path.join(sessionDirectoryPath(sessionId), ...relativePath));
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return null;
    throw AppError.fromUnknown(error, "file_session_read", "Failed to read Session file");
  }
}

/** 公开 HTTP 只用该接口确认已登记 Session 的固定目录仍然存在。 */
export async function sessionDirectoryExists(sessionId: string): Promise<boolean> {
  try {
    return (await stat(sessionDirectoryPath(sessionId))).isDirectory();
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return false;
    throw AppError.fromUnknown(error, "file_session_check", "Failed to check Session directory");
  }
}

/**
 * 发布与 checkpoint 恢复共用同一套固定必需文件规则。Overlay 是请求级可选产物，
 * 不参与完整性判定；零字节文件不能视为已经完成的 JSON、YAML 或 WebP 产物。
 */
export async function sessionFilesAreComplete(sessionId: string): Promise<boolean> {
  const sessionPath = sessionDirectoryPath(sessionId);
  try {
    const fileStats = await Promise.all(requiredSessionFilePaths.map((relativePath) => stat(path.join(sessionPath, ...relativePath))));
    return fileStats.every((fileStat) => fileStat.isFile() && fileStat.size > 0);
  } catch (error) {
    if (errorCode(error) === "ENOENT" || errorCode(error) === "ENOTDIR") return false;
    throw AppError.fromUnknown(error, "file_session_check", "Failed to check Session files");
  }
}

/** Interactive Archive 保持 unknown，交给现有 Archive → runtime 边界执行唯一业务校验。 */
export async function readInteractiveMapArchiveFile(sessionId: string): Promise<unknown | null> {
  const data = await readOptionalSessionFile(sessionId, ["interactive-map", "interactive-map.json"]);
  if (data === null) return null;
  try {
    return JSON.parse(data.toString("utf8")) as unknown;
  } catch (error) {
    throw AppError.fromUnknown(error, "file_session_archive_invalid", "Invalid Interactive Map archive JSON");
  }
}

/** 返回原始 WebP bytes；HTTP cache validator 由响应层按内容生成。 */
export function readSessionSnapshotFile(sessionId: string): Promise<Buffer | null> {
  return readOptionalSessionFile(sessionId, ["output", "snapshot.webp"]);
}

/** 临时索引清理失败只记 warning，不能覆盖原始 checkpoint 写入异常。 */
async function cleanupTemporaryFile(tempPath: string): Promise<void> {
  try {
    await unlink(tempPath);
  } catch (error) {
    if (errorCode(error) === "ENOENT") return;
    logger.warning("file_temporary_cleanup_failed", {
      status: "skipped",
      reason: "temporary_file_cleanup_failed",
      target_path: sessionsJsonPath,
      temporary_path: tempPath,
      cleanup_reason: errorReason(error),
    });
  }
}

/**
 * 独立保存 sessions.json checkpoint，不接收 Session ID，也不复用普通产物写法。
 * 完整临时文件写入成功后才 rename 覆盖正式索引；成功返回 true，失败抛出 AppError。
 */
export async function writeSessionsJson(sessionsJson: SessionsJsonType, options: FileWriteOptionsType = {}): Promise<boolean> {
  // 调用方传入的是 RAM mapping 的类型化快照；写入边界不重复执行同一份 Zod 校验。
  const data = serializeJson(sessionsJson);
  let tempPath: string | null = null;
  try {
    await ensureCacheDirectory();
    tempPath = sessionsTemporaryPath();
    await writeFile(tempPath, data, {flag: "wx", signal: options.signal});
    await rename(tempPath, sessionsJsonPath);
    tempPath = null;
    return true;
  } catch (error) {
    if (tempPath !== null) await cleanupTemporaryFile(tempPath);
    if (options.signal !== undefined && isAbortError(error)) throw abortError(options.signal);
    throw AppError.fromUnknown(error, "file_sessions_index_write", "Failed to write sessions index");
  }
}
