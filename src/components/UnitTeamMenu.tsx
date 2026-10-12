import { useEffect, useRef, type CSSProperties, type KeyboardEvent } from 'react'
import { createPortal } from 'react-dom'
import { useMap } from 'react-leaflet'
import type { OperatorTeam } from '../types'
import { TEAMS } from '../config/operators'
import { platform } from '../platform'
import { floatingPanelPosition } from '../utils/floatingPanelPosition'

const TEAM_OPTIONS = [{ id: undefined, name: '无队伍', color: '#9ba7af' }, ...TEAMS]

interface UnitTeamMenuProps {
  owner: string
  name: string
  team?: OperatorTeam
  allowNoTeam?: boolean
  getAnchor: () => HTMLButtonElement | null
  onSelect: (team?: OperatorTeam) => void
  onClose: () => void
}

/** 只有打开时才挂载，所有兵棋共用菜单逻辑，不为每个 Marker 常驻全局监听。 */
export default function UnitTeamMenu({ owner, name, team, allowNoTeam = true, getAnchor, onSelect, onClose }: UnitTeamMenuProps) {
  const map = useMap()
  const menuRef = useRef<HTMLDivElement>(null)
  const handlersRef = useRef({ getAnchor, onSelect, onClose })
  handlersRef.current = { getAnchor, onSelect, onClose }
  const options = allowNoTeam ? TEAM_OPTIONS : TEAMS

  const close = (restoreFocus = false) => {
    handlersRef.current.onClose()
    if (restoreFocus) window.requestAnimationFrame(() => handlersRef.current.getAnchor()?.focus({ preventScroll: true }))
  }

  useEffect(() => {
    const menu = menuRef.current
    if (!menu) return
    const place = () => {
      const anchor = handlersRef.current.getAnchor()
      if (!anchor?.isConnected) {
        handlersRef.current.onClose()
        return
      }
      // CSS 先限制宽高与安全区，这里只读取真实尺寸，避免估算出屏。
      const styles = getComputedStyle(menu)
      const inset = (side: string) => 4 + (parseFloat(styles.getPropertyValue(`--menu-safe-${side}`)) || 0)
      const viewport = window.visualViewport
      const bounds = {
        left: (viewport?.offsetLeft ?? 0) + inset('left'),
        top: (viewport?.offsetTop ?? 0) + inset('top'),
        right: (viewport?.offsetLeft ?? 0) + (viewport?.width ?? window.innerWidth) - inset('right'),
        bottom: (viewport?.offsetTop ?? 0) + (viewport?.height ?? window.innerHeight) - inset('bottom'),
      }
      const rect = menu.getBoundingClientRect()
      const position = floatingPanelPosition(anchor.getBoundingClientRect(), rect.width, rect.height, bounds)
      menu.style.left = `${position.left}px`
      menu.style.top = `${position.top}px`
      menu.style.visibility = 'visible'
    }
    const dismiss = () => handlersRef.current.onClose()
    const dismissOutside = (event: PointerEvent) => {
      if (!(event.target instanceof Node) || menu.contains(event.target) || handlersRef.current.getAnchor()?.contains(event.target)) return
      dismiss()
    }
    const dismissOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== owner) dismiss()
    }
    // 新菜单先通知旧菜单关闭，避免多个兵棋同时出现选择面板。
    window.dispatchEvent(new CustomEvent('unit-team-picker-open', { detail: owner }))
    // React-Leaflet 的 Marker ref / divIcon 在父组件提交时才就绪；
    // 等待一帧再定位，不能在子组件的 layout effect 中把暂时为空的 ref 当作已删除。
    const initialFrame = window.requestAnimationFrame(() => {
      place()
      if (platform.kind !== 'android') menu.querySelector<HTMLButtonElement>('[aria-checked="true"]')?.focus({ preventScroll: true })
    })
    const observer = new ResizeObserver(place)
    observer.observe(menu)
    document.addEventListener('pointerdown', dismissOutside, true)
    window.addEventListener('unit-team-picker-open', dismissOther)
    window.addEventListener('resize', place)
    window.visualViewport?.addEventListener('resize', place)
    window.visualViewport?.addEventListener('scroll', place)
    map.on('movestart zoomstart rotate', dismiss)
    return () => {
      window.cancelAnimationFrame(initialFrame)
      observer.disconnect()
      document.removeEventListener('pointerdown', dismissOutside, true)
      window.removeEventListener('unit-team-picker-open', dismissOther)
      window.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('resize', place)
      window.visualViewport?.removeEventListener('scroll', place)
      map.off('movestart zoomstart rotate', dismiss)
    }
  }, [map, owner])

  const handleKeyDown = (event: KeyboardEvent<HTMLDivElement>) => {
    event.stopPropagation()
    if (event.key === 'Escape') {
      event.preventDefault()
      close(true)
      return
    }
    const options = Array.from(menuRef.current?.querySelectorAll<HTMLButtonElement>('[role="menuitemradio"]') ?? [])
    const index = options.indexOf(document.activeElement as HTMLButtonElement)
    if (index < 0) return
    let next = index
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      const direction = event.key === 'ArrowDown' ? 1 : -1
      const rowCount = Math.ceil(options.length / 2)
      const column = index % 2
      // 五个队伍时末行只有一个选项；纵向导航保持同列并跳过空格。
      for (let distance = 1; distance <= rowCount; distance++) {
        const candidate = ((Math.floor(index / 2) + direction * distance + rowCount) % rowCount) * 2 + column
        if (candidate < options.length) { next = candidate; break }
      }
    }
    else if (event.key === 'ArrowRight') next = (index + 1) % options.length
    else if (event.key === 'ArrowLeft') next = (index - 1 + options.length) % options.length
    else if (event.key === 'Home') next = 0
    else if (event.key === 'End') next = options.length - 1
    else return
    event.preventDefault()
    options[next]?.focus()
  }

  return createPortal(
    <div
      ref={menuRef}
      className={`unit-team-menu${platform.kind === 'android' ? ' touch-layout' : ''}`}
      role="dialog"
      aria-label={`${name}所属小队`}
      onPointerDown={(event) => event.stopPropagation()}
      onMouseDown={(event) => event.stopPropagation()}
      onClick={(event) => event.stopPropagation()}
      onDoubleClick={(event) => event.stopPropagation()}
      onContextMenu={(event) => event.stopPropagation()}
      onKeyDown={handleKeyDown}
      onKeyUp={(event) => event.stopPropagation()}
    >
      <div className="unit-team-menu-head">
        <span><b>所属小队</b><small title={name}>{name}</small></span>
        <button type="button" onClick={() => close(true)} title="关闭小队选择" aria-label="关闭小队选择"><i className="fa-solid fa-xmark" aria-hidden="true" /></button>
      </div>
      <div id={`unit-team-menu-${owner}`} className="unit-team-menu-options" role="menu" aria-label="选择所属小队">
        {options.map((option) => (
          <button
            type="button"
            key={option.id ?? 'none'}
            role="menuitemradio"
            aria-checked={team === option.id}
            tabIndex={team === option.id ? 0 : -1}
            style={{ '--option-team-color': option.color } as CSSProperties}
            title={option.id ? `切换至${option.name}，同步绑定路线及所有分支` : '取消兵棋所属小队，路线保留原队伍'}
            onClick={() => {
              if (team !== option.id) handlersRef.current.onSelect(option.id)
              close(true)
            }}
          >
            <i className="unit-team-menu-dot" aria-hidden="true" />
            <span>{option.name}</span>
            {team === option.id && <i className="fa-solid fa-check" aria-hidden="true" />}
          </button>
        ))}
      </div>
      <p className="unit-team-menu-hint"><i className="fa-solid fa-code-branch" aria-hidden="true" />换队会同步绑定路线及所有分支{allowNoTeam ? '；选择“无队伍”保留路线原归属。' : '。'}</p>
    </div>,
    document.body,
  )
}
