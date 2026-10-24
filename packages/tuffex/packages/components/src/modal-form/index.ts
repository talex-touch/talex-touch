import type { ModalFormEmits, ModalFormProps } from './src/types'
import { withInstall } from '../../../utils/withInstall'
import component from './src/TxModalForm.vue'

const TxModalForm = withInstall(component)

export { TxModalForm }
export type { ModalFormEmits, ModalFormProps }
export type TxModalFormInstance = InstanceType<typeof component>

export default TxModalForm
