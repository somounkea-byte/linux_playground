import {
  Award,
  BarChart3,
  BookOpen,
  BookText,
  ClipboardCheck,
  ClipboardList,
  Cpu,
  FileCode2,
  FileStack,
  FolderTree,
  GraduationCap,
  HardDrive,
  LayoutDashboard,
  Library,
  ListChecks,
  Lock,
  Network,
  Package,
  Settings,
  Shield,
  SquareTerminal,
  Swords,
  TrendingUp,
  Users,
  UserCog,
  Layers,
  ScrollText,
  SlidersHorizontal,
  type LucideIcon,
} from "lucide-react";

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

export const MODULE_ICONS: Record<string, LucideIcon> = {
  "linux-fundamentals": BookOpen,
  "basic-commands": SquareTerminal,
  "file-system": FolderTree,
  "file-permissions": Shield,
  "users-groups": Users,
  "process-management": Cpu,
  networking: Network,
  "package-management": Package,
  "storage-management": HardDrive,
  "shell-scripting": FileCode2,
  "linux-security": Lock,
};

export const studentNav: NavSection[] = [
  {
    title: "Overview",
    items: [
      { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
      { href: "/terminal", label: "Terminal", icon: SquareTerminal },
      { href: "/learn", label: "Learn Linux", icon: GraduationCap },
    ],
  },
  {
    title: "Modules",
    items: [
      { href: "/learn/basic-commands", label: "Basic Commands", icon: SquareTerminal },
      { href: "/learn/file-system", label: "File System", icon: FolderTree },
      { href: "/learn/file-permissions", label: "File Permissions", icon: Shield },
      { href: "/learn/users-groups", label: "Users & Groups", icon: Users },
      { href: "/learn/process-management", label: "Process Management", icon: Cpu },
      { href: "/learn/networking", label: "Networking", icon: Network },
      { href: "/learn/package-management", label: "Package Management", icon: Package },
      { href: "/learn/storage-management", label: "Storage Management", icon: HardDrive },
      { href: "/learn/shell-scripting", label: "Shell Scripting", icon: FileCode2 },
      { href: "/learn/linux-security", label: "Linux Security", icon: Lock },
    ],
  },
  {
    title: "Practice",
    items: [
      { href: "/challenges", label: "Practice Challenges", icon: Swords },
      { href: "/assignments", label: "Assignments", icon: ClipboardList },
      { href: "/quizzes", label: "Quizzes", icon: ListChecks },
      { href: "/commands", label: "Command Reference", icon: BookText },
    ],
  },
  {
    title: "You",
    items: [
      { href: "/achievements", label: "Achievements", icon: Award },
      { href: "/progress", label: "My Progress", icon: TrendingUp },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const teacherNav: NavSection[] = [
  {
    title: "Teaching",
    items: [
      { href: "/teacher", label: "Teacher Dashboard", icon: LayoutDashboard },
      { href: "/teacher/students", label: "Students", icon: Users },
      { href: "/teacher/exercises", label: "Exercises", icon: FileStack },
      { href: "/teacher/assignments", label: "Assignments", icon: ClipboardList },
      { href: "/teacher/submissions", label: "Submissions", icon: ClipboardCheck },
      { href: "/teacher/quizzes", label: "Quizzes", icon: ListChecks },
      { href: "/teacher/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/terminal", label: "Terminal", icon: SquareTerminal },
      { href: "/learn", label: "Learning Modules", icon: GraduationCap },
      { href: "/challenges", label: "Challenges", icon: Swords },
      { href: "/commands", label: "Command Reference", icon: BookText },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export const adminNav: NavSection[] = [
  {
    title: "Administration",
    items: [
      { href: "/admin", label: "Admin Dashboard", icon: LayoutDashboard },
      { href: "/admin/users", label: "User Management", icon: UserCog },
      { href: "/admin/modules", label: "Module Management", icon: Layers },
      { href: "/teacher/exercises", label: "Exercise Management", icon: FileStack },
      { href: "/admin/audit", label: "Audit Log", icon: ScrollText },
      { href: "/admin/settings", label: "System Settings", icon: SlidersHorizontal },
    ],
  },
  {
    title: "Teaching",
    items: [
      { href: "/teacher", label: "Teacher Dashboard", icon: BarChart3 },
      { href: "/teacher/students", label: "Students", icon: Users },
      { href: "/teacher/quizzes", label: "Quizzes", icon: ListChecks },
      { href: "/teacher/reports", label: "Reports", icon: BarChart3 },
    ],
  },
  {
    title: "Platform",
    items: [
      { href: "/terminal", label: "Terminal", icon: SquareTerminal },
      { href: "/learn", label: "Learning Modules", icon: Library },
      { href: "/challenges", label: "Challenges", icon: Swords },
      { href: "/settings", label: "Settings", icon: Settings },
    ],
  },
];

export function navFor(role: string): NavSection[] {
  if (role === "ADMIN") return adminNav;
  if (role === "TEACHER") return teacherNav;
  return studentNav;
}
