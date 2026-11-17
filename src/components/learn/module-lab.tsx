"use client";

import { FlaskConical } from "lucide-react";
import { useRef, useState } from "react";
import { LinuxTerminal, type TerminalController } from "@/components/terminal/terminal";
import { FileExplorer } from "@/components/tools/file-explorer";
import { PermissionCalculatorCard } from "@/components/tools/permission-calculator";
import { ScriptEditor } from "@/components/tools/script-editor";
import { PackageManager, ProcessViewer, SystemPanel } from "@/components/tools/system-tools";
import { UserManager } from "@/components/tools/user-manager";

const LAB_INFO: Record<string, { title: string; text: string }> = {
  "basic-commands": { title: "File manager", text: "Browse your machine graphically. Every button runs the equivalent shell command – watch the terminal agree." },
  "file-system": { title: "File system explorer", text: "Walk the directory tree from / and compare with ls, cd and tree in the terminal." },
  "file-permissions": { title: "Permission lab", text: "Experiment with the calculator, then apply real permissions to files. Try reading them in the terminal afterwards." },
  "users-groups": { title: "User & group manager", text: "Create users and groups with the GUI or with useradd/groupadd – both change the same /etc/passwd and /etc/group." },
  "process-management": { title: "Process monitor", text: "A graphical ps. Start background jobs in the terminal (sleep 300 &) and kill them here." },
  networking: { title: "Network overview", text: "Interfaces, gateway, DNS and listening ports of your machine. Install nginx and see port 80 appear." },
  "package-management": { title: "Package manager", text: "A graphical apt. Installed software is immediately available in the terminal." },
  "storage-management": { title: "Storage overview", text: "Disks, partitions, mounts and memory. Format and mount /dev/sdb in the terminal and watch it appear." },
  "shell-scripting": { title: "Script editor", text: "Write a Bash script, save it into your machine and run it in the terminal below." },
  "linux-security": { title: "Security overview", text: "Firewall rules, services and the authentication log of your machine." },
  "linux-fundamentals": { title: "Your machine", text: "Explore your Ubuntu machine with the commands from this module." },
};

export function ModuleLab({ moduleSlug }: { moduleSlug: string }) {
  const [refreshKey, setRefreshKey] = useState(0);
  const [calc, setCalc] = useState(0o754);
  const ctrl = useRef<TerminalController | null>(null);
  const bump = () => setRefreshKey((k) => k + 1);
  const info = LAB_INFO[moduleSlug] ?? LAB_INFO["linux-fundamentals"];

  let tool: React.ReactNode = null;
  switch (moduleSlug) {
    case "basic-commands":
    case "file-system":
      tool = <FileExplorer refreshKey={refreshKey} />;
      break;
    case "file-permissions":
      tool = (
        <div className="space-y-5">
          <PermissionCalculatorCard value={calc} onValue={setCalc} />
          <FileExplorer refreshKey={refreshKey} focus="permissions" />
        </div>
      );
      break;
    case "users-groups":
      tool = <UserManager refreshKey={refreshKey} />;
      break;
    case "process-management":
      tool = <ProcessViewer refreshKey={refreshKey} />;
      break;
    case "networking":
      tool = <SystemPanel refreshKey={refreshKey} focus="network" />;
      break;
    case "package-management":
      tool = <PackageManager refreshKey={refreshKey} />;
      break;
    case "storage-management":
      tool = <SystemPanel refreshKey={refreshKey} focus="storage" />;
      break;
    case "shell-scripting":
      tool = <ScriptEditor onRun={(cmd) => ctrl.current?.run(cmd)} />;
      break;
    case "linux-security":
      tool = <SystemPanel refreshKey={refreshKey} focus="security" onChanged={bump} />;
      break;
  }

  return (
    <section className="space-y-4">
      <div>
        <h2 className="flex items-center gap-2 text-lg font-semibold">
          <FlaskConical className="size-5 text-primary" /> Lab: {info.title}
        </h2>
        <p className="text-sm text-muted-foreground">{info.text}</p>
      </div>
      <div className={tool ? "grid gap-5 2xl:grid-cols-2" : ""}>
        {tool && <div className="min-w-0 rounded-xl border bg-card p-4">{tool}</div>}
        <LinuxTerminal controllerRef={ctrl} height={tool ? 520 : 420} onCommand={() => bump()} banner={false} />
      </div>
    </section>
  );
}
