import type {
  FormClearDraftsOptions,
  FormControlKind,
  FormDraftAdapter,
  FormDraftState,
  FormDraftStorage,
  FormDraftTtl,
  FormEmits,
  FormErrorSource,
  FormErrorSummaryProps,
  FormItemEmits,
  FormItemProps,
  FormItemWidth,
  FormLabelAlign,
  FormLabelPosition,
  FormLayout,
  FormLeaveConfirm,
  FormLeaveContext,
  FormLeaveField,
  FormMessages,
  FormPersistOptions,
  FormProps,
  FormReconcile,
  FormReconcileContext,
  FormReconcileSource,
  FormRequiredMark,
  FormRowProps,
  FormRule,
  FormRuleLevel,
  FormRules,
  FormRuleType,
  FormSetErrorsOptions,
  FormSize,
  FormStandardSchema,
  FormStandardSchemaIssue,
  FormStandardSchemaResult,
  FormValidateOn,
  FormValidatorContext,
  FormValues,
  TxFormField,
  TxFormFieldOptions,
  TxFormHost,
} from './src/types'
import { withInstall } from '../../../utils/withInstall'
import { provideTxFormHost, useTxFormField } from './src/context'
import { clearTxFormDrafts, flushTxForms } from './src/draft'
import TxForm from './src/TxForm.vue'
import TxFormErrorSummary from './src/TxFormErrorSummary.vue'
import TxFormItem from './src/TxFormItem.vue'
import TxFormRow from './src/TxFormRow.vue'

const Form = withInstall(TxForm)
const FormItem = withInstall(TxFormItem)
const FormRow = withInstall(TxFormRow)
const FormErrorSummary = withInstall(TxFormErrorSummary)

export { FORM_DEFAULT_MESSAGES } from './src/types'
export {
  clearTxFormDrafts,
  flushTxForms,
  Form,
  FormErrorSummary,
  FormItem,
  FormRow,
  provideTxFormHost,
  TxForm,
  TxFormErrorSummary,
  TxFormItem,
  TxFormRow,
  useTxFormField,
}
export type {
  FormClearDraftsOptions,
  FormControlKind,
  FormDraftAdapter,
  FormDraftState,
  FormDraftStorage,
  FormDraftTtl,
  FormEmits,
  FormErrorSource,
  FormErrorSummaryProps,
  FormItemEmits,
  FormItemProps,
  FormItemWidth,
  FormLabelAlign,
  FormLabelPosition,
  FormLayout,
  FormLeaveConfirm,
  FormLeaveContext,
  FormLeaveField,
  FormMessages,
  FormPersistOptions,
  FormProps,
  FormReconcile,
  FormReconcileContext,
  FormReconcileSource,
  FormRequiredMark,
  FormRowProps,
  FormRule,
  FormRuleLevel,
  FormRules,
  FormRuleType,
  FormSetErrorsOptions,
  FormSize,
  FormStandardSchema,
  FormStandardSchemaIssue,
  FormStandardSchemaResult,
  FormValidateOn,
  FormValidatorContext,
  FormValues,
  TxFormField,
  TxFormFieldOptions,
  TxFormHost,
}
export type TxFormInstance = InstanceType<typeof TxForm>
export type TxFormItemInstance = InstanceType<typeof TxFormItem>
export type TxFormRowInstance = InstanceType<typeof TxFormRow>
export type TxFormErrorSummaryInstance = InstanceType<typeof TxFormErrorSummary>

export default Form
