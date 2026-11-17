import type { Metadata, Viewport } from "next";
import { Geist, JetBrains_Mono } from "next/font/google";
import { Providers } from "@/components/providers";
import "./globals.css";

const sans = Geist({ variable: "--font-sans", subsets: ["latin"] });
const mono = JetBrains_Mono({ variable: "--font-mono-family", subsets: ["latin"] });

export const metadata: Metadata = {
  title: { default: "Linux Playground — Learn Linux by Doing", template: "%s · Linux Playground" },
  description: "An interactive platform where IT students learn Linux in a realistic simulated Ubuntu terminal with lessons, challenges and quizzes.",
  applicationName: "Linux Playground",
};

export const viewport: Viewport = {
  themeColor: [
    { media: "(prefers-color-scheme: dark)", color: "#14181f" },
    { media: "(prefers-color-scheme: light)", color: "#fbfbfd" },
  ],
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning className={`${sans.variable} ${mono.variable} h-full antialiased`}>
      <body className="min-h-full bg-background font-sans text-foreground">
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
