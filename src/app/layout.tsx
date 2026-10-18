import type { Metadata } from "next";
import { IBM_Plex_Mono, IBM_Plex_Sans } from "next/font/google";
import SidebarNav from "@/components/sidebar-nav";
import "./globals.css";

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  weight: ["400", "500", "600", "700"],
  variable: "--font-plex-sans",
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-plex-mono",
});

export const metadata: Metadata = {
  title: "AEI Pulse — AMR surveillance, Tyks Laboratories",
  description:
    "Rolling, real-time antimicrobial resistance surveillance for Tyks Laboratories",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body className={`${plexSans.variable} ${plexMono.variable} font-sans antialiased`}>
        <div className="flex min-h-screen">
          <aside className="fixed inset-y-0 left-0 z-20 flex w-60 flex-col border-r border-border bg-card">
            <div className="flex items-center gap-3 px-5 pb-4 pt-6">
              {/* Tyks cross mark */}
              <svg width="34" height="34" viewBox="0 0 34 34" aria-hidden="true" className="shrink-0">
                <rect x="1" y="1" width="32" height="32" rx="8" fill="#0f6b7c" />
                <path d="M14 7h6v7h7v6h-7v7h-6v-7H7v-6h7z" fill="#ffffff" />
              </svg>
              <div>
                <div className="text-[15px] font-bold leading-tight text-foreground">
                  Tyks Laboratories
                </div>
                <div className="text-[12px] leading-tight text-muted-foreground">
                  AMR Intelligence
                </div>
              </div>
            </div>
            <SidebarNav />
            <div className="mt-auto px-5 pb-5 font-mono text-[11px] leading-relaxed text-muted-foreground">
              AEI Pulse · synthetic demo data
              <br />
              surveillance only — not a treatment guideline
            </div>
          </aside>
          {/* min-w-0: a wide table's intrinsic width must not force page-level
              horizontal scroll on narrow screens — matrices scroll inside
              their own overflow containers instead. */}
          <main className="ml-60 min-w-0 flex-1 px-8 py-6">{children}</main>
        </div>
      </body>
    </html>
  );
}
