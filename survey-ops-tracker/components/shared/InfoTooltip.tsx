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
          className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-slate-700 hover:bg-slate-600 text-slate-400 hover:text-slate-200 text-[10px] ml-1 transition-colors"
          aria-label={text}
        >
          i
        </TooltipTrigger>
        <TooltipContent className="max-w-xs text-xs bg-slate-800 text-slate-200 border-slate-700">
          {text}
        </TooltipContent>
      </Tooltip>
    </TooltipProvider>
  )
}
