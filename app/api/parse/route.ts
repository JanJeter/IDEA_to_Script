import { parseChapters, ChapterParseError } from "@/lib/chapters";

export const runtime = "nodejs";

/** 仅做章节解析预览（不调用 AI），用于输入区实时反馈章节数。 */
export async function POST(req: Request): Promise<Response> {
  let body: { text?: string };
  try {
    body = await req.json();
  } catch {
    return Response.json({ success: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  try {
    const chapters = parseChapters(body.text ?? "");
    return Response.json({
      success: true,
      data: {
        chapterCount: chapters.length,
        chapters: chapters.map((c) => ({
          index: c.index,
          title: c.title,
          summary: c.summary,
          length: c.content.length,
        })),
      },
    });
  } catch (e) {
    const msg = e instanceof ChapterParseError ? e.message : "章节解析失败";
    return Response.json({ success: false, error: msg }, { status: 400 });
  }
}
