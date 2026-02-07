import React from "react";
import { motion, useReducedMotion } from "framer-motion";
import { Heart, Sparkles } from "../icons";
import { useI18n } from "../../i18n";
import { fadeSlideUp } from "../../lib/animation-variants";

export const Footer: React.FC = () => {
  const { t } = useI18n();
  const shouldReduceMotion = useReducedMotion();

  return (
    <motion.footer
      variants={fadeSlideUp}
      initial={shouldReduceMotion ? false : "initial"}
      animate="animate"
      transition={{ delay: 0.5 }}
      className="bg-card/80 backdrop-blur-sm border-t py-4 px-6 relative overflow-hidden"
    >
      {/* Decorative gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-yoga-sage/5 via-transparent to-yoga-terracotta/5 pointer-events-none" />

      <div className="relative flex items-center justify-between text-sm text-muted-foreground">
        <div className="flex items-center gap-2">
          <div className={shouldReduceMotion ? "" : "animate-pulse-subtle"}>
            <Sparkles size={14} className="text-yoga-sage" />
          </div>
          <span className="font-medium bg-gradient-to-r from-yoga-deep to-yoga-sage bg-clip-text text-transparent">
            {t("footer.brand")}
          </span>
          <span className="text-muted-foreground/70">v1.0.0</span>
        </div>

        <div className="flex items-center gap-1">
          <span>{t("footer.made_with")}</span>
          <div className={shouldReduceMotion ? "inline-flex" : "inline-flex animate-heartbeat"}>
            <Heart
              size={14}
              className="text-yoga-terracotta"
              style={{ fill: 'currentColor' }}
            />
          </div>
          <span>2025</span>
        </div>
      </div>
    </motion.footer>
  );
};
