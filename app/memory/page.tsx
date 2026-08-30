"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { marked } from "marked";

interface Memory {
  id: string;
  content: string;
  source: string;
  epistemicType: "user_statement" | "agent_inference" | "user_decision" | "system_observation";
  tags: string[];
  version: number;
  createdAt: number;
}

type View = "cards" | "timeline" | "tags" | "graph";

const EPISTEMIC_LABEL: Record<string, string> = {
  user_statement: "你说过",
  agent_inference: "我的推断",
  user_decision: "你的决定",
  system_observation: "系统记录",
};

const TAG_COLORS: Record<string, string> = {
  idea: "#7c3aed",
  commitment: "#b45309",
};

function html(markdown: string): { __html: string } {
  // Personal, locally-owned data rendered by the user's own browser — no untrusted third-party input.
  return { __html: marked.parse(markdown, { async: false }) as string };
}

function dayOf(epochMs: number): string {
  return new Date(epochMs).toLocaleDateString("zh-CN", { year: "numeric", month: "long", day: "numeric" });
}

export default function MemoryPage(): React.ReactElement {
  const [memories, setMemories] = useState<Memory[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [view, setView] = useState<View>("cards");
  const [selected, setSelected] = useState<Memory | null>(null);
  const [tagFilter, setTagFilter] = useState<string | null>(null);

  const allTags = useMemo(() => {
    const counts = new Map<string, number>();
    for (const memory of memories) {
      for (const tag of memory.tags) counts.set(tag, (counts.get(tag) ?? 0) + 1);
    }
    return [...counts.entries()].sort((left, right) => right[1] - left[1]);
  }, [memories]);

  const visible = useMemo(
    () => (tagFilter === null ? memories : memories.filter((memory) => memory.tags.includes(tagFilter))),
    [memories, tagFilter]
  );

  useEffect(() => {
    void fetch("/api/memories")
      .then(async (response) => response.json() as Promise<{ memories: Memory[] }>)
      .then((data) => setMemories(data.memories))
      .catch(() => setError("无法读取本地记忆。"));
  }, []);

  const byDay = useMemo(() => {
    const groups = new Map<string, Memory[]>();
    for (const memory of memories) {
      const day = dayOf(memory.createdAt);
      groups.set(day, [...(groups.get(day) ?? []), memory]);
    }
    return [...groups.entries()].sort((left, right) => (left[0] < right[0] ? 1 : -1));
  }, [memories]);

  const byTag = useMemo(() => {
    const groups = new Map<string, Memory[]>();
    for (const memory of memories) {
      const tags = memory.tags.length > 0 ? memory.tags : ["未标记"];
      for (const tag of tags) {
        groups.set(tag, [...(groups.get(tag) ?? []), memory]);
      }
    }
    return [...groups.entries()].sort((left, right) => right[1].length - left[1].length);
  }, [memories]);

  const graph = useMemo(() => {
    const sorted = [...memories].sort((left, right) => left.createdAt - right.createdAt);
    const cx = 400;
    const cy = 300;
    const golden = Math.PI * (3 - Math.sqrt(5));
    const nodes = sorted.map((memory, index) => {
      const angle = index * golden * 2.4 + 0.5;
      const radius = 36 + Math.sqrt(index) * 26;
      return {
        memory,
        x: cx + Math.cos(angle) * radius,
        y: cy + Math.sin(angle) * radius,
        r: 4 + Math.min(8, Math.sqrt(memory.content.length) / 3),
      };
    });
    const edges: Array<{ from: number; to: number }> = [];
    nodes.forEach((node, index) => {
      let links = 0;
      for (let cursor = index - 1; cursor >= 0 && links < 2; cursor -= 1) {
        const earlier = nodes[cursor];
        if (!earlier) break;
        const shared = node.memory.tags.some((tag) => earlier.memory.tags.includes(tag));
        if (shared) {
          edges.push({ from: cursor, to: index });
          links += 1;
        }
      }
    });
    // 星座标注：同一个标签聚了三个点以上，就在质心标出名字
    const tagGroups = new Map<string, Array<{ x: number; y: number }>>();
    nodes.forEach((node) => {
      for (const tag of node.memory.tags) {
        tagGroups.set(tag, [...(tagGroups.get(tag) ?? []), { x: node.x, y: node.y }]);
      }
    });
    const clusters = [...tagGroups.entries()]
      .filter(([, points]) => points.length >= 3)
      .map(([tag, points]) => ({
        tag,
        x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
        y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
      }));
    return { nodes, edges, clusters };
  }, [memories]);

  const tabs: Array<{ key: View; label: string }> = [
    { key: "cards", label: "全部" },
    { key: "timeline", label: "时间轴" },
    { key: "tags", label: "标签" },
    { key: "graph", label: "星图" },
  ];

  return (
    <main>
      <header className="row">
        <div>
          <h1>记忆</h1>
        </div>
        <nav>
          <Link href="/" className="pill">
            <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="M19 12H5" /><path d="m12 19-7-7 7-7" /></svg>
            对话
          </Link>
        </nav>
      </header>

      <div className="tabs">
        {tabs.map((tab) => (
          <button key={tab.key} className={view === tab.key ? "active" : ""} onClick={() => setView(tab.key)}>
            {tab.label} ({tab.key === "cards" ? memories.length : tab.key === "tags" ? byTag.length : tab.key === "timeline" ? byDay.length : memories.length})
          </button>
        ))}
      </div>

      {error ? <p className="error">{error}</p> : null}

      {view === "cards" && (
        <section className="cards">
          {allTags.length > 0 && (
            <div className="filterRow">
              <button className={tagFilter === null ? "chip active" : "chip"} onClick={() => setTagFilter(null)}>全部</button>
              {allTags.map(([tag, count]) => (
                <button key={tag} className={tagFilter === tag ? "chip active" : "chip"} onClick={() => setTagFilter(tagFilter === tag ? null : tag)}>
                  {tag} <span className="count">{count}</span>
                </button>
              ))}
            </div>
          )}
          {visible.length === 0 ? (
            <p className="empty">{tagFilter === null ? "还没有记忆。去对话页说点什么，让总管记下来。" : `#${tagFilter} 下还没有记忆。`}</p>
          ) : (
            visible.map((memory) => (
              <article className="card" key={memory.id}>
                <div className="meta">
                  <span className="tag">{EPISTEMIC_LABEL[memory.epistemicType] ?? memory.epistemicType}</span>
                  {memory.tags.map((tag) => <span className="tag clickable" key={tag} onClick={() => setTagFilter(tag)}>{tag}</span>)}
                  <span className="dim">v{memory.version} · {dayOf(memory.createdAt)}</span>
                </div>
                <div className="md" dangerouslySetInnerHTML={html(memory.content)} />
              </article>
            ))
          )}
        </section>
      )}

      {view === "timeline" && (
        <section className="cards">
          {byDay.length === 0 ? (
            <p className="empty">还没有记忆。</p>
          ) : (
            byDay.map(([day, items]) => (
              <div key={day}>
                <h2 className="day">{day}</h2>
                {items.map((memory) => (
                  <article className="card" key={memory.id}>
                    <div className="meta">
                      <span className="tag">{EPISTEMIC_LABEL[memory.epistemicType] ?? memory.epistemicType}</span>
                      {memory.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                      <span className="dim">{new Date(memory.createdAt).toLocaleTimeString("zh-CN", { hour: "2-digit", minute: "2-digit" })}</span>
                    </div>
                    <div className="md" dangerouslySetInnerHTML={html(memory.content)} />
                  </article>
                ))}
              </div>
            ))
          )}
        </section>
      )}

      {view === "tags" && (
        <section className="cards">
          {byTag.length === 0 ? (
            <p className="empty">还没有记忆。</p>
          ) : (
            byTag.map(([tag, items]) => (
              <div key={tag}>
                <h2 className="day"># {tag} <span className="dim">({items.length})</span></h2>
                {items.map((memory) => (
                  <article className="card" key={memory.id}>
                    <div className="meta">
                      <span className="tag">{EPISTEMIC_LABEL[memory.epistemicType] ?? memory.epistemicType}</span>
                      <span className="dim">v{memory.version} · {dayOf(memory.createdAt)}</span>
                    </div>
                    <div className="md" dangerouslySetInnerHTML={html(memory.content)} />
                  </article>
                ))}
              </div>
            ))
          )}
        </section>
      )}

      {view === "graph" && (
        <section>
          {memories.length === 0 ? (
            <p className="empty">还没有记忆，星图空空如也。</p>
          ) : (
            <>
              <svg viewBox="0 0 800 600" className="graph" role="img" aria-label="记忆星图：按时间螺旋排布，共享标签的记忆以线相连">
                {graph.edges.map((edge, index) => (
                  <line
                    key={`e${index}`}
                    x1={graph.nodes[edge.from]!.x} y1={graph.nodes[edge.from]!.y}
                    x2={graph.nodes[edge.to]!.x} y2={graph.nodes[edge.to]!.y}
                    stroke="#1f4d3b" strokeOpacity="0.18" strokeWidth="1"
                  />
                ))}
                {graph.clusters.map((cluster) => (
                  <text key={`c${cluster.tag}`} x={cluster.x} y={cluster.y - 18} textAnchor="middle" fontSize="14" fill="#6b6b64">#{cluster.tag}</text>
                ))}
                {graph.nodes.map((node, index) => (
                  <g key={node.memory.id} onClick={() => setSelected(node.memory)} className="node"
                     opacity={tagFilter === null || node.memory.tags.includes(tagFilter) ? 1 : 0.12}>
                    <circle
                      cx={node.x} cy={node.y} r={node.r}
                      fill={TAG_COLORS[node.memory.tags[0] ?? ""] ?? "#1f4d3b"}
                      fillOpacity="0.85"
                    />
                    <title>{`${dayOf(node.memory.createdAt)} · ${node.memory.tags.join(" ") || "无标签"} · ${node.memory.content.slice(0, 40)}`}</title>
                    {index === 0 ? <circle cx={node.x} cy={node.y} r={node.r + 4} fill="none" stroke="#1f4d3b" strokeOpacity="0.4" /> : null}
                  </g>
                ))}
              </svg>
              <p className="dim center">
                {memories.length < 10
                  ? `星图现在只有 ${memories.length} 个点，看不出形状是正常的——它需要几十条记忆才会长出样子：项目聚成星座，孤点是没人认领的记忆。平时正常记录，过一两个月再回来看。`
                  : "时间螺旋：中心最旧，外圈最新。连线 = 共享标签；#名字 = 同标签星座；没有连线的孤点 = 独处的记忆。点击节点看原文。"}
              </p>
              {selected ? (
                <article className="card detailOverlay">
                  <button className="close" onClick={() => setSelected(null)} aria-label="关闭">×</button>
                  <div className="meta">
                    <span className="tag">{EPISTEMIC_LABEL[selected.epistemicType] ?? selected.epistemicType}</span>
                    {selected.tags.map((tag) => <span className="tag" key={tag}>{tag}</span>)}
                    <span className="dim">v{selected.version} · {dayOf(selected.createdAt)}</span>
                  </div>
                  <div className="md" dangerouslySetInnerHTML={html(selected.content)} />
                </article>
              ) : null}
            </>
          )}
        </section>
      )}

      <style jsx>{`
        .row { display: flex; justify-content: space-between; align-items: flex-start; }
        .tabs { display: flex; gap: .4rem; flex-wrap: wrap; }
        .tabs button { justify-self: auto; background: #fff; color: #1b1b19; border: 1px solid #c8c8c0; padding: .4rem .8rem; font-size: .85rem; }
        .tabs button.active { background: #1f4d3b; color: #fff; border-color: #1f4d3b; }
        .filterRow { display: flex; gap: .4rem; flex-wrap: wrap; }
        .chip { border: 1px solid #c8c8c0; background: #fff; color: #1b1b19; border-radius: 999px; padding: .25rem .7rem; font-size: .8rem; cursor: pointer; }
        .chip.active { background: #1f4d3b; color: #fff; border-color: #1f4d3b; }
        .chip .count { opacity: .55; font-size: .72rem; margin-left: .2rem; }
        .tag.clickable { cursor: pointer; }
        .tag.clickable:hover { background: #e0d9cd; }
        .detailOverlay { position: fixed; right: 1rem; bottom: 1rem; width: min(420px, calc(100vw - 2rem));
                         max-height: 60vh; overflow-y: auto; z-index: 10; box-shadow: 0 8px 30px #0003;
                         border: 1px solid #c8c8c0; }
        .detailOverlay .close { position: absolute; top: .4rem; right: .5rem; background: none; border: none; color: #6b6b64; font-size: 1.2rem; cursor: pointer; }
        .detailOverlay .meta { padding-right: 2rem; }
        .cards { display: flex; flex-direction: column; gap: .75rem; }
        .card { background: #fff; border-radius: .8rem; padding: .9rem 1rem; box-shadow: 0 1px 3px #00000012; }
        .meta { display: flex; gap: .4rem; align-items: center; flex-wrap: wrap; margin-bottom: .4rem; }
        .tag { font-size: .72rem; padding: .15rem .5rem; border-radius: 999px; background: #efeae2; color: #6b6b64; }
        .dim { font-size: .72rem; color: #6b6b64; margin-left: auto; }
        .day { font-size: 1.05rem; margin: .5rem 0 .2rem; color: #6b6b64; }
        .md :global(p) { margin: .35rem 0; line-height: 1.6; white-space: pre-wrap; }
        .md :global(h1), .md :global(h2), .md :global(h3) { margin: .5rem 0 .2rem; }
        .md :global(ul), .md :global(ol) { margin: .3rem 0; padding-left: 1.2rem; }
        .md :global(code) { background: #efeae2; padding: .1rem .3rem; border-radius: .3rem; font-size: .85em; }
        .md :global(pre) { background: #f5f5f1; padding: .6rem; border-radius: .5rem; overflow-x: auto; }
        .md :global(blockquote) { margin: .4rem 0; padding-left: .8rem; border-left: 3px solid #b45309; color: #6b6b64; }
        .md :global(a) { color: #1f4d3b; }
        .graph { width: 100%; height: auto; background: #fff; border-radius: .8rem; box-shadow: 0 1px 3px #00000012; cursor: pointer; }
        .node circle { transition: r .15s; }
        .node:hover circle { r: 9; }
        .center { text-align: center; }
        .close { margin-left: auto; background: none; border: none; color: #6b6b64; font-size: 1.1rem; padding: 0 .3rem; }
      `}</style>
    </main>
  );
}
