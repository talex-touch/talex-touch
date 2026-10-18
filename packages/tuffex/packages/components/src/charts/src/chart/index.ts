import type { ChartLabels, ChartProps } from './src/types'
import { withInstall } from '../utils/with-install'
import component from './src/TxChart.vue'
import { CHART_DEFAULT_LABELS } from './src/types'

const TxChart = withInstall(component)

export { CHART_DEFAULT_LABELS, TxChart }
export type { ChartLabels, ChartProps }
export type TxChartInstance = InstanceType<typeof component>

export default TxChart
