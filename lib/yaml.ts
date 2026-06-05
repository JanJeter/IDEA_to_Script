import YAML from "yaml";
import type { Screenplay } from "./types";

/**
 * 将剧本对象序列化为 YAML。
 * 关键设计：YAML 永远由「已校验的 JS 对象」序列化得到，而非让模型手写，
 * 因此输出天然合法、可被解析。
 */
export function toYaml(screenplay: Screenplay): string {
  return YAML.stringify(screenplay, {
    indent: 2,
    lineWidth: 0, // 不自动折行，保证长台词不被截断
  });
}

export function parseYaml(yamlText: string): unknown {
  return YAML.parse(yamlText);
}

/** 安全解析：返回 { ok, data, error }，不抛异常，便于 API 边界使用。 */
export function tryParseYaml(yamlText: string):
  | { ok: true; data: unknown }
  | { ok: false; error: string } {
  try {
    return { ok: true, data: YAML.parse(yamlText) };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : String(e) };
  }
}
