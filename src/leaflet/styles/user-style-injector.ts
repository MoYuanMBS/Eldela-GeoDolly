/** 浏览器用户 CSS 的唯一 DOM 注入入口。 */

const USER_STYLE_SELECTOR = "style[data-geomcp-user-style]";

/**
 * 把 payload 中已经由 Node 校验和压缩的 CSS 写入唯一 style 节点。
 * 重复初始化更新原节点并清理意外副本；空字符串也会覆盖旧内容。
 */
export function installUserStyleCss(css: string, targetDocument: Document = document): HTMLStyleElement {
  const existingNodes = [...targetDocument.querySelectorAll<HTMLStyleElement>(USER_STYLE_SELECTOR)];
  let styleElement = existingNodes.shift();
  if (styleElement === undefined) {
    styleElement = targetDocument.createElement("style");
    styleElement.setAttribute("data-geomcp-user-style", "");
  }
  for (const duplicateNode of existingNodes) duplicateNode.remove();
  // 创建或移动到 head 末尾，确保固定 built-in asset 始终先于用户 CSS 参与 cascade。
  targetDocument.head.append(styleElement);
  styleElement.textContent = css;
  return styleElement;
}
