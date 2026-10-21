import type {
  BaseSurfaceMode,
  BaseSurfacePreset,
  BaseSurfaceProps,
  BaseSurfaceRefractionProfile,
  BaseSurfaceRefractionRenderer,
  BaseSurfaceRefractionTone,
} from './src/types'
import { withInstall } from '../../../utils/withInstall'
import TxBaseSurface from './src/TxBaseSurface.vue'

const BaseSurface = withInstall(TxBaseSurface)

export { BaseSurface, TxBaseSurface }
export {
  getSurfaceEnvironment,
  getSurfacePerformanceMode,
  notifySurfaceWindowMotion,
  setSurfacePerformanceMode,
  setSurfacePowerSaving,
  SURFACE_LOW_BATTERY_LEVEL,
  SURFACE_MOTION_SETTLE_MS,
  SURFACE_POINTER_SPEED_THRESHOLD,
  useSurfaceMotionGuard,
} from './src/surface-environment'
export type { SurfaceFrameTier, SurfacePerformanceMode } from './src/surface-environment'
export type {
  BaseSurfaceMode,
  BaseSurfacePreset,
  BaseSurfaceProps,
  BaseSurfaceRefractionProfile,
  BaseSurfaceRefractionRenderer,
  BaseSurfaceRefractionTone,
}
export type TxBaseSurfaceInstance = InstanceType<typeof TxBaseSurface>

export default BaseSurface
