import React, { useEffect, useRef } from 'react';
import { Link } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Plus, Loader2, Layers } from 'lucide-react';
import { Button } from '../ui/button';
import { SequenceCard } from './SequenceCard';
import { useSequenceStore } from '../../store/useSequenceStore';
import { useI18n } from '../../i18n';

export const SequenceList: React.FC = () => {
  const { t } = useI18n();
  const {
    sequences,
    total,
    skip,
    limit,
    isLoading,
    error,
    fetchSequences,
    setPage,
  } = useSequenceStore();

  // Use ref to track if initial fetch has been done to prevent infinite loop
  // fetchSequences is stable from zustand, but we use a ref for extra safety
  const hasFetchedRef = useRef(false);

  useEffect(() => {
    // Only fetch on initial mount
    if (!hasFetchedRef.current) {
      hasFetchedRef.current = true;
      fetchSequences();
    }
  }, []); // Empty dependency array - only run on mount

  const currentPage = Math.floor(skip / limit) + 1;
  const totalPages = Math.ceil(total / limit);

  const handlePrevPage = () => {
    if (skip > 0) {
      setPage(skip - limit);
    }
  };

  const handleNextPage = () => {
    if (skip + limit < total) {
      setPage(skip + limit);
    }
  };

  if (error) {
    return (
      <div className="text-center py-20">
        <div className="w-20 h-20 rounded-full bg-rose-100 flex items-center justify-center mx-auto mb-4">
          <Layers className="w-10 h-10 text-rose-400" />
        </div>
        <h3 className="text-lg font-medium text-foreground mb-2">{t('sequences.error_fetch')}</h3>
        <p className="text-muted-foreground mb-4">{error}</p>
        <Button onClick={() => fetchSequences()}>{t('app.retry')}</Button>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="bg-card border-b border-border sticky top-0 z-40">
        <div className="max-w-7xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-2xl font-semibold text-foreground">{t('sequences.title')}</h1>
            <p className="text-muted-foreground text-sm mt-0.5">
              {t('sequences.subtitle', { count: total })}
            </p>
          </div>
          <Link to="/sequences/new">
            <Button className="bg-primary hover:bg-primary/90 text-primary-foreground rounded-xl h-11 px-5">
              <Plus className="w-4 h-4 mr-2" />
              {t('sequences.new')}
            </Button>
          </Link>
        </div>
      </header>

      {/* Content */}
      <main className="max-w-7xl mx-auto px-6 py-8">
        {isLoading ? (
          <div className="flex items-center justify-center py-20">
            <Loader2 className="w-8 h-8 text-muted-foreground/70 animate-spin" />
          </div>
        ) : sequences.length === 0 ? (
          <motion.div
            initial={{ opacity: 0, y: 20 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-center py-20"
          >
            <div className="w-20 h-20 rounded-full bg-muted flex items-center justify-center mx-auto mb-4">
              <Layers className="w-10 h-10 text-muted-foreground/70" />
            </div>
            <h3 className="text-lg font-medium text-foreground mb-2">{t('sequences.empty')}</h3>
            <p className="text-muted-foreground mb-6">{t('sequences.empty_hint')}</p>
            <Link to="/sequences/new">
              <Button className="bg-primary hover:bg-primary/90 text-primary-foreground">
                <Plus className="w-4 h-4 mr-2" />
                {t('sequences.create_first')}
              </Button>
            </Link>
          </motion.div>
        ) : (
          <>
            {/* Grid */}
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-6"
            >
              {sequences.map((sequence, index) => (
                <motion.div
                  key={sequence.id}
                  initial={{ opacity: 0, y: 20 }}
                  animate={{ opacity: 1, y: 0 }}
                  transition={{ delay: Math.min(index * 0.05, 0.3) }}
                >
                  <SequenceCard sequence={sequence} />
                </motion.div>
              ))}
            </motion.div>

            {/* Pagination */}
            {totalPages > 1 && (
              <div className="flex items-center justify-center gap-4 mt-8">
                <Button
                  variant="outline"
                  onClick={handlePrevPage}
                  disabled={skip === 0}
                >
                  {t('app.previous')}
                </Button>
                <span className="text-sm text-muted-foreground">
                  {t('app.page_of', { current: currentPage, total: totalPages })}
                </span>
                <Button
                  variant="outline"
                  onClick={handleNextPage}
                  disabled={skip + limit >= total}
                >
                  {t('app.next')}
                </Button>
              </div>
            )}
          </>
        )}
      </main>
    </div>
  );
};
