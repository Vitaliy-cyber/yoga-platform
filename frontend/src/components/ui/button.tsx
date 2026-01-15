import * as React from "react"

import { cva, type VariantProps } from "class-variance-authority"
import { motion, HTMLMotionProps } from "framer-motion"
import { cn } from "../../lib/utils"

const buttonVariants = cva(
    "inline-flex items-center justify-center whitespace-nowrap rounded-xl text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-stone-400 focus-visible:ring-offset-2 disabled:pointer-events-none disabled:opacity-50",
    {
        variants: {
            variant: {
                default: "bg-stone-800 text-white hover:bg-stone-900",
                destructive: "bg-red-500 text-white hover:bg-red-600",
                outline: "border border-stone-200 bg-white hover:bg-stone-50 text-stone-800",
                secondary: "bg-stone-100 text-stone-800 hover:bg-stone-200",
                ghost: "hover:bg-stone-100 text-stone-600 hover:text-stone-800",
                link: "text-stone-600 underline-offset-4 hover:underline",
            },
            size: {
                default: "h-10 px-4 py-2",
                sm: "h-8 rounded-lg px-3 text-xs",
                lg: "h-12 rounded-xl px-8 text-base",
                icon: "h-10 w-10",
            },
        },
        defaultVariants: {
            variant: "default",
            size: "default",
        },
    }
)

export interface ButtonProps
    extends Omit<React.ButtonHTMLAttributes<HTMLButtonElement>, "onAnimationStart" | "onDragStart" | "onDragEnd" | "onDrag">,
    VariantProps<typeof buttonVariants> {
    asChild?: boolean
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
    ({ className, variant, size, asChild = false, ...props }, ref) => {
        return (
            <button
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
Button.displayName = "Button"

const MotionButton = React.forwardRef<HTMLButtonElement, ButtonProps & HTMLMotionProps<"button">>(
    ({ className, variant, size, ...props }, ref) => {
        return (
            <motion.button
                whileTap={{ scale: 0.97 }}
                className={cn(buttonVariants({ variant, size, className }))}
                ref={ref}
                {...props}
            />
        )
    }
)
MotionButton.displayName = "MotionButton"

export { Button, MotionButton, buttonVariants }
