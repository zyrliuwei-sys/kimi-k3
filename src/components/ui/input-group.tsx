"use client"

import * as React from "react"

import { cn } from "@/lib/utils"

/**
 * shadcn-style `InputGroup` primitive — a richer wrapper around a textarea
 * (or input) that supports leading/trailing inline buttons, file chips, and
 * other "addons" attached to the edges or stacked on top/bottom.
 *
 * `data-slot` attributes mirror the upstream shadcn component so the
 * Tailwind class names (which target `has-[[data-slot=…]]:…`) work as
 * expected. Reused by the image playground composer.
 */
function InputGroup({ className, ...props }: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="input-group"
      role="group"
      className={cn(
        "group/input-group relative flex h-9 w-full min-w-0 items-center shadow-xs transition-[color,box-shadow] outline-none",
        // Combobox descendant: don't repaint the focus ring
        "in-data-[slot=combobox-content]:focus-within:border-inherit in-data-[slot=combobox-content]:focus-within:ring-0",
        // Visible focus ring only on the control child
        "has-[[data-slot=input-group-control]:focus-visible]:border-ring has-[[data-slot=input-group-control]:focus-visible]:ring-3 has-[[data-slot=input-group-control]:focus-visible]:ring-ring/50",
        // Invalid styling
        "has-[[data-slot][aria-invalid=true]]:border-destructive has-[[data-slot][aria-invalid=true]]:ring-3 has-[[data-slot][aria-invalid=true]]:ring-destructive/20 dark:has-[[data-slot][aria-invalid=true]]:ring-destructive/40",
        // Block-aligned addons: collapse to vertical column
        "has-[>[data-align=block-end]]:h-auto has-[>[data-align=block-end]]:flex-col has-[>[data-align=block-start]]:h-auto has-[>[data-align=block-start]]:flex-col",
        "has-[>textarea]:h-auto",
        // Inline-aligned addons: pad the control on the same side
        "has-[>[data-align=inline-end]]:[&>input]:pr-1.5 has-[>[data-align=inline-start]]:[&>input]:pl-1.5",
        "dark:bg-input/30",
        className
      )}
      {...props}
    />
  )
}

function InputGroupAddon({
  className,
  align = "inline-start",
  ...props
}: React.ComponentProps<"div"> & {
  align?: "inline-start" | "inline-end" | "block-start" | "block-end"
}) {
  return (
    <div
      role="group"
      data-slot="input-group-addon"
      data-align={align}
      className={cn(
        "flex h-auto cursor-text items-center gap-2 py-1.5 text-sm font-medium text-muted-foreground select-none",
        "group-data-[disabled=true]/input-group:opacity-50",
        // kbd rounding
        "[&>kbd]:rounded-[calc(var(--radius)-5px)] [&>svg:not([class*='size-'])]:size-4",
        align === "block-end" &&
          "order-last w-full justify-between gap-1 px-2.5 pb-2 group-has-[>input]/input-group:pb-2 [.border-t]:pt-2",
        align === "block-start" &&
          "order-first w-full justify-between gap-1 px-2.5 pt-2 group-has-[>input]/input-group:pt-2 [.border-b]:pb-2",
        align === "inline-end" && "pr-2.5",
        align === "inline-start" && "pl-2.5",
        className
      )}
      onClick={(e) => {
        // Click anywhere on the addon row → focus the input control.
        if (!(e.target instanceof HTMLElement)) return
        if (e.target.closest("button, [role='button'], a, input, label")) return
        e.currentTarget.parentElement
          ?.querySelector<HTMLElement>("[data-slot='input-group-control']")
          ?.focus()
      }}
      {...props}
    />
  )
}

function InputGroupText({ className, ...props }: React.ComponentProps<"span">) {
  return (
    <span
      className={cn(
        "flex items-center gap-2 text-muted-foreground [&_svg]:pointer-events-none [&_svg:not([class*='size-'])]:size-4",
        className
      )}
      {...props}
    />
  )
}

function InputGroupInput({
  className,
  ...props
}: React.ComponentProps<"input">) {
  return (
    <input
      data-slot="input-group-control"
      className={cn(
        "flex w-full min-w-0 rounded-none border-0 bg-transparent text-base shadow-none ring-0 outline-none",
        "file:inline-flex file:h-7 file:border-0 file:bg-transparent file:text-sm file:font-medium file:text-foreground",
        "placeholder:text-muted-foreground",
        "focus-visible:ring-0 focus-visible:ring-offset-0",
        "disabled:cursor-not-allowed disabled:opacity-50",
        className
      )}
      {...props}
    />
  )
}

function InputGroupTextarea({
  className,
  ...props
}: React.ComponentProps<"textarea">) {
  return (
    <textarea
      data-slot="input-group-control"
      className={cn(
        "flex w-full border-input text-base transition-[color,box-shadow] outline-none placeholder:text-muted-foreground",
        "focus-visible:border-ring focus-visible:ring-ring/50",
        "disabled:cursor-not-allowed disabled:opacity-50",
        "aria-invalid:border-destructive aria-invalid:ring-destructive/20 md:text-sm dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40",
        "flex-1 resize-none rounded-none border-0 bg-transparent py-2 shadow-none ring-0 focus-visible:ring-0 aria-invalid:ring-0 dark:bg-transparent field-sizing-content",
        className
      )}
      {...props}
    />
  )
}

export {
  InputGroup,
  InputGroupAddon,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
}
