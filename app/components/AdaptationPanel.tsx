import type { AdaptationNote, OpenQuestion } from "@/lib/types";

interface AdaptationPanelProps {
  notes: AdaptationNote[];
  questions: OpenQuestion[];
}

/** 改编说明 + 待作者确认项：让 AI 的改动与不确定性可见、可审阅。 */
export default function AdaptationPanel({ notes, questions }: AdaptationPanelProps) {
  return (
    <div className="view notes">
      <h4>改编说明 Adaptation Notes</h4>
      {notes.length ? (
        notes.map((n, i) => (
          <div className="note-item" key={i}>
            <span className={`badge ${n.type}`}>{n.type}</span>
            <div className="body">
              {n.note}
              {n.scene_id ? <small>关联场次 {n.scene_id}</small> : null}
            </div>
          </div>
        ))
      ) : (
        <p className="empty-note">本次转换未记录全局改编说明。</p>
      )}

      <h4 className="spaced">待作者确认 Open Questions</h4>
      {questions.length ? (
        questions.map((q) => (
          <div className="note-item" key={q.id}>
            <span className="badge q">Q</span>
            <div className="body">
              {q.question}
              {q.context ? <small>{q.context}</small> : null}
            </div>
          </div>
        ))
      ) : (
        <p className="empty-note">没有待确认项 —— 原文信息较完整。</p>
      )}
    </div>
  );
}
