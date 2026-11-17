import {
  Award,
  Brain,
  Compass,
  Crown,
  FileCode2,
  Flame,
  FolderTree,
  Network,
  ShieldCheck,
  Sprout,
  Terminal,
  Trophy,
  Users,
  type LucideIcon,
} from "lucide-react";
import { cn } from "@/lib/utils";

const BADGE_ICONS: Record<string, LucideIcon> = {
  sprout: Sprout,
  compass: Compass,
  "folder-tree": FolderTree,
  "shield-check": ShieldCheck,
  users: Users,
  network: Network,
  "file-code": FileCode2,
  trophy: Trophy,
  crown: Crown,
  brain: Brain,
  flame: Flame,
  terminal: Terminal,
  award: Award,
};

export function BadgeIcon({ icon, earned = true, className }: { icon: string; earned?: boolean; className?: string }) {
  const Icon = BADGE_ICONS[icon] ?? Award;
  return (
    <span
      className={cn(
        "grid size-12 shrink-0 place-items-center rounded-xl border",
        earned ? "border-primary/40 bg-gradient-to-br from-primary/25 to-primary/5 text-primary" : "border-dashed bg-muted/40 text-muted-foreground/50",
        className,
      )}
    >
      <Icon className="size-6" />
    </span>
  );
}

export const DIFFICULTY_STYLES: Record<string, string> = {
  BEGINNER: "border-success/40 bg-success/10 text-success",
  INTERMEDIATE: "border-warning/40 bg-warning/10 text-warning",
  ADVANCED: "border-destructive/40 bg-destructive/10 text-destructive",
};

export function DifficultyBadge({ difficulty }: { difficulty: string }) {
  return <span className={cn("inline-flex items-center rounded-full border px-2 py-0.5 text-[0.7rem] font-semibold capitalize", DIFFICULTY_STYLES[difficulty])}>{difficulty.toLowerCase()}</span>;
}
