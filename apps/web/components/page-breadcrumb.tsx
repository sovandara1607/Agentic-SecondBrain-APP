"use client";

import { usePathname } from "next/navigation";
import { ALL_ITEMS } from "@/components/nav-config";

export function PageBreadcrumb() {
  const pathname = usePathname();
  const active = ALL_ITEMS.find(
    (item) => pathname === item.href || pathname.startsWith(`${item.href}/`),
  );

  return (
    <div className="flex items-center gap-1.5 text-sm text-muted-foreground">
      <span>Second Brain</span>
      {active && (
        <>
          <span>/</span>
          <span className="font-medium text-foreground">{active.title}</span>
        </>
      )}
    </div>
  );
}
