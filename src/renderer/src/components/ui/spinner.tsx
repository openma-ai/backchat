import { useI18n } from "@/lib/i18n"
import { cn } from "@/lib/utils"
import { Loader2Icon } from "lucide-react"

function Spinner({ className, ...props }: React.ComponentProps<"svg">) {
  const { t } = useI18n();
  return (
    <Loader2Icon role="status" aria-label={t("common.loadingShort")} className={cn("size-4 animate-spin", className)} {...props} />
  )
}

export { Spinner }
