"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, BarChart3, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { NotificationPanel } from "./notification-panel";

const navItems = [
  {
    href: "/strategies",
    label: "策略库",
    icon: BookOpen,
  },
  {
    href: "/positions",
    label: "持仓管理",
    icon: BarChart3,
  },
  {
    href: "/monitoring",
    label: "监控中心",
    icon: Eye,
  },
];

export function Sidebar() {
  const pathname = usePathname();

  return (
    <aside className="w-56 shrink-0 border-r bg-muted/20 flex flex-col h-full">
      <div className="px-4 py-5 border-b flex items-center justify-between">
        <span className="font-bold text-lg tracking-tight">Trader</span>
        <NotificationPanel />
      </div>
      <nav className="flex-1 p-3 space-y-1">
        {navItems.map(({ href, label, icon: Icon }) => {
          const active = pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "flex items-center gap-2 rounded-md px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary text-primary-foreground"
                  : "hover:bg-accent hover:text-accent-foreground"
              )}
            >
              <Icon size={16} />
              {label}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
