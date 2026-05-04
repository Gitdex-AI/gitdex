import type { Metadata } from "next";
import { Providers } from "@/components/Providers";
import { ShellLayout } from "@/components/ShellLayout";
import "@mantine/core/styles.css";
import "./globals.css";

export const metadata: Metadata = {
  title: "Gitdex Console",
  description: "Project routing, Codex sessions, and GitHub issue orchestration"
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        <Providers>
          <ShellLayout>{children}</ShellLayout>
        </Providers>
      </body>
    </html>
  );
}
