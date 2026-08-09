import * as React from "react"
import { cva, type VariantProps } from "class-variance-authority"

import { cn } from "@/lib/utils"

const badgeVariants = cva(
  // Small enamel-pin feel: an inset top highlight + bottom shadow gives a
  // domed/beveled edge instead of a flat rounded-rect chip.
  "inline-flex w-fit shrink-0 items-center gap-1 rounded-md border border-transparent px-1.5 py-0.5 text-xs font-medium whitespace-nowrap shadow-[inset_0_1px_0_0_oklch(1_0_0/25%),inset_0_-1px_1px_0_oklch(0_0_0/10%)]",
  {
    variants: {
      variant: {
        default: "bg-primary/15 text-primary",
        muted: "bg-muted text-muted-foreground",
        success: "bg-emerald-500/15 text-emerald-700 dark:text-emerald-400",
        warning: "bg-amber-500/15 text-amber-700 dark:text-amber-400",
        destructive: "bg-destructive/15 text-destructive",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  }
)

function Badge({
  className,
  variant,
  ...props
}: React.ComponentProps<"span"> & VariantProps<typeof badgeVariants>) {
  return (
    <span
      data-slot="badge"
      className={cn(badgeVariants({ variant, className }))}
      {...props}
    />
  )
}

export { Badge, badgeVariants }
