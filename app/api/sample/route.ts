import { readFile } from "node:fs/promises";
import path from "node:path";

export const runtime = "nodejs";

/** 返回内置示例小说文本，供前端「载入示例」按钮使用（单一数据源：examples/sample-novel.txt）。 */
export async function GET(): Promise<Response> {
  try {
    const file = path.join(process.cwd(), "examples", "sample-novel.txt");
    const text = await readFile(file, "utf-8");
    return Response.json({ success: true, data: { text } });
  } catch (e) {
    return Response.json(
      { success: false, error: e instanceof Error ? e.message : "示例读取失败" },
      { status: 500 },
    );
  }
}
