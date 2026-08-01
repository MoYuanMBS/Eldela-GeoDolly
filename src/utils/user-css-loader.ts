/** 用户 CSS 的独立加载器；不经过 ConfigLoader，也不参与 Canvas style 计算。 */

import {existsSync, readFileSync, realpathSync, statSync} from "node:fs";
import path from "node:path";
import {transform, type ImportDependency} from "lightningcss";

// 这些是加载边界而非用户配置，避免递归导入拖垮地图服务或占用无界内存。
const MAX_IMPORT_DEPTH = 16;
const MAX_FILE_COUNT = 64;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;

interface LoadState {
  // activeFiles 用于识别当前递归链中的循环；loadedFiles 复用已完成的解析结果。
  activeFiles: Set<string>;
  loadedFiles: Map<string, string>;
  totalBytes: number;
  layersDirPath: string;
}

/** 判断 realpath 后的目标是否严格位于允许目录内。 */
function isPathInside(parentPath: string, candidatePath: string): boolean {
  const relativePath = path.relative(parentPath, candidatePath);
  return relativePath !== "" && relativePath !== ".." && !relativePath.startsWith(`..${path.sep}`) && !path.isAbsolute(relativePath);
}

function resolveLocalImport(specifier: string, sourceFilePath: string, layersDirPath: string): string {
  // 先拒绝所有 URL scheme 和绝对路径，再用 realpath 阻止 `..` 与符号链接逃逸。
  if (path.isAbsolute(specifier) || specifier.startsWith("//") || /^[A-Za-z][A-Za-z0-9+.-]*:/u.test(specifier)) {
    throw new Error(`User CSS import must be a local relative path: ${specifier}`);
  }
  const resolvedPath = realpathSync(path.resolve(path.dirname(sourceFilePath), specifier));
  if (path.extname(resolvedPath).toLowerCase() !== ".css" || !isPathInside(layersDirPath, resolvedPath)) {
    throw new Error(`User CSS import must resolve to a .css file inside config/style/layers: ${specifier}`);
  }
  if (!statSync(resolvedPath).isFile()) throw new Error(`User CSS import is not a file: ${specifier}`);
  return resolvedPath;
}

function loadCssFile(filePath: string, state: LoadState, depth: number): string {
  const resolvedFilePath = realpathSync(filePath);
  const cachedResult = state.loadedFiles.get(resolvedFilePath);
  if (cachedResult !== undefined) return cachedResult;

  // 在读取内容前完成递归、数量和单文件限制，失败时不留下半成品缓存。
  if (depth > MAX_IMPORT_DEPTH) throw new Error(`User CSS import depth exceeds ${MAX_IMPORT_DEPTH}`);
  if (state.activeFiles.has(resolvedFilePath)) throw new Error(`Circular user CSS import detected at ${resolvedFilePath}`);
  if (state.loadedFiles.size + state.activeFiles.size >= MAX_FILE_COUNT) throw new Error(`User CSS file count exceeds ${MAX_FILE_COUNT}`);

  const fileSize = statSync(resolvedFilePath).size;
  if (fileSize > MAX_FILE_BYTES) throw new Error(`User CSS file exceeds ${MAX_FILE_BYTES} bytes: ${resolvedFilePath}`);
  state.totalBytes += fileSize;
  if (state.totalBytes > MAX_TOTAL_BYTES) throw new Error(`User CSS total size exceeds ${MAX_TOTAL_BYTES} bytes`);

  state.activeFiles.add(resolvedFilePath);
  try {
    // Lightning CSS 同时承担严格语法解析和依赖提取；不使用正则识别 @import。
    const transformResult = transform({
      filename: resolvedFilePath,
      code: readFileSync(resolvedFilePath),
      minify: false,
      sourceMap: false,
      errorRecovery: false,
      analyzeDependencies: {preserveImports: true},
    });
    if (transformResult.warnings.length > 0) {
      throw new Error(`Invalid user CSS in ${resolvedFilePath}: ${transformResult.warnings[0].message}`);
    }

    let cssText = Buffer.from(transformResult.code).toString("utf8");
    for (const dependency of transformResult.dependencies ?? []) {
      // iframe 只接收完整 CSS 文本，因此不保留任何运行时资源 URL。
      if (dependency.type === "url") throw new Error(`url() is not allowed in user CSS: ${dependency.url}`);
      if (dependency.type !== "import") continue;
      const importDependency = dependency as ImportDependency;
      if (importDependency.media !== null || importDependency.supports !== null) {
        throw new Error(`Conditional @import is not supported in user CSS: ${importDependency.url}`);
      }
      const importedCss = loadCssFile(resolveLocalImport(importDependency.url, resolvedFilePath, state.layersDirPath), state, depth + 1);
      const generatedImport = `@import ${JSON.stringify(importDependency.placeholder)};`;
      if (!cssText.includes(generatedImport)) throw new Error(`Unable to expand user CSS import: ${importDependency.url}`);
      // 在 parser 生成的占位位置展开，保持用户声明的 cascade 顺序。
      cssText = cssText.replace(generatedImport, importedCss);
    }

    state.loadedFiles.set(resolvedFilePath, cssText);
    return cssText;
  } finally {
    // 解析成功或失败都必须退出当前递归链，否则后续加载会被误判为循环。
    state.activeFiles.delete(resolvedFilePath);
  }
}

/** 加载并缓存 `config/style/style.css` 及其本地 layers。 */
export class UserCssLoader {
  private cachedCss: string | null = null;

  constructor(private readonly styleDirPath = path.join(process.cwd(), "config", "style")) {}

  getCss(): string {
    if (this.cachedCss !== null) return this.cachedCss;
    const stylePath = path.join(this.styleDirPath, "style.css");
    // 用户 CSS 是可选配置；入口不存在时返回空结果而不是阻断地图渲染。
    if (!existsSync(stylePath)) {
      this.cachedCss = "";
      return this.cachedCss;
    }

    const resolvedStyleDirPath = realpathSync(this.styleDirPath);
    const resolvedStylePath = realpathSync(stylePath);
    // 主入口和 layers 目录自身也需要 realpath 校验，不能只检查各个导入文件。
    if (!isPathInside(resolvedStyleDirPath, resolvedStylePath)) throw new Error("User style.css must remain inside config/style");
    const layersDirPath = realpathSync(path.join(this.styleDirPath, "layers"));
    if (!isPathInside(resolvedStyleDirPath, layersDirPath) || !statSync(layersDirPath).isDirectory()) {
      throw new Error("User CSS layers directory must remain inside config/style");
    }
    this.cachedCss = loadCssFile(resolvedStylePath, {
      activeFiles: new Set<string>(),
      loadedFiles: new Map<string, string>(),
      totalBytes: 0,
      layersDirPath,
    }, 0);
    return this.cachedCss;
  }

  resetCache(): void {
    this.cachedCss = null;
  }
}

export const userCssLoader = new UserCssLoader();
