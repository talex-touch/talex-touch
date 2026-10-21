import type { FlowLightVariant } from '../../flow-light/src/types'

export type TxCardVariant = 'solid' | 'dashed' | 'plain'

export type TxCardBackground = 'pure' | 'mask' | 'blur' | 'glass' | 'refraction' | 'acrylic' | 'mica' | 'flat' | 'plain'

export type TxCardShadow = 'none' | 'soft' | 'medium'

export type TxCardSize = 'small' | 'medium' | 'large'
export type TxCardRefractionTone = 'mist' | 'balanced' | 'vivid'

export interface TxCardProps {
  variant?: TxCardVariant
  background?: TxCardBackground
  shadow?: TxCardShadow
  size?: TxCardSize
  radius?: number
  padding?: number
  glassBlur?: boolean
  glassBlurAmount?: number
  glassOverlay?: boolean
  glassOverlayOpacity?: number
  maskOpacity?: number
  fallbackMaskOpacity?: number
  surfaceMoving?: boolean
  refractionStrength?: number
  refractionProfile?: 'soft' | 'filmic' | 'cinematic'
  refractionTone?: TxCardRefractionTone
  refractionAngle?: number
  /**
   * `refraction` renderer, as on TxBaseSurface: 'css' (default) without the SVG displacement layer,
   * 'svg' with it, at `refractionGlassOpacity`.
   */
  refractionRenderer?: 'css' | 'svg'
  /** Opacity of the SVG displacement layer under `refractionRenderer="svg"` (0-1); 0.3 when absent. */
  refractionGlassOpacity?: number
  refractionLightFollowMouse?: boolean
  refractionLightFollowIntensity?: number
  refractionLightSpring?: boolean
  refractionLightSpringStiffness?: number
  refractionLightSpringDamping?: number
  /** The flow light (TxFlowLight) over the card's surface, whatever its `background`; off when absent. */
  flowLight?: FlowLightVariant | false
  /** Multiplies the flow light's theme opacity; default 1. */
  flowLightIntensity?: number
  clickable?: boolean
  /**
   * A faint light that follows the pointer over the card and glints along its border, drawn in
   * dark themes only. Follows `clickable` when absent.
   */
  specular?: boolean
  loading?: boolean
  loadingSpinnerSize?: number
  disabled?: boolean
  inertial?: boolean
  inertialMaxOffset?: number
  inertialRebound?: number
}
