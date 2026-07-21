import {
  Tooltip,
  TooltipContent,
  TooltipProvider,
  TooltipTrigger,
} from '@/components/ui/tooltip'

interface InfoTooltipProps {
  text: string
}

/**
 * Wraps any element (usually a button) with the same styled tooltip the (i)
 * icons use — appears quickly on hover or keyboard focus. Use instead of the
 * native title attribute where the explanation matters for discoverability.
 */
export function HelpTip({ text, children }: { text: string; children: React.ReactElement }) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger render={children} />
        <TooltipContent className="max-w-xs text-xs">{text}</TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}

export function InfoTooltip({ text }: InfoTooltipProps) {
  return (
    <TooltipProvider>
      <Tooltip>
        <TooltipTrigger
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-muted hover:bg-accent text-muted-foreground hover:text-foreground text-[12px] ml-1 transition-colors"
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
