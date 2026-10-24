export interface BreadcrumbItem {
  label: string
  href?: string
  icon?: string
  disabled?: boolean
}

export interface BreadcrumbProps {
  items: BreadcrumbItem[]
  separatorIcon?: string
  /**
   * Accessible name of the `<nav>` landmark, read out when a screen reader
   * lists the page's landmarks. English by default; pass the page's language.
   * @default 'Breadcrumb'
   */
  ariaLabel?: string
}

export interface BreadcrumbEmits {
  click: [item: BreadcrumbItem, index: number]
}
