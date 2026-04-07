import * as ProgressPrimitive from "@radix-ui/react-progress"
import { cn } from "@/lib/utils"

interface ProgressProps {
  className?: string
  value?: number
}

function Progress({ className, value }: ProgressProps) {
  return (
    <ProgressPrimitive.Root
      className={cn("relative h-2 w-full overflow-hidden rounded-full bg-gray-200", className)}
      value={value}
    >
      <ProgressPrimitive.Indicator
        className="h-full bg-blue-600 transition-all"
        style={{ transform: `translateX(-${100 - (value || 0)}%)` }}
      />
    </ProgressPrimitive.Root>
  )
}

export { Progress }