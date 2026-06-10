import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface InfoTooltipProps {
  text: string
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted hover:bg-accent text-muted-foreground hover:text-foreground text-[10px] ml-1 transition-colors"
          aria-label={text}
        >
          i
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
