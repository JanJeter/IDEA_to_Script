import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";
import { parseChapters } from "../lib/chapters";
import { generateMockScreenplay } from "../lib/mock";
import { validateScreenplay } from "../lib/schema";

const sample = readFileSync(path.join(process.cwd(), "examples/sample-novel.txt"), "utf-8");
const hanshanNovel = `第一章 寒山寺
江南的秋雨连绵了七日，寒山寺的钟声在雨幕里沉闷而悠远。山门外的石阶生满青苔，一辆乌篷车停在阶下，车辕上的老马低着头，任凭雨水顺着鬃毛淌下。

车帘掀开，一个白衣女子撑伞而出。她面容清冷，眉间一点朱砂，怀里抱着一只紫檀木匣。寺内知客僧双手合十，低眉道：“施主，方丈已等候多时。”

女子未答，只将半枚铜牌递上。知客僧见牌色变，引她穿过回廊，步入后院禅房。

禅房内，老方丈闭目捻珠，忽道：“十九年了，你终究还是来了。”

白衣女子将木匣放在案上，声音微颤：“师父，我带了师兄的遗物回来。”

老方丈睁眼，目光落在木匣上，久久不语。窗外的雨，下得更大了。

第二章 夜变
子时三刻，寒山寺的经声骤然停了。

白衣女子蓦然惊醒，指尖已多了三枚银针。禅房外，脚步声细碎而急促，绝非僧人巡夜。

门被推开，一个灰衣僧人执刀而立，面容冷峻，刀刃上映着烛火。

他低声道：“交出木匣，可留全尸。”

白衣女子冷笑道：“寒山寺的戒律，何时容得你持刀入禅房？”

灰衣僧人不再言语，刀光一闪，直取咽喉。白衣女子侧身避过，银针破空而出，钉入对方肩头。

灰衣僧人闷哼一声，刀势不停。两人过招不过数息，禅房内桌椅尽碎。

忽地，一声佛号从廊下传来：“住手。”

老方丈拄杖而立，灰衣僧人见状，面色大变，纵身没入雨夜。

白衣女子按住袖口伤痕，问道：“他是谁？”

老方丈久久才道：“是你师兄的师弟——十九年前，所有人都以为他死了。”

第三章 浮现
翌日晨，雨歇天晴。寒山寺后山的塔林里，老方丈将木匣打开。

匣内并非遗物，而是一卷泛黄的手札，与半块虎符。

老方丈道：“当年你师兄执意查考边关军粮案，终遭灭口。这虎符，便是调兵劫粮的信物。”

白衣女子问：“另一半在谁手中？”

老方望向山下云海，缓缓道：“当年经手此案的人，如今已位极人臣。你若继续追查，便不再只是江湖恩怨。”

白衣女子将手札收入怀中，转身向山下走去。晨光落在她肩头，影子却拉得很长。

她没有回头，只留下一句：“师兄等了十九年，够了。”

塔林风起，松涛如怒。一桩沉埋近二十年的旧案，终于从这座古寺里，吹出了第一粒尘。`;

describe("generateMockScreenplay", () => {
  const chapters = parseChapters(sample);
  const screenplay = generateMockScreenplay(chapters, { novelTitle: "山海客栈" });

  it("从示例小说生成的剧本通过 Schema 校验", () => {
    const result = validateScreenplay(screenplay);
    if (!result.valid) console.error(result.errors);
    expect(result.valid).toBe(true);
  });

  it("场景数与章节数一致，且每场都能回溯来源章节", () => {
    expect(screenplay.scenes).toHaveLength(chapters.length);
    for (const scene of screenplay.scenes) {
      expect(scene.source_chapter).toBeGreaterThanOrEqual(1);
    }
  });

  it("每场戏都标注原文章节段落与 AI 删改说明", () => {
    for (const scene of screenplay.scenes) {
      expect(scene.source_refs?.length).toBeGreaterThan(0);
      expect(scene.source_refs?.[0].chapter_index).toBe(scene.source_chapter);
      expect(scene.source_refs?.[0].paragraph_start).toBeGreaterThanOrEqual(1);
      expect(scene.source_refs?.[0].paragraph_end).toBeGreaterThanOrEqual(scene.source_refs?.[0].paragraph_start ?? 1);
      expect(scene.source_refs?.[0].excerpt).toBeTruthy();
      expect(scene.adaptation?.ai_edits.length).toBeGreaterThan(0);
      expect(scene.adaptation?.ai_edits[0].note).toBeTruthy();
    }
  });

  it("从对白中抽取到人物", () => {
    const names = screenplay.characters.map((c) => c.name);
    expect(names).toContain("沈砚");
    expect(names.length).toBeGreaterThanOrEqual(2);
  });

  it("抽取到地点（含客栈）", () => {
    const locNames = screenplay.locations.map((l) => l.name).join(",");
    expect(locNames).toMatch(/客栈|城|街|楼/);
  });

  it("source.chapter_count >= 3", () => {
    expect(screenplay.source.chapter_count).toBeGreaterThanOrEqual(3);
  });

  it("坐实古风称谓人物并补齐场景数据字段", () => {
    const hsChapters = parseChapters(hanshanNovel);
    const hsScreenplay = generateMockScreenplay(hsChapters, { novelTitle: "寒山寺" });
    const names = hsScreenplay.characters.map((c) => c.name);

    expect(validateScreenplay(hsScreenplay).valid).toBe(true);
    expect(names).toContain("白衣女子");
    expect(names).toContain("老方丈");
    expect(names).toContain("灰衣僧人");
    expect(names).toContain("知客僧");
    expect(names).not.toContain("白衣女");

    const nightScene = hsScreenplay.scenes.find((scene) => scene.source_chapter === 2);
    expect(nightScene?.characters).toContain(hsScreenplay.characters.find((c) => c.name === "灰衣僧人")?.id);
    expect(nightScene?.conflict).toBeTruthy();
    expect(hsScreenplay.locations.some((loc) => loc.name.includes("寒山寺") && loc.source_chapters?.length)).toBe(true);
  });
});
