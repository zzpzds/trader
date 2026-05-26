"use client";

import { useState, useEffect } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { BookOpen, BarChart3, Eye, Bell } from "lucide-react";
import { cn } from "@/lib/utils";

const navItems = [
  {
    href: "/strategies",
    label: "策略库",
    icon: BookOpen,
  },
  {
    href: "/positions",
    label: "持仓",
    icon: BarChart3,
  },
  {
    href: "/monitoring",
    label: "监控",
    icon: Eye,
  },
  {
    href: "/notifications",
    label: "通知",
    icon: Bell,
  },
];

export function MobileNav() {
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
    <nav className="flex md:hidden fixed bottom-0 inset-x-0 border-t bg-background h-14 z-50">
      {navItems.map(({ href, label, icon: Icon }) => {
        const active = pathname.startsWith(href);
        return (
          <Link
            key={href}
            href={href}
            className={cn(
              "flex flex-1 flex-col items-center justify-center gap-0.5 text-[10px] relative",
              active
                ? "text-primary font-medium"
                : "text-muted-foreground"
            )}
          >
            <Icon size={18} />
            {label}
            {href === "/notifications" && unreadCount > 0 && (
              <span className="absolute top-1 bg-destructive text-destructive-foreground text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                {unreadCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
