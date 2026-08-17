import type { Project } from '@prisma/client';
import type {
  BeatResult,
  CharacterRelationshipResult,
  CharacterResult,
  LocationResult,
  PremiseResult,
  ScenePlanResult,
  WrittenSceneResult,
} from './generation.types';

export const mockPremise = (project: Project): PremiseResult => ({
  title: project.title,
  premise: `${project.logline} 故事在有限时间与空间中展开，人物必须用一次不可逆的选择证明自己真正相信什么。`,
  synopsis: `在一座永远醒着的城市里，顾言因“${project.logline}”卷入一场看似偶然的事件。陌生人苏弥掌握着关键线索，却只肯用谜语交换信任。随着倒计时逼近，顾言发现真正需要修复的不是眼前的故障，而是自己多年前逃避的一次选择。两人在罗队的追查下抵达事件核心，最终以失去某样珍贵之物为代价，让真相被看见。`,
  theme: '人只有停止修补表面，才可能面对真正的裂缝。',
});

export const mockCharacters = (): CharacterResult[] => [
  {
    name: '顾言',
    role: 'protagonist',
    age: '29',
    description: '习惯把情绪藏进工作流程的技术员，观察力强，却害怕承担选择的后果。',
    goal: '在天亮前解决异常并保住自己的工作。',
    conflict: '越依赖规则，越无法处理眼前这个没有标准答案的人。',
    arc: '从修补故障的旁观者，变成愿意为真相承担代价的行动者。',
    voice: '短句、精确、回避感受；紧张时会重复技术术语。',
  },
  {
    name: '苏弥',
    role: 'catalyst',
    age: '24',
    description: '带着旧录音机的陌生乘客，敏锐、冷静，像是早已排练过这次相遇。',
    goal: '让一段被掩盖的声音在城市醒来前重新出现。',
    conflict: '她需要顾言帮助，却无法完全信任一个曾经选择沉默的人。',
    arc: '从把顾言当工具，到允许他共同决定真相应该如何被看见。',
    voice: '用具体意象代替解释，语气平静，关键时刻直呼对方全名。',
  },
  {
    name: '罗队',
    role: 'antagonistic force',
    age: '45',
    description: '负责夜间调度的主管，相信秩序比个体真相更重要。',
    goal: '在早高峰前封锁异常，避免系统性恐慌。',
    conflict: '他保护城市的方式，正是让旧错误继续存在的原因。',
    arc: '从掌控一切，到第一次被迫听见自己下令删除的声音。',
    voice: '命令式，几乎不用形容词；愤怒时反而变得礼貌。',
  },
];

export const mockRelationships = (): CharacterRelationshipResult[] => [
  {
    sourceIndex: 0,
    targetIndex: 1,
    type: '互相试探的盟友',
    description: '顾言需要苏弥掌握的线索，苏弥则迫使顾言面对旧日沉默；两人的信任在共同冒险中增长。',
    strength: 5,
    directed: false,
  },
  {
    sourceIndex: 2,
    targetIndex: 0,
    type: '上级与反抗者',
    description: '罗队以职权要求顾言服从封锁流程，顾言最终拒绝命令并公开真相。',
    strength: 4,
    directed: true,
  },
  {
    sourceIndex: 2,
    targetIndex: 1,
    type: '追捕者与揭密者',
    description: '罗队试图阻止苏弥公开被掩盖的声音，苏弥则把他的秩序观逼到崩溃边缘。',
    strength: 4,
    directed: true,
  },
];

export const mockLocations = (): LocationResult[] => [
  {
    name: '废弃站台',
    description: '被新线路绕开的旧站台，墙砖潮湿，广告牌停在很多年前。',
    atmosphere: '空旷、回声清晰，像一段不肯结束的记忆。',
    recurringElements: '闪烁的绿灯、积水倒影、远处规律的金属敲击声。',
  },
  {
    name: '夜间控制室',
    description: '布满监视器和线路图的狭长房间，所有屏幕都比人脸更亮。',
    atmosphere: '高度可控，却始终有一块画面无法解释。',
    recurringElements: '红色倒计时、纸杯、被静音的警报。',
  },
  {
    name: '检修隧道',
    description: '仅容两人并行的隧道，电缆像血管一样沿墙延伸。',
    atmosphere: '逼仄、危险，每一步都在接近城市不愿承认的内部。',
    recurringElements: '头灯光束、风压、旧编号 017。',
  },
];

export const mockBeats = (project: Project): BeatResult[] => [
  { act: 1, sequence: 1, title: '错误的回声', summary: `顾言值夜时发现与“${project.logline}”有关的异常信号。`, emotionalShift: '从麻木到警觉' },
  { act: 1, sequence: 2, title: '不在名单上的乘客', summary: '苏弥从封闭区域出现，拿出一段只能在旧线路播放的录音。', emotionalShift: '从警觉到怀疑' },
  { act: 2, sequence: 3, title: '第一次封锁', summary: '罗队远程关闭出口，要求顾言交出乘客并删除记录。', emotionalShift: '从怀疑到被迫结盟' },
  { act: 2, sequence: 4, title: '017 号隧道', summary: '两人进入检修隧道，顾言发现异常与自己多年前签署的报告有关。', emotionalShift: '从自保到羞愧' },
  { act: 2, sequence: 5, title: '沉默的价格', summary: '苏弥承认她真正要公开的是一段会让顾言同时失去工作的证据。', emotionalShift: '从结盟到决裂' },
  { act: 3, sequence: 6, title: '全城广播', summary: '顾言放弃安全退路，将录音接入早高峰广播，迫使所有人听见。', emotionalShift: '从逃避到承担' },
];

