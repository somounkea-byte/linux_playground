import { SquareTerminal } from "lucide-react";
import type { Metadata } from "next";
import { PageHeader } from "@/components/app/page-header";
import { TerminalWorkspace } from "./terminal-workspace";

export const metadata: Metadata = { title: "Terminal" };

export default function TerminalPage() {
  return (
    <>
      <PageHeader
        icon={<SquareTerminal className="size-6 text-primary" />}
        title="Terminal"
        description="Your personal Ubuntu 24.04 machine. Everything you do here is saved – experiment freely, and use Reset if you break something."
      />
      <TerminalWorkspace />
    </>
  );
}
