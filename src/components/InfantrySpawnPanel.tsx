import type { CSSProperties } from 'react'
import type { Side } from '../types'
import type { InfantrySpawnInspection, InfantrySpawnObjective } from '../config/infantrySpawnAreas'
import { infantrySpawnColor, infantrySpawnSymbolMarkup } from '../utils/infantrySpawnSymbol'

interface Props {
  objective: InfantrySpawnObjective
  inspection: InfantrySpawnInspection
  view: Side
  mapLayerVisible: boolean
  onChange: (next: InfantrySpawnInspection) => void
}

export default function InfantrySpawnPanel({ objective, inspection, view, mapLayerVisible, onChange }: Props) {
  const groups = objective.groups.filter((group) => group.side === inspection.side)
  const unresolved = groups.filter((group) => inspection[group.kind]).reduce((sum, group) => sum + group.unresolvedCount, 0)
  const color = infantrySpawnColor(inspection.side, view)
  return (
    <section className="infantry-spawn-panel" style={{ '--infantry-side-color': color } as CSSProperties}>
      <button type="button" className="infantry-spawn-toggle" aria-expanded={inspection.expanded}
        onClick={() => onChange({ ...inspection, expanded: !inspection.expanded })}>
        <span>人员部署参考点</span>
        <span>{inspection.expanded ? '收起' : '展开'} <i className={`fa-solid fa-chevron-${inspection.expanded ? 'up' : 'down'}`} aria-hidden="true" /></span>
      </button>
      {inspection.expanded && <div className="infantry-spawn-controls">
        <div className="infantry-spawn-sides" role="group" aria-label="人员部署阵营">
          {(['attack', 'defense'] as const).map((side) => <button key={side} type="button"
            aria-pressed={inspection.side === side} className={inspection.side === side ? 'active' : ''}
            onClick={() => onChange({ ...inspection, side })}>{side === 'attack' ? '攻方' : '守方'}</button>)}
        </div>
        {(['inner', 'outer'] as const).map((kind) => {
          const group = groups.find((item) => item.kind === kind)
          const count = group?.areas.length ?? 0
          return <label key={kind} className="infantry-spawn-group">
            <input type="checkbox" checked={inspection[kind]} onChange={(event) => onChange({ ...inspection, [kind]: event.target.checked })} />
            <span className="infantry-spawn-swatch" aria-hidden="true" dangerouslySetInnerHTML={{ __html: infantrySpawnSymbolMarkup(kind) }} />
            <span>{kind === 'inner' ? '内侧候选点' : '外侧候选点'}</span>
            <span className="infantry-spawn-count">{count}</span>
          </label>
        })}
        <p className="infantry-spawn-hint">每个点表示一个候选区的中心位置，并非固定出生点；暂不随占领状态切换。</p>
        {!mapLayerVisible && <p className="infantry-spawn-missing">开启“据点与防线”图层后显示参考点。</p>}
        {unresolved > 0 && <p className="infantry-spawn-missing">另有 {unresolved} 个候选区尚未恢复，未显示参考点。</p>}
      </div>}
    </section>
  )
}
