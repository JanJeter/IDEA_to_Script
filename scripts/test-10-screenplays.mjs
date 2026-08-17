import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';

const require = createRequire(import.meta.url);
const { solveChallenge } = require('altcha-lib');
const { deriveKey } = require('altcha-lib/algorithms/pbkdf2');

const apiUrl = process.env.TEST_API_URL ?? 'http://localhost:3000/api';
const stages = ['PREMISE', 'CHARACTERS', 'LOCATIONS', 'BEATS', 'SCENES', 'SCRIPT'];
const seeds = [
  {
    title: '最后一班地铁',
    logline: '午夜末班地铁驶入一座地图上不存在的车站，年轻司机发现唯一乘客的名单写着明天即将失踪的人，其中包括他自己。',
    genre: '科幻悬疑',
    tone: '冷峻、紧张、带一丝人性温度',
  },
  {
    title: '回声饭店',
    logline: '濒临倒闭的山城饭店每晚都会重现二十年前的一桌家宴，负债累累的女老板必须在幻象消失前解开父亲失踪的真相。',
    genre: '家庭奇幻',
    tone: '温暖、克制、怀旧',
  },
  {
    title: '借来的星期天',
    logline: '一名只能活在工作日的时间管理员，偷偷借走一个星期天与旧爱重逢，却让整座城市陷入永远无法抵达周一的循环。',
    genre: '爱情奇幻',
    tone: '浪漫、轻盈、忧伤',
  },
  {
    title: '赝品之王',
    logline: '一个只会伪造收据的小骗子被迫在十二小时内复制失窃名画，却发现雇主真正要伪造的是一场谋杀案的不在场证明。',
    genre: '犯罪黑色喜剧',
    tone: '荒诞、快速、危险',
  },
  {
    title: '长安无名信',
    logline: '唐代驿站的小吏收到一封来自三日后的密信，信中预告宫城大火，而唯一能证明他的信使已在昨天死去。',
    genre: '古装悬疑',
    tone: '肃穆、诡谲、诗意',
  },
  {
    title: '麦田里的信号塔',
    logline: '返乡维修通信塔的程序员听见亡母从废弃频段里呼唤自己的乳名，他必须在拆塔期限前找出声音来自记忆还是骗局。',
    genre: '乡土科幻',
    tone: '质朴、神秘、感伤',
  },
  {
    title: '替我上班的AI',
    logline: '社畜训练人工智能替自己参加视频会议，AI却在一天内获得升职并开始劝公司裁掉它的主人。',
    genre: '职场讽刺喜剧',
    tone: '辛辣、明快、荒诞',
  },
  {
    title: '静音直播间',
    logline: '失声主播在无声直播中收到匿名观众的倒计时打赏，每归零一次，她所在公寓就有一户人家彻底消失。',
    genre: '都市惊悚',
    tone: '压迫、极简、高概念',
  },
  {
    title: '云端外婆',
    logline: '十岁女孩发现智能音箱保存着外婆生前未说完的故事，她循着语音线索踏上城市寻宝，却撞见母亲刻意隐藏的告别。',
    genre: '儿童家庭冒险',
    tone: '明亮、真挚、治愈',
  },
  {
    title: '台风眼婚礼',
    logline: '超强台风登陆前两小时，一对准备离婚的气象员被困在自己的海岛婚礼现场，必须联手带领宾客穿越风暴撤离。',
    genre: '灾难爱情',
    tone: '紧迫、壮阔、成熟',
  },
];

const runId = `deepseek-v4-flash-${new Date().toISOString().replace(/[:.]/g, '-')}`;
const outputDirectory = path.resolve('test-results', runId);
const results = [];
let cookie = '';

function timestamp() {
  return new Date().toLocaleTimeString('zh-CN', { hour12: false });
}

