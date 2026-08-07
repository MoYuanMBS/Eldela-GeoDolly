/** 用户 CSS 的内部 loader；不经过通用 ConfigLoader，也不参与 Canvas style 计算。 */

import {existsSync, readFileSync, realpathSync, statSync} from "node:fs";
import path from "node:path";
import {transform, type Declaration, type ImportDependency, type Selector} from "lightningcss";
import type {UserCssSource} from "../../models/style/user-css-style-models.js";

// 这些是加载边界而非用户配置，避免递归导入拖垮地图服务或占用无界内存。
const MAX_IMPORT_DEPTH = 16;
const MAX_FILE_COUNT = 64;
const MAX_FILE_BYTES = 256 * 1024;
const MAX_TOTAL_BYTES = 1024 * 1024;
const OVERLAY_SCOPE_CLASS = "geomcp-user-overlay";
const BUILT_IN_CLASS_PREFIX = "geomcp-built-in-";

/**
 * 用户 CSS 只能修改 SVG presentation。几何、动画和滤镜会绕过 Leaflet radius 或让透明命中层
 * 无法在离散生命周期中同步，因此采用明确允许列表，而不是只维护一份容易遗漏的禁止列表。
 */
const ALLOWED_OVERLAY_DECLARATIONS = new Set([
  "display",
  "fill",
  "fill-opacity",
  "fill-rule",
  "opacity",
  "paint-order",
  "stroke",
  "stroke-dasharray",
  "stroke-dashoffset",
  "stroke-linecap",
  "stroke-linejoin",
  "stroke-miterlimit",
  "stroke-opacity",
  "stroke-width",
  "vector-effect",
  "visibility",
]);

