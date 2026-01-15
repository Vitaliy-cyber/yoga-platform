import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button } from '../components/ui/button';
import { Input } from '../components/ui/input';
import { Label } from '../components/ui/label';
import { authApi } from '../services/api';
import { useAuthStore } from '../store/useAuthStore';
import { Loader2, Key, Sparkles } from 'lucide-react';

export const Login: React.FC = () => {
  const [token, setToken] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const setAuth = useAuthStore((state) => state.setAuth);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!token.trim()) {
      setError('Please enter an access token');
      return;
    }

    setIsLoading(true);
    setError(null);

    try {
      const response = await authApi.login({ token: token.trim() });
      setAuth(response.user, response.access_token);
      navigate('/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Login failed');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-gradient-to-br from-stone-100 via-stone-50 to-amber-50 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        {/* Logo/Header */}
        <div className="text-center mb-8">
          <div className="w-16 h-16 bg-stone-800 rounded-2xl flex items-center justify-center mx-auto mb-4 shadow-lg">
            <Sparkles className="w-8 h-8 text-white" />
          </div>
          <h1 className="text-3xl font-bold text-stone-800">Pose Studio</h1>
          <p className="text-stone-500 mt-2">Educational Pose Visualization System</p>
        </div>

        {/* Login Card */}
        <div className="bg-white rounded-2xl shadow-xl border border-stone-200 p-8">
          <div className="mb-6">
            <h2 className="text-xl font-semibold text-stone-800">Welcome</h2>
            <p className="text-stone-500 text-sm mt-1">
              Enter your access token to continue. New tokens create new accounts automatically.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div className="space-y-2">
              <Label htmlFor="token" className="text-stone-700">
                Access Token
              </Label>
              <div className="relative">
                <Key className="absolute left-3 top-1/2 -translate-y-1/2 w-5 h-5 text-stone-400" />
                <Input
                  id="token"
                  type="text"
                  placeholder="Enter your unique token..."
                  value={token}
                  onChange={(e) => setToken(e.target.value)}
                  className="pl-10 h-12 rounded-xl border-stone-200 focus:border-stone-400 focus:ring-stone-400"
                  disabled={isLoading}
                  autoFocus
                />
              </div>
              <p className="text-xs text-stone-400">
                Your token is your identity. Keep it secret!
              </p>
            </div>

            {error && (
              <div className="bg-red-50 text-red-600 px-4 py-3 rounded-xl text-sm">
                {error}
              </div>
            )}

            <Button
              type="submit"
              disabled={isLoading || !token.trim()}
              className="w-full h-12 bg-stone-800 hover:bg-stone-900 text-white rounded-xl font-medium"
            >
              {isLoading ? (
                <>
                  <Loader2 className="w-4 h-4 mr-2 animate-spin" />
                  Signing in...
                </>
              ) : (
                'Sign In'
              )}
            </Button>
          </form>
        </div>

        {/* Footer */}
        <p className="text-center text-stone-400 text-sm mt-6">
          Your poses and categories are private to your account
        </p>
      </div>
    </div>
  );
};
