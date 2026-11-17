import { BookText } from "lucide-react";
import { PageHeader } from "@/components/app/page-header";
import { CommandBrowser } from "@/components/learn/command-browser";
import { prisma } from "@/server/db";

export const metadata = { title: "Command Reference" };

export default async function CommandsPage() {
  const commands = await prisma.commandReference.findMany({ orderBy: { name: "asc" } });
  return (
    <>
      <PageHeader icon={<BookText className="size-6 text-primary" />} title="Command Reference" description={`${commands.length} commands supported by the Linux Playground simulator, with syntax, options and examples. Type man <command> in the terminal for the same information.`} />
      <CommandBrowser commands={commands.map((c) => ({ name: c.name, category: c.category, description: c.description, syntax: c.syntax, options: c.options as { flag: string; description: string }[], examples: c.examples as { command: string; description: string }[], permissions: c.permissions, package: c.package }))} />
    </>
  );
}