export const mockScenePlans = (project: Project, beats: BeatResult[]): ScenePlanResult[] => {
  const headings = [
    ['INT. 夜间控制室 - 深夜', '夜间控制室', '深夜'],
    ['INT. 废弃站台 - 深夜', '废弃站台', '深夜'],
    ['INT. 废弃站台 - 连续', '废弃站台', '连续'],
    ['INT. 017号检修隧道 - 深夜', '检修隧道', '深夜'],
    ['INT. 隧道设备间 - 黎明前', '检修隧道', '黎明前'],
    ['INT. 夜间控制室 - 黎明', '夜间控制室', '黎明'],
  ];
  const seconds = Math.max(35, Math.floor((project.targetMinutes * 60) / beats.length));
  return beats.map((beat, index) => ({
    sceneNumber: index + 1,
    beatSequence: beat.sequence,
    heading: headings[index]?.[0] ?? `INT. 主场景 - 夜`,
    location: headings[index]?.[1] ?? '主场景',
    timeOfDay: headings[index]?.[2] ?? '夜',
    summary: beat.summary,
    estimatedSeconds: seconds,
  }));
};

export const mockWrittenScenes = (
  scenes: ScenePlanResult[],
  characters: CharacterResult[],
): WrittenSceneResult[] => {
  const protagonist = characters[0]?.name ?? '主角';
  const catalyst = characters[1]?.name ?? '陌生人';
  const authority = characters[2]?.name ?? '主管';
  const action = [
    '所有监视器同时跳过一帧。顾言停下笔，把声音推子拉到底。一阵不属于线路系统的呼吸声从音箱里传来。红色波形在屏幕上重复，间隔十七秒。',
    '废弃站台的灯依次亮起，像有人正从隧道深处走来。苏弥站在黄线外，手里那台旧录音机仍在转动，却没有插电。',
    '卷帘门猛地落下。绿色出口灯熄灭，只剩紧急电话闪烁。顾言看向摄像头，又看向苏弥递来的磁带，没有接。',
    '两束头灯切开黑暗。墙上的旧编号被新漆覆盖，顾言用手套擦开“017”。风从本该封死的岔道涌来，带着广播测试音。',
    '设备柜里藏着一台仍在运行的备份机。屏幕显示顾言多年前的电子签名。苏弥按下播放键，一群人的声音挤进狭小房间。',
    '控制室外，天色把玻璃染成灰蓝。顾言将旧线路接入公共广播。所有警报同时亮起，他没有静音。城市停顿了一秒，然后听见了那段声音。',
  ];
  const dialogue: WrittenSceneResult['dialogue'][] = [
    [
      { character: protagonist, text: '线路里没有人。' },
      { character: authority, parenthetical: '耳机中', text: '那就别回答。把它当噪声。' },
      { character: protagonist, text: '噪声不会准时回来。' },
    ],
    [
      { character: catalyst, text: '你晚了十七秒。' },
      { character: protagonist, text: '这里不该有人。' },
      { character: catalyst, text: '这句话，你们七年前也说过。' },
    ],
    [
      { character: authority, parenthetical: '广播中', text: `${protagonist}，把乘客留在原地。` },
      { character: catalyst, text: '他知道我的名字，却只叫我乘客。' },
      { character: protagonist, text: '你到底要我修什么？' },
      { character: catalyst, text: '不是修。是让它响完。' },
    ],
    [
      { character: protagonist, text: '017 在图纸上已经不存在。' },
      { character: catalyst, text: '图纸很擅长忘记。墙不擅长。' },
      { character: protagonist, parenthetical: '看见编号', text: '这份封存报告……是我签的。' },
    ],
    [
      { character: catalyst, text: '播出去，你会和他们一起被记住。' },
      { character: protagonist, text: '不播呢？' },
      { character: catalyst, text: '你已经试过七年了。' },
      { character: authority, parenthetical: '耳机中', text: '顾先生，请你最后一次按流程处理。' },
    ],
    [
      { character: protagonist, text: '流程编号，零一七。故障原因：人为静音。' },
      { character: authority, text: '切断它。' },
      { character: protagonist, parenthetical: '推起总控', text: '正在恢复。' },
    ],
  ];

  return scenes.map((scene, index) => ({
    sceneNumber: scene.sceneNumber,
    action: action[index] ?? `${scene.summary} 空间里的细节迫使人物作出选择。`,
    dialogue: dialogue[index] ?? [{ character: protagonist, text: '现在轮到我们决定了。' }],
  }));
};
