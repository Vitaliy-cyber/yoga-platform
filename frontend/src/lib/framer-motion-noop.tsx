import React from "react";

type AnyProps = Record<string, unknown>;

const MOTION_ONLY_PROPS = new Set([
  "initial",
  "animate",
  "exit",
  "variants",
  "transition",
  "whileHover",
  "whileTap",
  "whileFocus",
  "whileInView",
  "viewport",
  "layout",
  "layoutId",
  "drag",
  "dragConstraints",
  "dragElastic",
  "dragMomentum",
  "onAnimationStart",
  "onAnimationComplete",
  "onUpdate",
]);

const stripMotionProps = (props: AnyProps): AnyProps => {
  const cleaned: AnyProps = {};
  for (const [key, value] of Object.entries(props)) {
    if (!MOTION_ONLY_PROPS.has(key)) {
      cleaned[key] = value;
    }
  }
  return cleaned;
};

const componentCache = new Map<string, React.ComponentType<AnyProps>>();

const createMotionElement = (tag: string): React.ComponentType<AnyProps> =>
  React.forwardRef<HTMLElement, AnyProps>((props, ref) => {
    const cleaned = stripMotionProps(props);
    const { children, ...rest } = cleaned;
    return React.createElement(tag, { ...rest, ref }, children as React.ReactNode);
  });

export const motion = new Proxy(
  {},
  {
    get(_target, property: string) {
      if (!componentCache.has(property)) {
        componentCache.set(property, createMotionElement(property));
      }
      return componentCache.get(property);
    },
  },
) as Record<string, React.ComponentType<AnyProps>>;

export const AnimatePresence: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

export const MotionConfig: React.FC<{ children?: React.ReactNode }> = ({ children }) => {
  return <>{children}</>;
};

export const useReducedMotion = (): boolean => true;
