import type { CSSProperties } from 'react'
import type { Side, StageSpawnPoint } from '../types'
import type { InfantrySpawnBase } from '../config/infantrySpawnAreas'
import { infantrySpawnColor } from '../utils/infantrySpawnSymbol'

interface Props {
  spawn: StageSpawnPoint
  data: InfantrySpawnBase
  stageLabel: string
  view: Side
  expanded: boolean
  canDeployVehicles: boolean
  onToggle: () => void
  onDeployVehicles: () => void
  onClose: () => void
}

export default function BaseSpawnPanel({ spawn, data, stageLabel, view, expanded, canDeployVehicles, onToggle, onDeployVehicles, onClose }: Props) {
  const color = infantrySpawnColor(spawn.side, view)
  const available = data.areas.length > 0 && !data.footSoldierDisabled
  return <div className="point-detail base-spawn-detail" style={{ '--infantry-side-color': color } as CSSProperties}>
    <div className="point-detail-head">
      <span className="point-detail-name">{spawn.name || '基地部署入口'}</span>
      <span className="base-spawn-side">{spawn.side === 'attack' ? '攻方' : '守方'} · {spawn.side === view ? '我方' : '敌方'}</span>
    </div>
    <div className="point-detail-row"><span className="dim">阶段</span><span>{spawn.stageId} · {stageLabel}</span></div>
    <section className="infantry-spawn-panel">
      <button type="button" className="infantry-spawn-toggle" disabled={!available} aria-expanded={expanded}
        onClick={onToggle}>
        <span>人员部署参考点</span>
        <span>{available ? expanded ? '收起' : '展开' : data.footSoldierDisabled ? '仅载具部署' : '暂无数据'} <i className={`fa-solid fa-chevron-${expanded ? 'up' : 'down'}`} aria-hidden="true" /></span>
      </button>
      {expanded && available && <div className="infantry-spawn-controls">
        <p className="base-spawn-summary">当前入口关联 {data.areas.length} 个候选出生区。</p>
        <p className="infantry-spawn-hint">参考点表示候选区中心，并非固定落地坐标。</p>
      </div>}
      {!available && <p className="infantry-spawn-missing">{data.footSoldierDisabled
        ? '该入口不允许步兵部署，仅用于载具部署。' : '该入口的人员候选出生区尚未恢复。'}</p>}
      {data.unresolvedCount > 0 && available && expanded && <p className="infantry-spawn-missing">另有 {data.unresolvedCount} 个候选区尚未恢复。</p>}
    </section>
    <div className="base-spawn-actions">
      {canDeployVehicles && <button type="button" className="btn" onClick={onDeployVehicles}>载具部署</button>}
      <button type="button" className="btn" onClick={onClose}>关闭</button>
    </div>
  </div>
}
