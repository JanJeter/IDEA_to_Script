import { ArrowRight, Sparkles } from 'lucide-react';
import './CreationTransition.css';

type Props = {
  title: string;
  logline: string;
  visible: boolean;
};

const stages = ['故事内核', '人物档案', '场景空间', '情节节拍', '完整剧本'];

export function CreationTransition({ title, logline, visible }: Props) {
  if (!visible) return null;

  return (
    <div className="creation-transition" role="status" aria-live="polite">
      <div className="creation-transition-card">
            <div className="creation-transition-kicker"><Sparkles size={15} /> 创作档案正在建立</div>
            <h1>{title}</h1>
            <p className="creation-transition-logline">{logline}</p>
            <div className="creation-transition-rule" aria-hidden="true" />
            <ol className="creation-transition-stages">
              {stages.map((stage, index) => (
                <li key={stage}>
                  <span className="creation-transition-index">{String(index + 1).padStart(2, '0')}</span>
                  <span>{stage}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </li>
              ))}
            </ol>
            <p className="creation-transition-note">先搭骨架，再让每一层内容长出来。</p>
      </div>
    </div>
  );
}
