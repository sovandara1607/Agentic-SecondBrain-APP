import { Button as ButtonPrimitive } from "@base-ui/react/button"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const buttonVariants = cva(
  "group/button inline-flex shrink-0 items-center justify-center rounded-lg border border-transparent bg-clip-padding text-sm font-medium whitespace-nowrap transition-all outline-none select-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 active:not-aria-[haspopup]:translate-y-px disabled:pointer-events-none disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 [&_svg]:pointer-events-none [&_svg]:shrink-0 [&_svg:not([class*='size-'])]:size-4",
  {
    variants: {
      variant: {
        // Raised/tactile: a top-lit gradient + --shadow-raised (light
        // catch above, shadow below) reads as a physical, pressable key.
        // Pressing swaps to --shadow-inset, like the key sinking in.
        default:
          "border-[oklch(0_0_0/12%)] bg-gradient-to-b from-[color-mix(in_oklch,var(--primary),white_14%)] to-primary text-primary-foreground shadow-[var(--shadow-raised)] hover:from-[color-mix(in_oklch,var(--primary),white_20%)] active:shadow-[var(--shadow-inset)]",
        outline:
          "border-border bg-gradient-to-b from-[color-mix(in_oklch,var(--card),white_6%)] to-card shadow-[var(--shadow-raised-sm)] hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground active:shadow-[var(--shadow-inset)] dark:border-input dark:hover:bg-input/50",
        secondary:
          "border-[oklch(0_0_0/8%)] bg-gradient-to-b from-[color-mix(in_oklch,var(--secondary),white_10%)] to-secondary text-secondary-foreground shadow-[var(--shadow-raised-sm)] hover:from-[color-mix(in_oklch,var(--secondary),white_16%)] aria-expanded:bg-secondary aria-expanded:text-secondary-foreground active:shadow-[var(--shadow-inset)]",
        ghost:
          "hover:bg-muted hover:text-foreground aria-expanded:bg-muted aria-expanded:text-foreground dark:hover:bg-muted/50",
        destructive:
          "border-[oklch(0_0_0/8%)] bg-gradient-to-b from-[color-mix(in_oklch,var(--destructive),white_75%)] to-[color-mix(in_oklch,var(--destructive),white_65%)] text-destructive shadow-[var(--shadow-raised-sm)] hover:to-[color-mix(in_oklch,var(--destructive),white_58%)] focus-visible:border-destructive/40 focus-visible:ring-destructive/20 active:shadow-[var(--shadow-inset)] dark:from-[color-mix(in_oklch,var(--destructive),black_35%)] dark:to-[color-mix(in_oklch,var(--destructive),black_45%)] dark:focus-visible:ring-destructive/40",
        link: "text-primary underline-offset-4 hover:underline",
      },
      size: {
        default:
          "h-8 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        xs: "h-6 gap-1 rounded-[min(var(--radius-md),10px)] px-2 text-xs in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3",
        sm: "h-7 gap-1 rounded-[min(var(--radius-md),12px)] px-2.5 text-[0.8rem] in-data-[slot=button-group]:rounded-lg has-data-[icon=inline-end]:pr-1.5 has-data-[icon=inline-start]:pl-1.5 [&_svg:not([class*='size-'])]:size-3.5",
        lg: "h-9 gap-1.5 px-2.5 has-data-[icon=inline-end]:pr-2 has-data-[icon=inline-start]:pl-2",
        icon: "size-8",
        "icon-xs":
          "size-6 rounded-[min(var(--radius-md),10px)] in-data-[slot=button-group]:rounded-lg [&_svg:not([class*='size-'])]:size-3",
        "icon-sm":
          "size-7 rounded-[min(var(--radius-md),12px)] in-data-[slot=button-group]:rounded-lg",
        "icon-lg": "size-9",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
)

function Button({
  className,
  variant = "default",
  size = "default",
  ...props
}: ButtonPrimitive.Props & VariantProps<typeof buttonVariants>) {
  return (
    <ButtonPrimitive
      data-slot="button"
      className={cn(buttonVariants({ variant, size, className }))}
      {...props}
    />
  )
}

export { Button, buttonVariants }
