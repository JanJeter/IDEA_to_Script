// 全项目共享的类型定义。这些类型与 schema/screenplay.schema.json 保持一致。

export interface Chapter {
  index: number; // 从 1 开始
  title: string;
  content: string; // 保留原文
  summary?: string; // 摘要（解析阶段为截取式，AI 阶段为模型生成）
}

export type ElementType = "dialogue" | "action" | "narration" | "transition";

export interface SceneElement {
  type: ElementType;
  character_id?: string;
  character_name?: string;
  text: string;
  parenthetical?: string;
  emotion?: string;
}

export type TimeOfDay =
  | "dawn"
  | "morning"
  | "noon"
  | "afternoon"
  | "evening"
  | "night"
  | "unspecified";

export interface Scene {
  id: string;
  heading: string;
  slug?: string;
  location_id?: string;
  time?: TimeOfDay;
  source_chapter?: number;
  summary?: string;
  characters?: string[];
  mood?: string;
  pace?: "slow" | "medium" | "fast" | "unspecified";
  conflict?: string;
  elements: SceneElement[];
}

export interface Character {
  id: string;
  name: string;
  aliases?: string[];
  role?: "protagonist" | "antagonist" | "supporting" | "minor" | "narrator" | "unknown";
  description?: string;
  traits?: string[];
  arc?: string;
}

export interface Location {
  id: string;
  name: string;
  type?: "interior" | "exterior" | "mixed" | "unknown";
  description?: string;
  source_chapters?: number[];
}

export interface TimelineNode {
  id: string;
  order: number;
  label: string;
  time_of_day?: TimeOfDay;
  description?: string;
  related_scenes?: string[];
}

export interface AdaptationNote {
  scene_id?: string;
  type: "compression" | "merge" | "cut" | "inference" | "reorder" | "other";
  note: string;
}

export interface OpenQuestion {
  id: string;
  question: string;
  context?: string;
  scene_id?: string;
}

export interface Screenplay {
  metadata: {
    title: string;
    logline?: string;
    genre?: string[];
    format: "film" | "tv" | "short" | "stage" | "radio" | "drama";
    language: string;
    created_at?: string;
    generator?: string;
  };
  source: {
    novel_title: string;
    author?: string;
    chapter_count: number;
    total_length?: number;
    source_chapters?: { index: number; title: string; summary?: string }[];
  };
  characters: Character[];
  locations: Location[];
  timeline: TimelineNode[];
  acts?: { id: string; title: string; summary?: string; scene_ids: string[] }[];
  episodes?: { id: string; title: string; summary?: string; scene_ids: string[] }[];
  scenes: Scene[];
  adaptation_notes?: AdaptationNote[];
  open_questions?: OpenQuestion[];
}

export interface PipelineStep {
  key: string;
  label: string;
  status: "pending" | "running" | "done" | "failed";
  detail?: string;
}
