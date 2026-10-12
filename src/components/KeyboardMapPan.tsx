import { useEffect } from 'react'
import { useMap } from 'react-leaflet'
import { attachMapKeyboardPan } from '../utils/mapKeyboardPan'

export default function KeyboardMapPan({ enabled = true }: { enabled?: boolean }) {
  const map = useMap()
  useEffect(() => {
    if (enabled) return attachMapKeyboardPan(map)
  }, [enabled, map])
  return null
}
