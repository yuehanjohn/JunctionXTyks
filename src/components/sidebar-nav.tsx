"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SignalBadge from "@/components/signal-badge";

const NAV = [
  { href: "/", label: "Ward dashboard" },
  { href: "/signals", label: "Resistance signals" },
  { href: "/trends", label: "Trends" },
  { href: "/advisor", label: "AI advisor" },
];

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-1 px-3">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center rounded-lg px-3 py-2 text-sm transition-colors ${
              active
                ? "bg-card font-medium text-foreground shadow-[inset_0_0_0_1px_var(--border)]"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
          >
            {item.label}
            {item.href === "/signals" && <SignalBadge />}
          </Link>
        );
      })}
    </nav>
  );
}
