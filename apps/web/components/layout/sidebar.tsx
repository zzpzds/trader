"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, BarChart3, Eye, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/positions",
    label: "持仓管理",
    icon: BarChart3,
  },
  {
    href: "/strategies",
    label: "策略库",
    icon: BookOpen,
  },
  {
    href: "/monitoring",
    label: "监控中心",
    icon: Eye,
  },
  {
    href: "/notifications",
    label: "通知",
    icon: Bell,
  },
];

export function Sidebar({ className }: { className?: string }) {
  const pathname = usePathname();
  const [unreadCount, setUnreadCount] = useState(0);

  useEffect(() => {
    async function fetchUnread() {
      try {
        const res = await fetch("/api/notifications?status=unread");
        const data = await res.json();
        setUnreadCount(data.unreadCount ?? 0);
      } catch {
        // ignore
      }
    }
    fetchUnread();
  }, [pathname]);

  return (
    <aside className={cn("w-56 shrink-0 border-r bg-muted/20 flex flex-col h-full", className)}>
      <div className="px-4 py-5 border-b">
        <span className="font-bold text-lg tracking-tight">Trader</span>
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
              {href === "/notifications" && unreadCount > 0 && (
                <span className="ml-auto bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {unreadCount}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