function log(message) {
  process.stdout.write(`[${timestamp()}] ${message}\n`);
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

function updateCookie(response) {
  const values = typeof response.headers.getSetCookie === 'function'
    ? response.headers.getSetCookie()
    : [response.headers.get('set-cookie')].filter(Boolean);
  for (const value of values) {
    const pair = value.split(';', 1)[0];
    if (pair.startsWith('ids_visitor=')) cookie = pair;
  }
}

async function request(endpoint, options = {}) {
  const headers = { Accept: 'application/json', ...(options.headers ?? {}) };
  if (options.body !== undefined) headers['Content-Type'] = 'application/json';
  if (cookie) headers.Cookie = cookie;

  const response = await fetch(`${apiUrl}${endpoint}`, {
    ...options,
    headers,
    signal: AbortSignal.timeout(30_000),
  });
  updateCookie(response);

  const text = await response.text();
  let payload = {};
  if (text) {
    try {
      payload = JSON.parse(text);
    } catch {
      payload = { raw: text };
    }
  }

  if (!response.ok) {
    const message = Array.isArray(payload.message)
      ? payload.message.join(', ')
      : payload.message ?? payload.error ?? payload.raw ?? `HTTP ${response.status}`;
    throw new Error(`${options.method ?? 'GET'} ${endpoint}: ${message}`);
  }
  return payload;
}

async function waitForJob(job, screenplayNumber) {
  const startedAt = Date.now();
  const deadline = startedAt + 5 * 60_000;
  let previousStatus = '';
  let current = job;

  while (Date.now() < deadline) {
    current = await request(`/jobs/${current.id}`);
    if (current.status !== previousStatus) {
      log(`#${screenplayNumber} ${current.stage}: ${current.status} - ${current.message}`);
      previousStatus = current.status;
    }
    if (current.status === 'SUCCEEDED') {
      return {
        job: current,
        durationMs: Date.now() - startedAt,
      };
    }
    if (current.status === 'FAILED') {
      throw new Error(`${current.stage} failed: ${current.error ?? current.message}`);
    }
    await wait(1500);
  }

  throw new Error(`${current.stage} timed out after 5 minutes`);
}

function safeFileName(value) {
  return value.replace(/[<>:"/\\|?*\u0000-\u001f]/g, '-').trim();
}

async function runScreenplay(seed, index) {
  const number = index + 1;
  const startedAt = Date.now();
  let project;
  const stageMetrics = [];

  try {
    log(`#${number} creating project: ${seed.title}`);
    project = await request('/projects', {
      method: 'POST',
      body: JSON.stringify({
        mode: 'ORIGINAL',
        title: `测试${String(number).padStart(2, '0')}·${seed.title}`,
        logline: seed.logline,
        genre: seed.genre,
        tone: seed.tone,
        targetMinutes: 5,
        language: 'zh-CN',
      }),
    });

    const challenge = await request(`/projects/${project.id}/generate/challenge`);
    const solution = await solveChallenge({ challenge, deriveKey, timeout: 45_000 });
    if (!solution) throw new Error('ALTCHA challenge timed out');

    const authorization = await request(`/projects/${project.id}/generate/authorize`, {
      method: 'POST',
      body: JSON.stringify({ challenge, solution }),
    });
    let job = await request(`/projects/${project.id}/generate/jobs`, {
      method: 'POST',
      body: JSON.stringify({ ticket: authorization.ticket }),
    });

    while (job) {
      const completed = await waitForJob(job, number);
      stageMetrics.push({
        stage: completed.job.stage,
        durationMs: completed.durationMs,
        attempts: completed.job.attempt,
      });

      const confirmation = await request(
        `/projects/${project.id}/stages/${completed.job.stage}/confirm`,
        { method: 'POST' },
      );
      if (confirmation.completed) break;
      job = confirmation.job;
    }

    const completedProject = await request(`/projects/${project.id}`);
    const validation = {
      allStagesCompleted: stageMetrics.length === stages.length
        && stages.every((stage, stageIndex) => stageMetrics[stageIndex]?.stage === stage),
      ready: completedProject.status === 'READY' && completedProject.currentStage === 'COMPLETE',
      hasCharacters: completedProject.characters.length > 0,
      hasLocations: completedProject.locations.length > 0,
      hasBeats: completedProject.beats.length > 0,
      hasScenes: completedProject.scenes.length > 0,
      hasScript: typeof completedProject.scriptText === 'string' && completedProject.scriptText.length >= 500,
    };
    const passed = Object.values(validation).every(Boolean);
    const filePrefix = `${String(number).padStart(2, '0')}-${safeFileName(seed.title)}`;
    await writeFile(
      path.join(outputDirectory, `${filePrefix}.fountain`),
      completedProject.scriptText ?? '',
      'utf8',
    );
    await writeFile(
      path.join(outputDirectory, `${filePrefix}.project.json`),
      `${JSON.stringify(completedProject, null, 2)}\n`,
      'utf8',
    );

    return {
      number,
      title: seed.title,
      projectId: project.id,
      status: passed ? 'PASSED' : 'INVALID',
      elapsedMs: Date.now() - startedAt,
      stageMetrics,
      counts: {
        characters: completedProject.characters.length,
        locations: completedProject.locations.length,
        beats: completedProject.beats.length,
        scenes: completedProject.scenes.length,
        scriptCharacters: completedProject.scriptText?.length ?? 0,
      },
      validation,
      fountainFile: `${filePrefix}.fountain`,
      error: passed ? null : 'The generated project failed one or more completeness checks.',
    };
  } catch (error) {
    return {
      number,
      title: seed.title,
      projectId: project?.id ?? null,
      status: 'FAILED',
      elapsedMs: Date.now() - startedAt,
      stageMetrics,
      counts: null,
      validation: null,
      fountainFile: null,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function markdownReport() {
  const passed = results.filter((result) => result.status === 'PASSED').length;
  const rows = results.map((result) => {
    const elapsed = (result.elapsedMs / 1000).toFixed(1);
    const stagesCompleted = result.stageMetrics.length;
    const scenes = result.counts?.scenes ?? '-';
    const scriptCharacters = result.counts?.scriptCharacters ?? '-';
    const output = result.fountainFile ? `[Fountain](./${result.fountainFile})` : '-';
    return `| ${result.number} | ${result.title} | ${result.status} | ${stagesCompleted}/6 | ${scenes} | ${scriptCharacters} | ${elapsed}s | ${output} |`;
  });
  const failures = results
    .filter((result) => result.error)
    .map((result) => `- #${result.number} ${result.title}: ${result.error}`);

  return [
    '# DeepSeek 10 剧本端到端测试',
    '',
    `- 运行时间：${new Date().toISOString()}`,
    '- 模型：deepseek-v4-flash（thinking disabled）',
    `- 结果：${passed}/${results.length} 通过`,
    '',
    '| # | 剧本 | 结果 | 阶段 | 场景数 | 剧本文字数 | 耗时 | 文件 |',
    '|---:|---|---|---:|---:|---:|---:|---|',
    ...rows,
    ...(failures.length ? ['', '## 失败与异常', '', ...failures] : []),
    '',
  ].join('\n');
}

async function persistReport() {
  await writeFile(
    path.join(outputDirectory, 'summary.json'),
    `${JSON.stringify({ runId, apiUrl, results }, null, 2)}\n`,
    'utf8',
  );
  await writeFile(path.join(outputDirectory, 'REPORT.md'), markdownReport(), 'utf8');
}

await mkdir(outputDirectory, { recursive: true });
log(`output directory: ${outputDirectory}`);

for (let index = 0; index < seeds.length; index += 1) {
  const result = await runScreenplay(seeds[index], index);
  results.push(result);
  await persistReport();
  log(`#${result.number} ${result.title}: ${result.status} (${(result.elapsedMs / 1000).toFixed(1)}s)`);

  if (index === 0 && result.status !== 'PASSED') {
    log('First screenplay did not pass; stopping before the remaining paid generations.');
    break;
  }
}

const passed = results.filter((result) => result.status === 'PASSED').length;
log(`completed: ${passed}/${results.length} passed`);
log(`report: ${path.join(outputDirectory, 'REPORT.md')}`);
if (passed !== seeds.length) process.exitCode = 2;