interface LoadState {
  // activeFiles 用于识别当前递归链中的循环；loadedFiles 复用已完成的解析结果。
  activeFiles: Set<string>;
  loadedFiles: Map<string, UserCssSource>;
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

/** 提取 pseudo selector 中的子 selector，确保禁止项不能藏在 :is() / :not() 等参数里。 */
function getNestedSelectors(component: Selector[number]): ReadonlyArray<Selector> {
  const selectorContainer = component as unknown as {
    selectors?: Selector | Array<Selector> | null;
    selector?: Selector | null;
    of?: Array<Selector> | null;
  };
  const nestedSelectors: Array<Selector> = [];
  const selectors = selectorContainer.selectors;
  if (selectors !== undefined && selectors !== null && selectors.length > 0) {
    if (Array.isArray(selectors[0])) nestedSelectors.push(...selectors as Array<Selector>);
    else nestedSelectors.push(selectors as Selector);
  }
  if (selectorContainer.selector !== undefined && selectorContainer.selector !== null) nestedSelectors.push(selectorContainer.selector);
  if (selectorContainer.of !== undefined && selectorContainer.of !== null) nestedSelectors.push(...selectorContainer.of);
  return nestedSelectors;
}

/** 禁止 ID 与 built-in 命名空间，包括嵌套 pseudo selector 中的引用。 */
function validateSelectorComponents(selector: Selector): void {
  for (const component of selector) {
    if (component.type === "id") throw new Error(`#${component.name} is not allowed in user CSS selectors`);
    if (component.type === "class" && component.name.startsWith(BUILT_IN_CLASS_PREFIX)) {
      throw new Error(`.${component.name} cannot be referenced by user CSS`);
    }
    for (const nestedSelector of getNestedSelectors(component)) validateSelectorComponents(nestedSelector);
  }
}

/** 校验 Overlay 作用域，并只收集与作用域位于同一 compound selector 的 Feature class。 */
function validateAndCollectOverlayClassNames(selector: Selector, output: Set<string>): void {
  validateSelectorComponents(selector);
  let compoundClassNames: Array<string> = [];
  let lastScopeNextCombinator: string | null | undefined;
  const flushCompound = (nextCombinator: string | null): void => {
    if (compoundClassNames.includes(OVERLAY_SCOPE_CLASS)) {
      lastScopeNextCombinator = nextCombinator;
      for (const className of compoundClassNames) {
        // scope class 是 renderer 的边界标记，不允许被 rule 当成 Feature 样式身份。
        if (className !== OVERLAY_SCOPE_CLASS) output.add(className);
      }
    }
    compoundClassNames = [];
  };
  for (const component of selector) {
    if (component.type === "combinator") flushCompound(component.value);
    else if (component.type === "class") compoundClassNames.push(component.name);
  }
  flushCompound(null);
  if (lastScopeNextCombinator === undefined) throw new Error(`User CSS selector must include .${OVERLAY_SCOPE_CLASS}`);
  // scope 后只允许进入其子树；紧邻/普通兄弟组合符会把最终目标移到 Overlay 外部。
  if (lastScopeNextCombinator !== null && lastScopeNextCombinator !== "child" && lastScopeNextCombinator !== "descendant") {
    throw new Error(`User CSS selector cannot escape .${OVERLAY_SCOPE_CLASS} through ${lastScopeNextCombinator}`);
  }
}

function getDeclarationPropertyName(declaration: Declaration): string {
  // Lightning CSS 把 r/cx/cy、vector-effect 等未内建的 SVG 属性表示为 custom declaration；
  // `--variable` 也走同一分支，所以必须检查实际 name，不能笼统允许或拒绝 custom。
  if (declaration.property === "custom") return String(declaration.value.name);
  // 已知属性使用 var() 等未解析值时会保留为 unparsed，但 propertyId 仍能提供真实属性名。
  if (declaration.property === "unparsed") return declaration.value.propertyId.property;
  return declaration.property;
}

/** 拒绝 r/cx/cy/transform/animation/filter 等所有不属于稳定 SVG presentation 的声明。 */
function validateOverlayDeclaration(declaration: Declaration): void {
  const propertyName = getDeclarationPropertyName(declaration);
  if (!ALLOWED_OVERLAY_DECLARATIONS.has(propertyName)) {
    throw new Error(`${propertyName} is not allowed in user Overlay CSS declarations`);
  }
}

/** import 全部展开后再压缩一次，缓存和 payload 不保留注释或文件级冗余空白。 */
function minifyExpandedCss(source: UserCssSource, entryFilePath: string): UserCssSource {
  const transformResult = transform({
    filename: entryFilePath,
    code: Buffer.from(source.css),
    minify: true,
    sourceMap: false,
    errorRecovery: false,
  });
  if (transformResult.warnings.length > 0) {
    throw new Error(`Invalid expanded user CSS in ${entryFilePath}: ${transformResult.warnings[0].message}`);
  }
  return Object.freeze({css: Buffer.from(transformResult.code).toString("utf8"), classNames: source.classNames});
}

function loadCssFile(filePath: string, state: LoadState, depth: number): UserCssSource {
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
    const classNames = new Set<string>();
    // Lightning CSS 同时承担严格语法解析、class 提取和依赖分析，不使用字符串搜索 CSS。
    const transformResult = transform({
      filename: resolvedFilePath,
      code: readFileSync(resolvedFilePath),
      minify: false,
      sourceMap: false,
      errorRecovery: false,
      analyzeDependencies: {preserveImports: true},
      visitor: {
        Selector: (selector) => validateAndCollectOverlayClassNames(selector, classNames),
        Declaration: validateOverlayDeclaration,
      },
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
      const importedSource = loadCssFile(resolveLocalImport(importDependency.url, resolvedFilePath, state.layersDirPath), state, depth + 1);
      const generatedImport = `@import ${JSON.stringify(importDependency.placeholder)};`;
      if (!cssText.includes(generatedImport)) throw new Error(`Unable to expand user CSS import: ${importDependency.url}`);
      // 在 parser 生成的占位位置展开，保持用户声明的 cascade 顺序。
      cssText = cssText.replace(generatedImport, importedSource.css);
      for (const className of importedSource.classNames) classNames.add(className);
    }

    const source = Object.freeze({css: cssText, classNames});
    state.loadedFiles.set(resolvedFilePath, source);
    return source;
  } finally {
    // 解析成功或失败都必须退出当前递归链，否则后续加载会被误判为循环。
    state.activeFiles.delete(resolvedFilePath);
  }
}

/** 加载并缓存 `config/style/style.css` 及其本地 layers。 */
export class UserCssLoader {
  private cachedSource: UserCssSource | null = null;

  constructor(private readonly styleDirPath = path.join(process.cwd(), "config", "style")) {}

  getSource(): UserCssSource {
    if (this.cachedSource !== null) return this.cachedSource;
    const stylePath = path.join(this.styleDirPath, "style.css");
    // 用户 CSS 是可选配置；入口不存在时返回空结果而不是阻断地图渲染。
    if (!existsSync(stylePath)) {
      this.cachedSource = Object.freeze({css: "", classNames: new Set<string>()});
      return this.cachedSource;
    }

    const resolvedStyleDirPath = realpathSync(this.styleDirPath);
    const resolvedStylePath = realpathSync(stylePath);
    // 主入口和 layers 目录自身也需要 realpath 校验，不能只检查各个导入文件。
    if (!isPathInside(resolvedStyleDirPath, resolvedStylePath)) throw new Error("User style.css must remain inside config/style");
    const layersDirPath = realpathSync(path.join(this.styleDirPath, "layers"));
    if (!isPathInside(resolvedStyleDirPath, layersDirPath) || !statSync(layersDirPath).isDirectory()) {
      throw new Error("User CSS layers directory must remain inside config/style");
    }
    const expandedSource = loadCssFile(resolvedStylePath, {
      activeFiles: new Set<string>(),
      loadedFiles: new Map<string, UserCssSource>(),
      totalBytes: 0,
      layersDirPath,
    }, 0);
    this.cachedSource = minifyExpandedCss(expandedSource, resolvedStylePath);
    return this.cachedSource;
  }

  resetCache(): void {
    this.cachedSource = null;
  }
}

export const userCssLoader = new UserCssLoader();
