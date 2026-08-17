import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import {
  Focus,
  Minus,
  Plus,
  RefreshCw,
  Route,
  Users,
} from 'lucide-react';
import ForceGraph2D from 'react-force-graph-2d';
import type { ForceGraphMethods, LinkObject, NodeObject } from 'react-force-graph-2d';
import {
  buildCharacterGraphData,
  pointAlongRelationship,
} from './CharacterGraph.data';
import type {
  CharacterNode,
  GraphCharacter,
  RelationshipInput,
  RelationshipLink,
} from './CharacterGraph.data';

type Props = {
  characters: GraphCharacter[];
  relationships: RelationshipInput[];
};

function useContainerSize(container: React.RefObject<HTMLDivElement | null>) {
  const [size, setSize] = useState({ width: 760, height: 540 });

  useLayoutEffect(() => {
    const element = container.current;
    if (!element) return;

    const update = (width: number, height: number) => {
      if (width > 0 && height > 0) {
        setSize({ width: Math.floor(width), height: Math.floor(height) });
      }
    };
    const rect = element.getBoundingClientRect();
    update(rect.width, rect.height);

    if (typeof ResizeObserver === 'undefined') return;
    const observer = new ResizeObserver(([entry]) => {
      update(entry.contentRect.width, entry.contentRect.height);
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [container]);

  return size;
}

function endpoint(value: string | number | NodeObject<CharacterNode> | undefined) {
  return typeof value === 'object' && value ? value : undefined;
}

export default function CharacterGraph({ characters, relationships }: Props) {
  const graphData = useMemo(
    () => buildCharacterGraphData(characters, relationships),
    [characters, relationships],
  );
  const graphRef = useRef<ForceGraphMethods<CharacterNode, RelationshipLink> | undefined>(undefined);
  const canvasWrapRef = useRef<HTMLDivElement>(null);
  const fittedRef = useRef(false);
  const { width, height } = useContainerSize(canvasWrapRef);
  const [selectedNodeId, setSelectedNodeId] = useState(graphData.nodes[0]?.id ?? '');
  const [selectedLinkId, setSelectedLinkId] = useState('');

  useEffect(() => {
    setSelectedNodeId((current) => (
      current && graphData.nodes.some((node) => node.id === current)
        ? current
        : graphData.nodes[0]?.id ?? ''
    ));
    setSelectedLinkId((current) => (
      current && graphData.links.some((link) => link.id === current) ? current : ''
    ));
    fittedRef.current = false;
  }, [graphData]);

  useEffect(() => {
    const graph = graphRef.current;
    const linkForce = graph?.d3Force('link');
    linkForce?.distance?.((link: RelationshipLink) => 150 - link.strength * 10);
    const chargeForce = graph?.d3Force('charge');
    chargeForce?.strength?.(-420);
    graph?.d3ReheatSimulation();
  }, [graphData]);

  const selectedNode = graphData.nodes.find((node) => node.id === selectedNodeId);
  const selectedLink = graphData.links.find((link) => link.id === selectedLinkId);
  const connectedLinks = selectedNode
    ? graphData.links.filter((link) => {
        const source = endpoint(link.source)?.id ?? link.source;
        const target = endpoint(link.target)?.id ?? link.target;
        return source === selectedNode.id || target === selectedNode.id;
      })
    : [];

  const selectNode = useCallback((node: NodeObject<CharacterNode>) => {
    setSelectedNodeId(String(node.id));
    setSelectedLinkId('');
    if (typeof node.x === 'number' && typeof node.y === 'number') {
      graphRef.current?.centerAt(node.x, node.y, 350);
    }
  }, []);

  const selectLink = useCallback((link: LinkObject<CharacterNode, RelationshipLink>) => {
    setSelectedLinkId(link.id);
    setSelectedNodeId('');
  }, []);

  const fit = useCallback(() => graphRef.current?.zoomToFit(420, 72), []);

  const zoom = useCallback((factor: number) => {
    const current = graphRef.current?.zoom();
    if (typeof current === 'number') graphRef.current?.zoom(current * factor, 250);
  }, []);

  const resetLayout = useCallback(() => {
    graphData.nodes.forEach((node, index) => {
      const angle = (index / Math.max(graphData.nodes.length, 1)) * Math.PI * 2;
      const radius = 58 + index * 9;
      delete node.fx;
      delete node.fy;
      node.x = Math.cos(angle) * radius;
      node.y = Math.sin(angle) * radius;
      node.vx = 0;
      node.vy = 0;
    });
    fittedRef.current = false;
    graphRef.current?.d3ReheatSimulation();
  }, [graphData.nodes]);

  const paintNode = useCallback((node: NodeObject<CharacterNode>, context: CanvasRenderingContext2D, globalScale: number) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    const x = node.x as number;
    const y = node.y as number;
    const radius = 18 + Math.min(node.degree, 4) * 1.5;
    const selected = node.id === selectedNodeId;
    const initials = Array.from(node.name).slice(0, 2).join('');

    context.save();
    context.beginPath();
    context.arc(x, y, radius + (selected ? 5 : 0), 0, Math.PI * 2);
    context.fillStyle = selected ? 'rgba(213, 173, 98, .24)' : 'rgba(247, 246, 241, .07)';
    context.fill();
    context.beginPath();
    context.arc(x, y, radius, 0, Math.PI * 2);
    context.fillStyle = node.color;
    context.fill();
    context.lineWidth = selected ? 2.4 : 1;
    context.strokeStyle = selected ? '#f3dba9' : 'rgba(255, 252, 242, .72)';
    context.stroke();

    context.fillStyle = '#fffaf0';
    context.font = `600 ${10 / Math.max(globalScale, .35)}px "Noto Sans SC", sans-serif`;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(initials, x, y + .5);

    const fontSize = 13 / Math.max(globalScale, .35);
    context.font = `600 ${fontSize}px "Noto Sans SC", sans-serif`;
    const labelWidth = context.measureText(node.name).width + 14 / globalScale;
    const labelHeight = 22 / globalScale;
    const labelY = y + radius + 17 / globalScale;
    context.fillStyle = selected ? 'rgba(213, 173, 98, .96)' : 'rgba(25, 24, 21, .88)';
    context.fillRect(x - labelWidth / 2, labelY - labelHeight / 2, labelWidth, labelHeight);
    context.fillStyle = selected ? '#211f1c' : '#f7f2e7';
    context.fillText(node.name, x, labelY);
    context.restore();
  }, [selectedNodeId]);

  const paintNodePointer = useCallback((node: NodeObject<CharacterNode>, color: string, context: CanvasRenderingContext2D) => {
    if (!Number.isFinite(node.x) || !Number.isFinite(node.y)) return;
    context.fillStyle = color;
    context.beginPath();
    context.arc(node.x as number, node.y as number, 27, 0, Math.PI * 2);
    context.fill();
  }, []);

  const paintLinkLabel = useCallback((link: LinkObject<CharacterNode, RelationshipLink>, context: CanvasRenderingContext2D, globalScale: number) => {
    const source = endpoint(link.source);
    const target = endpoint(link.target);
    if (!source || !target || source.x == null || source.y == null || target.x == null || target.y == null) return;
    if (!Number.isFinite(source.x) || !Number.isFinite(source.y) || !Number.isFinite(target.x) || !Number.isFinite(target.y)) return;
    const { x, y } = pointAlongRelationship(
      { x: source.x, y: source.y },
      { x: target.x, y: target.y },
      link.curvature,
    );
    const fontSize = 11 / Math.max(globalScale, .35);
    context.save();
    context.font = `600 ${fontSize}px "Noto Sans SC", sans-serif`;
    const labelWidth = context.measureText(link.type).width + 12 / globalScale;
    const labelHeight = 19 / globalScale;
    context.fillStyle = link.id === selectedLinkId ? 'rgba(213, 173, 98, .98)' : 'rgba(39, 37, 32, .9)';
    context.fillRect(x - labelWidth / 2, y - labelHeight / 2, labelWidth, labelHeight);
    context.fillStyle = link.id === selectedLinkId ? '#211f1c' : '#d9d1c1';
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.fillText(link.type, x, y);
    context.restore();
  }, [selectedLinkId]);

  if (!characters.length) {
    return <div className="relationship-graph-empty"><Users size={24} /><p>还没有人物可以放进关系图谱。</p></div>;
  }

  return (
    <section className="relationship-graph" aria-label="人物关系知识图谱">
      <header className="relationship-graph-header">
        <div>
          <span>CHARACTER NETWORK</span>
          <h3>人物关系图谱</h3>
        </div>
        <div className="graph-counts" aria-label={`${graphData.nodes.length} 个人物，${graphData.links.length} 条关系`}>
          <span><strong>{String(graphData.nodes.length).padStart(2, '0')}</strong> 人物</span>
          <i />
          <span><strong>{String(graphData.links.length).padStart(2, '0')}</strong> 关系</span>
        </div>
      </header>

      <div className="relationship-graph-body">
        <div className="graph-canvas-column">
          <div className="graph-toolbar" aria-label="图谱缩放工具">
            <button type="button" onClick={() => zoom(1.3)} title="放大图谱" aria-label="放大图谱"><Plus size={16} /></button>
            <button type="button" onClick={() => zoom(1 / 1.3)} title="缩小图谱" aria-label="缩小图谱"><Minus size={16} /></button>
            <button type="button" onClick={fit} title="适应画布" aria-label="适应画布"><Focus size={16} /></button>
            <button type="button" onClick={resetLayout} title="重排关系" aria-label="重排关系"><RefreshCw size={15} /></button>
          </div>
          <div className="graph-canvas-wrap" ref={canvasWrapRef}>
            <ForceGraph2D<CharacterNode, RelationshipLink>
              ref={graphRef}
              width={width}
              height={height}
              graphData={graphData}
              backgroundColor="#1c1b18"
              nodeLabel={() => ''}
              nodeRelSize={24}
              nodeCanvasObjectMode={() => 'replace'}
              nodeCanvasObject={paintNode}
              nodePointerAreaPaint={paintNodePointer}
              linkLabel={() => ''}
              linkColor={(link) => link.id === selectedLinkId ? '#d5ad62' : 'rgba(218, 210, 194, .52)'}
              linkWidth={(link) => (link.id === selectedLinkId ? 2.5 : .65 + link.strength * .28)}
              linkCurvature={(link) => link.curvature}
              linkHoverPrecision={8}
              linkDirectionalArrowLength={(link) => link.directed ? 7 : 0}
              linkDirectionalArrowColor={(link) => link.id === selectedLinkId ? '#d5ad62' : '#a9a193'}
              linkDirectionalArrowRelPos={.74}
              linkCanvasObjectMode={() => 'after'}
              linkCanvasObject={paintLinkLabel}
              minZoom={.35}
              maxZoom={6}
              cooldownTicks={110}
              autoPauseRedraw
              onNodeClick={selectNode}
              onLinkClick={selectLink}
              onBackgroundClick={() => {
                setSelectedNodeId('');
                setSelectedLinkId('');
              }}
              onEngineStop={() => {
                if (!fittedRef.current) {
                  fittedRef.current = true;
                  fit();
                }
              }}
            />
          </div>
          <p className="graph-instructions">滚轮或双指缩放 · 拖动画布平移 · 拖动人物重新排列 · 点击节点或连线查看详情</p>
        </div>

        <aside className="graph-inspector" aria-live="polite">
          {selectedLink ? (
            <>
              <span className="graph-inspector-kicker">RELATIONSHIP</span>
              <h4>{selectedLink.type}</h4>
              <p>{selectedLink.description}</p>
              <dl>
                <div><dt>方向</dt><dd>{selectedLink.directed ? '单向影响' : '双向关系'}</dd></div>
                <div><dt>强度</dt><dd><span className="strength-meter">{[1, 2, 3, 4, 5].map((value) => <i className={value <= selectedLink.strength ? 'filled' : ''} key={value} />)}</span></dd></div>
              </dl>
            </>
          ) : selectedNode ? (
            <>
              <span className="graph-inspector-kicker">CHARACTER {String(selectedNode.index + 1).padStart(2, '0')}</span>
              <h4>{selectedNode.name}</h4>
              <em>{selectedNode.role}</em>
              <p>{selectedNode.description}</p>
              <dl>
                <div><dt>想要</dt><dd>{selectedNode.goal}</dd></div>
                <div><dt>阻力</dt><dd>{selectedNode.conflict}</dd></div>
              </dl>
              <div className="connection-list">
                <span>直接关系 · {connectedLinks.length}</span>
                {connectedLinks.map((link) => {
                  const source = endpoint(link.source)?.id ?? link.source;
                  const target = endpoint(link.target)?.id ?? link.target;
                  const otherId = source === selectedNode.id ? target : source;
                  const other = graphData.nodes.find((node) => node.id === otherId);
                  return (
                    <button type="button" key={link.id} onClick={() => selectLink(link)}>
                      <Route size={13} /><strong>{link.type}</strong><span>{other?.name}</span>
                    </button>
                  );
                })}
              </div>
            </>
          ) : (
            <div className="graph-inspector-idle"><Route size={23} /><h4>选择一条线索</h4><p>点击人物或关系线，查看这段关系在故事中的含义。</p></div>
          )}

          <nav className="graph-character-index" aria-label="图谱人物索引">
            {graphData.nodes.map((node) => (
              <button
                type="button"
                key={node.id}
                className={node.id === selectedNodeId ? 'active' : ''}
                onClick={() => selectNode(node)}
              >
                <i style={{ background: node.color }} />
                <span>{node.name}</span>
              </button>
            ))}
          </nav>
        </aside>
      </div>

      {!graphData.links.length && (
        <div className="graph-no-relations" role="status">
          <Route size={17} />
          <span>人物节点已就位，但这份旧稿还没有语义关系。重新生成“人物档案”后会自动补全关系类型与强度。</span>
        </div>
      )}
    </section>
  );
}
