import type { ReactNode } from "react";

export type BadgeColor =
  | "brand"
  | "gray"
  | "green"
  | "orange"
  | "red"
  | "blue"
  | "amber";

export interface BadgeProps {
  children: ReactNode;
  color?: BadgeColor;
  className?: string;
}

const COLOR_MAP: Record<BadgeColor, string> = {
  brand: "bg-brand-light text-brand-dark",
  gray: "bg-gray-100 text-gray-700",
  green: "bg-emerald-100 text-emerald-700",
  orange: "bg-orange-100 text-orange-700",
  red: "bg-red-100 text-red-700",
  blue: "bg-blue-100 text-blue-700",
  amber: "bg-amber-100 text-amber-700",
};

export default function Badge({
  children,
  color = "gray",
  className = "",
}: BadgeProps) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${COLOR_MAP[color]} ${className}`}
    >
      {children}
    </span>
  );
}
