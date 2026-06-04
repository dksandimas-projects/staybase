import type { ButtonHTMLAttributes, ReactNode } from "react";
import { Link, type LinkProps } from "react-router-dom";
import { cn } from "../utils/cn";

interface ButtonBaseProps {
  children: ReactNode;
  className?: string;
}

type GhostButtonProps =
  | (ButtonBaseProps & ButtonHTMLAttributes<HTMLButtonElement> & { to?: undefined })
  | (ButtonBaseProps & Omit<LinkProps, "className"> & { to: string });

export function GhostButton({ children, className, to, ...props }: GhostButtonProps) {
  const classes = cn(
    "inline-flex min-h-11 items-center justify-center gap-2 rounded-lg border border-primary bg-transparent px-5 py-2.5 text-sm font-semibold text-primary transition hover:bg-primary-light focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-60",
    className
  );

  if (to) {
    return (
      <Link className={classes} to={to} {...(props as Omit<LinkProps, "className" | "to">)}>
        {children}
      </Link>
    );
  }

  return (
    <button className={classes} {...(props as ButtonHTMLAttributes<HTMLButtonElement>)}>
      {children}
    </button>
  );
}
