"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import SignalBadge from "@/components/signal-badge";

const NAV = [
  { href: "/", label: "Overview", icon: "home" },
  { href: "/early-warning", label: "Early Warning", icon: "radar" },
  { href: "/guidance", label: "Antibiotic Guidance", icon: "search" },
  { href: "/trends", label: "Trends & Analytics", icon: "chart" },
  { href: "/wards", label: "Ward Comparison", icon: "network" },
  { href: "/organisms", label: "Organism View", icon: "microbe" },
  { href: "/alerts", label: "Alerts", icon: "bell" },
  { href: "/sitrep", label: "Sitrep", icon: "doc" },
  { href: "/explore", label: "Data Explorer", icon: "table" },
] as const;

function Icon({ name }: { name: (typeof NAV)[number]["icon"] }) {
  const stroke = {
    fill: "none",
    stroke: "currentColor",
    strokeWidth: 1.8,
    strokeLinecap: "round" as const,
    strokeLinejoin: "round" as const,
  };
  return (
    <svg width="17" height="17" viewBox="0 0 24 24" aria-hidden="true" className="shrink-0">
      {name === "home" && (
        <g {...stroke}>
          <path d="M3 10.5 12 3l9 7.5" />
          <path d="M5 9.5V21h14V9.5" />
        </g>
      )}
      {name === "search" && (
        <g {...stroke}>
          <circle cx="11" cy="11" r="6.5" />
          <path d="m20 20-4.4-4.4" />
        </g>
      )}
      {name === "chart" && (
        <g {...stroke}>
          <path d="M4 20V10" />
          <path d="M10 20V4" />
          <path d="M16 20v-7" />
          <path d="M21 20H3" />
        </g>
      )}
      {name === "network" && (
        <g {...stroke}>
          <circle cx="12" cy="5" r="2.2" />
          <circle cx="5" cy="18" r="2.2" />
          <circle cx="19" cy="18" r="2.2" />
          <path d="M12 7.2v4.3m0 0-5.4 4.6M12 11.5l5.4 4.6" />
        </g>
      )}
      {name === "microbe" && (
        <g {...stroke}>
          <circle cx="12" cy="12" r="6" />
          <path d="M12 3v3m0 12v3M3 12h3m12 0h3M5.6 5.6l2.1 2.1m8.6 8.6 2.1 2.1m0-12.8-2.1 2.1M7.7 16.3l-2.1 2.1" />
        </g>
      )}
      {name === "bell" && (
        <g {...stroke}>
          <path d="M6 9a6 6 0 0 1 12 0c0 5 2 6.5 2 6.5H4S6 14 6 9Z" />
          <path d="M10 19a2 2 0 0 0 4 0" />
        </g>
      )}
      {name === "table" && (
        <g {...stroke}>
          <rect x="3" y="4" width="18" height="16" rx="2" />
          <path d="M3 9h18M9 9v11" />
        </g>
      )}
      {name === "radar" && (
        <g {...stroke}>
          <circle cx="12" cy="12" r="8" />
          <circle cx="12" cy="12" r="4" />
          <path d="M12 12 18 6" />
        </g>
      )}
      {name === "doc" && (
        <g {...stroke}>
          <path d="M7 3h7l4 4v14H7z" />
          <path d="M14 3v4h4M10 12h5M10 16h5" />
        </g>
      )}
    </svg>
  );
}

export default function SidebarNav() {
  const pathname = usePathname();
  return (
    <nav className="flex flex-col gap-0.5 px-3 pt-2">
      {NAV.map((item) => {
        const active = pathname === item.href;
        return (
          <Link
            key={item.href}
            href={item.href}
            className={`flex items-center gap-2.5 rounded-lg px-3 py-2 text-[13.5px] transition-colors ${
              active
                ? "bg-primary/10 font-semibold text-primary"
                : "text-muted-foreground hover:bg-muted/70 hover:text-foreground"
            }`}
          >
            <Icon name={item.icon} />
            {item.label}
            {item.href === "/alerts" && <SignalBadge />}
          </Link>
        );
      })}
    </nav>
  );
}
