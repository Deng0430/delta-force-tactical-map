import { useEffect, useRef, type RefObject } from 'react'
import type { DivIcon, Marker } from 'leaflet'

/** divIcon 重建后重新绑定入口，避免依赖 HTML 内联的全局分发器。 */
export function useUnitTeamPicker(markerRef: RefObject<Marker | null>, icon: DivIcon, interactive: boolean, onOpen: () => void) {
  const onOpenRef = useRef(onOpen)
  onOpenRef.current = onOpen
  useEffect(() => {
    if (!interactive) return
    const buttons = markerRef.current?.getElement()?.querySelectorAll<HTMLButtonElement>('.unit-team-trigger, .veh-team-letter, .building-team-letter')
    if (!buttons) return
    const stop = (event: Event) => event.stopPropagation()
    const activate = (event: Event) => {
      event.preventDefault()
      event.stopPropagation()
      onOpenRef.current()
    }
    buttons.forEach((button) => {
      button.addEventListener('pointerdown', stop)
      button.addEventListener('mousedown', stop)
      button.addEventListener('click', activate)
      button.addEventListener('dblclick', stop)
    })
    return () => buttons.forEach((button) => {
      button.removeEventListener('pointerdown', stop)
      button.removeEventListener('mousedown', stop)
      button.removeEventListener('click', activate)
      button.removeEventListener('dblclick', stop)
    })
  }, [markerRef, icon, interactive])
}
