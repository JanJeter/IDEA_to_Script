import { runPipeline, type ConvertOptions } from "@/lib/pipeline";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface ConvertBody extends ConvertOptions {
  text: string;
}

/**
 * 流式转换接口：以 NDJSON（每行一个 JSON 事件）返回管线进度与最终结果。
 * 事件类型见 lib/pipeline.ts 的 ConvertEvent。
 */
export async function POST(req: Request): Promise<Response> {
  let body: ConvertBody;
  try {
    body = (await req.json()) as ConvertBody;
  } catch {
    return Response.json({ success: false, error: "请求体不是合法 JSON" }, { status: 400 });
  }

  if (!body?.text || typeof body.text !== "string") {
    return Response.json({ success: false, error: "缺少小说文本 text" }, { status: 400 });
  }

  const encoder = new TextEncoder();
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) =>
        controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        for await (const ev of runPipeline(body.text, {
          novelTitle: body.novelTitle,
          author: body.author,
          format: body.format,
        })) {
          send(ev);
        }
      } catch (e) {
        send({ type: "error", message: e instanceof Error ? e.message : "转换失败" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
    },
  });
}
