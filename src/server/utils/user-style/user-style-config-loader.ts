/** `config/style/style-rules.yaml` 的专用 loader；只做字段级解析和缓存。 */

import {existsSync, readFileSync} from "node:fs";
import path from "node:path";
import {parse} from "yaml";
import {
  userCssStyleRuleConfigSchema,
  userCssStyleRulesDocumentSchema,
  type UserCssStyleRuleConfig,
} from "../../../models/mapsurface/style/user-css-style-models.js";
import {logger} from "../logger.js";

export class UserStyleConfigLoader {
  private cachedRules: ReadonlyArray<UserCssStyleRuleConfig> | null = null;

  constructor(private readonly styleDirPath = path.join(process.cwd(), "config", "style")) {}

  getRules(): ReadonlyArray<UserCssStyleRuleConfig> {
    if (this.cachedRules !== null) return this.cachedRules;
    const rulesPath = path.join(this.styleDirPath, "style-rules.yaml");
    // 用户规则是可选配置；入口不存在时保留纯内置样式路径。
    if (!existsSync(rulesPath)) {
      this.cachedRules = [];
      return this.cachedRules;
    }

    const rawDocument = userCssStyleRulesDocumentSchema.parse(parse(readFileSync(rulesPath, "utf8")) as unknown);
    const loadedRules: Array<UserCssStyleRuleConfig> = [];
    // 顶层文档错误直接抛出；单条字段错误使用 warning 跳过，跨文件语义留给 validator。
    for (const [ruleIndex, rawRule] of rawDocument.rules.entries()) {
      const parsedRule = userCssStyleRuleConfigSchema.safeParse(rawRule);
      if (!parsedRule.success) {
        logger.warning("skip_invalid_user_css_style_rule", {rule_index: ruleIndex, reason: parsedRule.error.message});
        continue;
      }
      loadedRules.push(parsedRule.data);
    }
    this.cachedRules = loadedRules;
    return this.cachedRules;
  }

  resetCache(): void {
    this.cachedRules = null;
  }
}

export const userStyleConfigLoader = new UserStyleConfigLoader();
