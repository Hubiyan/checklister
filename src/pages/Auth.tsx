import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { Auth as SupabaseAuth } from '@supabase/auth-ui-react';
import { ThemeSupa } from '@supabase/auth-ui-shared';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { ThemeToggle } from '@/components/ThemeToggle';
import { supabase } from '@/integrations/supabase/client';
import { useAuth } from '@/hooks/useAuth';
import { CheckSquare } from 'lucide-react';

const Auth = () => {
  const { user } = useAuth();
  const navigate = useNavigate();

  useEffect(() => {
    if (user) {
      navigate('/lists');
    }
  }, [user, navigate]);

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="flex justify-between items-center p-4">
        <div className="flex items-center gap-2">
          <CheckSquare className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold text-foreground">Checklister</h1>
        </div>
        <ThemeToggle />
      </header>

      <div className="flex-1 flex items-center justify-center p-4">
        <div className="w-full max-w-md">
          <div className="text-center mb-8">
            <h2 className="text-3xl font-bold text-foreground mb-2">
              Smart Grocery Lists
            </h2>
            <p className="text-muted-foreground">
              Create organized checklists from text, photos, and uploads
            </p>
          </div>

          <Card>
            <CardHeader>
              <CardTitle>Sign In</CardTitle>
              <CardDescription>
                Sign in to your account or create a new one
              </CardDescription>
            </CardHeader>
            <CardContent>
              <SupabaseAuth
                supabaseClient={supabase}
                appearance={{
                  theme: ThemeSupa,
                  variables: {
                    default: {
                      colors: {
                        brand: 'hsl(var(--primary))',
                        brandAccent: 'hsl(var(--primary))',
                      },
                    },
                  },
                  className: {
                    container: 'auth-container',
                    button: 'auth-button',
                    input: 'auth-input',
                  },
                }}
                providers={['google']}
                redirectTo={window.location.origin}
                onlyThirdPartyProviders={false}
              />
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Auth;