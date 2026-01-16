import React from "react";
import { motion } from "framer-motion";
import { Heart, Sparkles } from "../icons";
import { useI18n } from "../../i18n";

export const Footer: React.FC = () => {
  const { t } = useI18n();

  return (
    <motion.footer
      initial={{ opacity: 0, y: 20 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ delay: 0.5 }}
      className="bg-white/80 backdrop-blur-sm border-t border-gray-200/50 py-4 px-6 relative overflow-hidden"
    >
      {/* Decorative gradient */}
      <div className="absolute inset-0 bg-gradient-to-r from-yoga-sage/5 via-transparent to-yoga-terracotta/5 pointer-events-none" />

      <div className="relative flex items-center justify-between text-sm text-gray-500">
        <motion.div
          className="flex items-center gap-2"
          whileHover={{ scale: 1.02 }}
        >
          <motion.div
            animate={{ scale: [1, 1.1, 1] }}
            transition={{
              duration: 2,
              repeat: Infinity,
              ease: "easeInOut",
            }}
          >
            <Sparkles size={14} className="text-yoga-sage" />
          </motion.div>
          <span className="font-medium bg-gradient-to-r from-yoga-deep to-yoga-sage bg-clip-text text-transparent">
            {t("footer.brand")}
          </span>
          <span className="text-gray-400">v1.0.0</span>
        </motion.div>

        <motion.div
          className="flex items-center gap-1"
          whileHover={{ scale: 1.02 }}
        >
          <span>{t("footer.made_with")}</span>
          <motion.div
            animate={{ scale: [1, 1.15, 1] }}
            transition={{
              duration: 0.8,
              repeat: Infinity,
              ease: "easeInOut",
            }}
            className="inline-flex"
          >
            <Heart
              size={14}
              className="text-yoga-terracotta"
              style={{ fill: 'currentColor' }}
            />
          </motion.div>
          <span>2025</span>
        </motion.div>
      </div>
    </motion.footer>
  );
};
