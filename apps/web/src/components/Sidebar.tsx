import { Check, Clapperboard, Film, Home, LogIn, LogOut, Plus, Trash2, UserRound } from 'lucide-react';
import type { AuthUser, ProjectSummary } from '../types';

type Props = {
  projects: ProjectSummary[];
  sample: ProjectSummary;
  user?: AuthUser | null;
  selectedId?: string;
  onHome: () => void;
  onSelectSample: () => void;
  onSelect: (id: string) => void;
  onCreate: () => void;
  onDelete: (id: string) => void;
  onLogin: () => void;
  onLogout: () => void;
};

const statusText = {
  DRAFT: '待生成',
  GENERATING: '创作中',
  REVIEWING: '待确认',
  READY: '初稿完成',
  FAILED: '需重试',
} as const;

export function Sidebar({
  projects,
  sample,
  user,
  selectedId,
  onHome,
  onSelectSample,
  onSelect,
  onCreate,
  onDelete,
  onLogin,
  onLogout,
}: Props) {
  return (
    <aside className="sidebar">
      <button className="brand-lockup" type="button" onClick={onHome} aria-label="返回首页">
        <span className="brand-mark"><Clapperboard size={22} strokeWidth={1.7} /></span>
        <span>
          <strong>IDEA / SCRIPT</strong>
          <small>AI WRITERS' ROOM</small>
        </span>
        <Home className="brand-home" size={14} />
      </button>

      <div className="library-heading">
        <span>完整示例</span>
        <span>PIN</span>
      </div>

      <button
        type="button"
        className={`sample-project-item ${selectedId === sample.id ? 'active' : ''}`}
        onClick={onSelectSample}
      >
        <span className="sample-project-check"><Check size={12} /></span>
        <span><strong>{sample.title}</strong><small>{sample._count.scenes} 场 · {sample.targetMinutes} 分钟 · 只读</small></span>
      </button>

      <div className="library-heading user-library-heading">
        <span>我的项目</span>
        <span>{projects.length} / 5</span>
      </div>

      <nav className="project-list" aria-label="故事项目">
        {projects.map((project, index) => (
          <button
            type="button"
            key={project.id}
            className={`project-item ${selectedId === project.id ? 'active' : ''}`}
            onClick={() => onSelect(project.id)}
          >
            <span className="project-index">{String(index + 1).padStart(2, '0')}</span>
            <span className="project-copy">
              <strong>{project.title}</strong>
              <small>{project.genre} · {statusText[project.status]}</small>
              <em>{expiryText(project.expiresAt)}</em>
            </span>
            <span
              className="project-delete"
              role="button"
              tabIndex={0}
              aria-label={`删除 ${project.title}`}
              onClick={(event) => { event.stopPropagation(); onDelete(project.id); }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') { event.stopPropagation(); onDelete(project.id); }
              }}
            >
              <Trash2 size={14} />
            </span>
          </button>
        ))}
        {projects.length === 0 && (
          <div className="empty-library">
            <Film size={24} strokeWidth={1.4} />
            <span>还没有自己的故事</span>
          </div>
        )}
      </nav>

      <button type="button" className="new-project-button" onClick={onCreate}>
        <Plus size={17} />
        <span>新建故事</span>
      </button>

      {user ? (
        <div className="sidebar-footer sidebar-account">
          <span className="sidebar-account-name"><UserRound size={14} /><b>{user.username}</b></span>
          <button type="button" onClick={onLogout} aria-label="退出登录"><LogOut size={14} />退出</button>
        </div>
      ) : (
        <button className="sidebar-footer sidebar-login" type="button" onClick={onLogin}>
          <span><LogIn size={14} />登录后开始创作</span>
        </button>
      )}
    </aside>
  );
}

function expiryText(expiresAt: string | null) {
  if (!expiresAt) return '固定保留';
  const remaining = new Date(expiresAt).getTime() - Date.now();
  const days = Math.max(0, Math.ceil(remaining / (24 * 60 * 60 * 1000)));
  return days === 0 ? '今天过期' : `${days} 天后过期`;
}
