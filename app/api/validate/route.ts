import { tryParseYaml } from "@/lib/yaml";
import { validateScreenplay } from "@/lib/schema";

export const runtime = "nodejs";

/** 校验前端传入的 YAML 是否符合剧本 Schema。 */
export async function POST(req: Request): Promise<Response> {
  let body: { yaml?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body?.yaml) {
    return Response.json({ success: false, error: "缺少 yaml 字段" }, { status: 400 });
  }

  const parsed = tryParseYaml(body.yaml);
  if (!parsed.ok) {
    return Response.json({
      success: true,
      data: { valid: false, errors: [{ path: "(yaml)", message: `YAML 解析失败：${parsed.error}`, keyword: "parse" }] },
    });
  }

  const result = validateScreenplay(parsed.data);
  return Response.json({ success: true, data: result });
}
