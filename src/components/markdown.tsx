import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { cn } from "@/lib/utils";

/** Renders trusted lesson / instruction markdown (no raw HTML). */
export function Markdown({ children, className }: { children: string; className?: string }) {
  return (
    <div className={cn("prose-lesson", className)}>
      <ReactMarkdown remarkPlugins={[remarkGfm]} skipHtml>
        {children}
      </ReactMarkdown>
    </div>
  );
}
