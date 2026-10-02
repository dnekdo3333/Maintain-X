import { Toaster as Sonner, toast } from 'sonner'

/** One toaster for the whole app. Short, quiet confirmations; errors that need action use inline states. */
export function Toaster() {
  return (
    <Sonner
      position="bottom-right"
      closeButton
      duration={4000}
      visibleToasts={3}
      toastOptions={{
        classNames: {
          toast:
            'group !rounded-md !border !border-border !bg-popover !text-popover-foreground !shadow-popover !font-sans !text-sm',
          description: '!text-muted-foreground',
          actionButton: '!bg-primary !text-primary-foreground',
          cancelButton: '!bg-muted !text-foreground',
          success: '[&_[data-icon]]:!text-success',
          error: '[&_[data-icon]]:!text-danger',
          warning: '[&_[data-icon]]:!text-warning',
          info: '[&_[data-icon]]:!text-info',
        },
      }}
    />
  )
}

export { toast }
