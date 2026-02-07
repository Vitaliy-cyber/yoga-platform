import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { Loader2, Key, Sparkles } from 'lucide-react';
import { useI18n } from '../i18n';

export const Login: React.FC = () => {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);
  const { t } = useI18n();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError(t("login.error_empty"));
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login({ token: token.trim() });
      // Store user, access token, refresh token, and expiry
      setAuth(
        response.user,
        response.access_token,
        response.refresh_token,
        response.expires_in
      );
      navigate('/', { replace: true });
    } catch (err) {
      // Check if it's a rate limit error
      if ((err as Error & { isRateLimited?: boolean }).isRateLimited) {
        const retryAfter = (err as Error & { retryAfter: number }).retryAfter;
        setError(t("login.error_rate_limited", { seconds: retryAfter }));
      } else {
        setError(err instanceof Error ? err.message : t("login.error_failed"));
      }
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 via-stone-50 to-amber-50 dark:from-neutral-900 dark:via-neutral-900 dark:to-neutral-800 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-stone-800 dark:bg-stone-100 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Sparkles className="w-8 h-8 text-white dark:text-stone-800" />
          </div>
          <h1 className="text-3xl font-bold text-stone-800 dark:text-stone-100">{t("login.header")}</h1>
          <p className="text-stone-500 dark:text-stone-400 mt-2">{t("app.tagline")}</p>
        </div>

        {/* Login Card */}
        <div className="bg-white dark:bg-neutral-800 rounded-2xl shadow-xl border border-stone-200 dark:border-neutral-700 p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-stone-800 dark:text-stone-100">{t("login.title")}</h2>
            <p className="text-stone-500 dark:text-stone-400 text-sm mt-1">
              {t("login.subtitle")}
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="token" className="text-stone-700 dark:text-stone-300">
                {t("login.access_token")}
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400 dark:text-stone-500" />
                <Input
                  id="token"
                  type="password"
                  placeholder={t("login.placeholder")}
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pl-10 h-12 rounded-xl border-stone-200 dark:border-neutral-600 dark:bg-neutral-700 dark:text-stone-100 focus:border-stone-400 dark:focus:border-stone-500 focus:ring-stone-400 dark:focus:ring-stone-500"
                  disabled={isLoading}
                  autoComplete="off"
                  autoFocus
                />
              </div>
              <p className="text-xs text-stone-400 dark:text-stone-500">
                {t("login.token_hint")}
              </p>
            </div>

            {error && (
              <div
                className="bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 px-4 py-3 rounded-xl text-sm overflow-hidden"
                role="alert"
              >
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading || !token.trim()}
              className="w-full h-12 bg-stone-800 hover:bg-stone-900 dark:bg-stone-100 dark:hover:bg-stone-200 text-white dark:text-stone-800 rounded-xl font-medium"
            >
                {isLoading ? (
                  <>
                    <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                    {t("login.signing_in")}
                  </>
                ) : (
                  t("login.sign_in")
                )}

            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-stone-400 dark:text-stone-500 text-sm mt-6">
          {t("login.footer")}
        </p>
      </div>
    </div>
  );
};
