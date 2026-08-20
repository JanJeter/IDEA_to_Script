import { AnimatePresence, motion } from 'motion/react';
import { ArrowRight, Sparkles } from 'lucide-react';
import './CreationTransition.css';

type Props = {
  title: string;
  logline: string;
  visible: boolean;
};

const stages = ['故事内核', '人物档案', '场景空间', '情节节拍', '完整剧本'];

export function CreationTransition({ title, logline, visible }: Props) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          className="creation-transition"
          role="status"
          aria-live="polite"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.38 }}
        >
          <motion.div
            className="creation-transition-card"
            initial={{ y: 28, scale: 0.98, opacity: 0 }}
            animate={{ y: 0, scale: 1, opacity: 1 }}
            exit={{ y: -18, scale: 0.99, opacity: 0 }}
            transition={{ duration: 0.28, ease: [0.16, 1, 0.3, 1] }}
          >
            <div className="creation-transition-kicker"><Sparkles size={15} /> 创作档案正在建立</div>
            <h1>{title}</h1>
            <p className="creation-transition-logline">{logline}</p>
            <div className="creation-transition-rule" aria-hidden="true" />
            <ol className="creation-transition-stages">
              {stages.map((stage, index) => (
                <motion.li
                  key={stage}
                  initial={{ opacity: 0.28, x: -10 }}
                  animate={{ opacity: 1, x: 0 }}
                  transition={{ delay: 0.35 + index * 0.22, duration: 0.35 }}
                >
                  <span className="creation-transition-index">{String(index + 1).padStart(2, '0')}</span>
                  <span>{stage}</span>
                  <ArrowRight size={14} aria-hidden="true" />
                </motion.li>
              ))}
            </ol>
            <p className="creation-transition-note">先搭骨架，再让每一层内容长出来。</p>
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
