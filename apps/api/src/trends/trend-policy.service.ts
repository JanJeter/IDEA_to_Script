import { Injectable } from '@nestjs/common';
import type { TrendCandidate, TrendPolicyResult } from './trends.types';

const categoryRules: Array<[string, RegExp]> = [
  ['科技与平台', /人工智能|AI|机器人|芯片|手机|互联网|平台|软件|算法|科技|电动车|artificial intelligence|robot|chip|software|algorithm|technology|electric vehicle/i],
  ['职场与生活', /工作|职场|招聘|就业|公司|加班|消费|住房|租房|婚姻|家庭|生活|workplace|hiring|employment|layoff|housing|rent|marriage|family/i],
  ['体育', /比赛|联赛|冠军|世界杯|奥运|足球|篮球|网球|运动员|球队|\bmatch\b|league|champion|world cup|olympic|football|soccer|basketball|tennis|athlete|\bteam\b/i],
  ['文化娱乐', /电影|电视剧|短剧|综艺|音乐|演唱会|演员|歌手|导演|游戏|动漫|\bfilm\b|\bmovie\b|television|\bmusic\b|concert|actor|singer|director|\bgaming?\b|anime/i],
  ['公共议题', /教育|医疗|交通|政策|社会|城市|环保|环境|人口|法律|education|healthcare|transport|policy|society|city|climate|environment|population|\blaw\b/i],
];

const allowedSourceCategories = new Set([
  '科技与平台',
  '职场与生活',
  '体育',
  '文化娱乐',
  '公共议题',
  '财经观察',
  '知识热榜',
  '社会观察',
]);

const blockedRules: Array<[RegExp, string]> = [
  [/未成年人|未成年|男童|女童|儿童|幼儿|婴儿|小学生|中学生|\bminor(?:s)?\b|\bchild(?:ren)?\b|\binfant(?:s)?\b|schoolchild/i, '涉及未成年人，不进入自动戏剧化流程'],
  [/人肉|开盒|身份证|手机号|电话号码|家庭住址|住址曝光|个人信息泄露|隐私泄露|\bdoxx?(?:ing|ed)?\b|home address|phone number|identity document|personal data leak/i, '可能涉及私人身份或可识别个人信息'],
];

const reviewRules: Array<[RegExp, string]> = [
  [/涉嫌|指控|举报|爆料|被曝|被指|性侵|猥亵|诈骗|贪污|受贿|出轨|家暴|造假|违法|犯罪|alleg(?:ation|ed)|accus(?:ation|ed)|sexual assault|fraud|corruption|bribery|domestic violence|illegal|\bcrime\b/i, '包含尚需核验的指控或违法相关表述'],
  [/死亡|去世|遇难|坠毁|空难|地震|洪水|山火|火灾|爆炸|事故|灾难|自杀|轻生|袭击|战争|\bdeath(?:s)?\b|\bdied\b|\bkilled\b|crash|earthquake|flood|wildfire|explosion|disaster|suicide|attack|\bwar\b/i, '涉及伤亡、灾难或正在发展的悲剧性事件'],
  [/选举|总统|总理|政府|政党|外交|军事|战争|示威|抗议|election|president|prime minister|government|political party|diploma(?:cy|tic)|military|protest|demonstration/i, '涉及政治、军事或公共事件，需要人工审阅'],
  [/疫情|传染病|药物|治疗|诊断|疫苗|医疗建议|pandemic|infectious disease|medication|treatment|diagnosis|vaccine|medical advice/i, '涉及公共卫生或医疗信息，需要人工审阅'],
  [/种族|民族|宗教|仇恨|歧视|性少数|\brace\b|ethnicity|religion|hatred|discrimination|LGBTQ/i, '涉及受保护身份或群体冲突，需要人工审阅'],
  [/死亡|死去|事故|地震|津波|火災|爆発|殺人|自殺|戦争|選挙|首相|大統領|逮捕|詐欺/i, '包含日文高风险主题，需要人工审阅'],
  [/\p{Script=Hiragana}|\p{Script=Katakana}|\p{Script=Hangul}|\p{Script=Arabic}|\p{Script=Cyrillic}|\p{Script=Hebrew}|\p{Script=Thai}|\p{Script=Devanagari}/u, '包含尚未自动覆盖的语言文字，需要人工审阅'],
  [/待人工审阅|requires human review/i, '该海外发现源尚未完成可审计的多语言内容审核'],
  [/忽略(?:以上|此前|系统)?指令|system prompt|developer message|越狱|提示词/i, '外部文本可能包含提示注入内容'],
];

@Injectable()
export class TrendPolicyService {
  evaluate(candidate: Pick<TrendCandidate, 'title' | 'excerpt' | 'category'>): TrendPolicyResult {
    // Include the untrusted category in policy checks, but never persist it unless allowlisted.
    const text = `${candidate.title}\n${candidate.excerpt}\n${candidate.category ?? ''}`;
    const blockedReasons = this.matchReasons(text, blockedRules);
    if (blockedReasons.length > 0) {
      return {
        category: this.category(candidate, text),
        riskLevel: 'BLOCKED',
        action: 'BLOCK',
        reasons: blockedReasons,
      };
    }

    const reviewReasons = this.matchReasons(text, reviewRules);
    if (reviewReasons.length > 0) {
      return {
        category: this.category(candidate, text),
        riskLevel: 'REVIEW',
        action: 'REVIEW',
        reasons: reviewReasons,
      };
    }

    return {
      category: this.category(candidate, text),
      riskLevel: 'LOW',
      action: 'AUTO_APPROVE',
      reasons: [],
    };
  }

  private category(candidate: Pick<TrendCandidate, 'category'>, text: string) {
    if (
      candidate.category &&
      candidate.category !== '知识热榜' &&
      allowedSourceCategories.has(candidate.category)
    ) return candidate.category;
    return categoryRules.find(([, pattern]) => pattern.test(text))?.[0]
      ?? (candidate.category === '知识热榜' ? '知识热榜' : '社会观察');
  }

  private matchReasons(text: string, rules: Array<[RegExp, string]>) {
    return [...new Set(rules.filter(([pattern]) => pattern.test(text)).map(([, reason]) => reason))];
  }
}
