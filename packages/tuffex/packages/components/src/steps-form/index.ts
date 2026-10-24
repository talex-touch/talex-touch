import type { FormStepProps, StepsFormEmits, StepsFormProps } from './src/types'
import { withInstall } from '../../../utils/withInstall'
import formStep from './src/TxFormStep.vue'
import stepsForm from './src/TxStepsForm.vue'

const TxStepsForm = withInstall(stepsForm)
const TxFormStep = withInstall(formStep)

export { TxFormStep, TxStepsForm }
export type { FormStepProps, StepsFormEmits, StepsFormProps }
export type TxStepsFormInstance = InstanceType<typeof stepsForm>
export type TxFormStepInstance = InstanceType<typeof formStep>

export default TxStepsForm
