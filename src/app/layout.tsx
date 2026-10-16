import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import SidebarNav from "@/components/sidebar-nav";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "AEI — Antibiotic Efficacy Indicator",
  description:
    "Rolling, real-time antimicrobial resistance surveillance for Tyks Laboratories",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans antialiased`}>
        <div className="flex min-h-screen">
          <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-border bg-background">
            <div className="px-5 pb-6 pt-6">
              <div className="flex items-baseline gap-1.5">
                <span className="text-xl font-semibold tracking-tight text-primary">AEI</span>
                <span className="font-mono text-[10px] text-muted-foreground">v0.1</span>
              </div>
              <p className="mt-1 text-[12px] leading-snug text-muted-foreground">
                Antibiotic Efficacy Indicator
              </p>
            </div>
            <SidebarNav />
            <div className="mt-auto px-5 pb-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              Tyks Laboratories
              <br />
              synthetic demo data
            </div>
          </aside>
          <main className="ml-60 flex-1 px-10 py-8">{children}</main>
        </div>
      </body>
    </html>
  );
}
