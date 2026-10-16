export type AlertType = 'info' | 'success' | 'warning' | 'error'

export interface AlertProps {
  type?: AlertType
  title?: string
  message?: string
  closable?: boolean
  showIcon?: boolean
  /** Accessible label for the close button. @default 'Close' */
  closeLabel?: string
}

export interface AlertEmits {
  close: []
}
