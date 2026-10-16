import { withInstall } from '../../../utils/withInstall'
import TxThinkingOrb from './src/TxThinkingOrb.vue'

const ThinkingOrb = withInstall(TxThinkingOrb)

export { ThinkingOrb, TxThinkingOrb }
export { ORB_PALETTES, ORB_STATE_PALETTES } from './src/palettes'
export type { OrbPalette, OrbPaletteName, OrbSize, OrbState, OrbTheme, OrbVariant } from './src/types'
export { ORB_STATES } from './src/types'
export type TxThinkingOrbInstance = InstanceType<typeof TxThinkingOrb>

export default ThinkingOrb
