import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { clsx } from "clsx";
import { twMerge } from "tailwind-merge";
import type { ComponentProps } from "react";
const variants = cva(
  "inline-flex items-center justify-center gap-2 rounded-lg text-base font-semibold transition-colors disabled:pointer-events-none disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-emerald-700",
  {
    variants: {
      variant: {
        default: "bg-[#174d3c] text-white hover:bg-[#103b2d]",
        outline:
          "border border-[#d8dfd9] bg-white text-[#243c32] hover:bg-[#f1f5f0]",
        ghost: "text-[#54675d] hover:bg-[#edf2eb]",
        destructive: "bg-red-700 text-white hover:bg-red-800",
      },
      size: { default: "h-10 px-4", sm: "min-h-9 px-3 text-sm", icon: "size-10" },
    },
    defaultVariants: { variant: "default", size: "default" },
  },
);
export function Button({
  className,
  variant,
  size,
  asChild = false,
  ...props
}: ComponentProps<"button"> &
  VariantProps<typeof variants> & { asChild?: boolean }) {
  const Comp = asChild ? Slot : "button";
  return (
    <Comp
      className={twMerge(clsx(variants({ variant, size }), className))}
      {...props}
    />
  );
}
