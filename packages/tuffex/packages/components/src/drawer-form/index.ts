import type { DrawerFormEmits, DrawerFormProps } from './src/types'
import { withInstall } from '../../../utils/withInstall'
import component from './src/TxDrawerForm.vue'

const TxDrawerForm = withInstall(component)

export { TxDrawerForm }
export type { DrawerFormEmits, DrawerFormProps }
export type TxDrawerFormInstance = InstanceType<typeof component>

export default TxDrawerForm
