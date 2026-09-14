// App root: theme boot, providers, and the auth gate.
//   loading → spinner · needsOnboarding → Onboarding · no user → Auth · else Shell
import { useEffect } from "react";
import { AuthProvider, useAuth } from "./context/auth";
import { ConfirmHost, Spinner, ToastHost } from "./components/ui";
import { initTheme } from "./lib/theme";
import Auth from "./screens/Auth";
import Onboarding from "./screens/Onboarding";
import Shell from "./screens/Shell";

function Gate() {
  const { user, loading, needsOnboarding } = useAuth();
  if (loading) {
    return (
      <div className="grid min-h-dvh place-items-center">
        <div className="flex flex-col items-center gap-3 text-ink-500">
          <Spinner size="lg" label="Loading VVS Carpool" />
          <span className="text-sm">Getting things ready…</span>
        </div>
      </div>
    );
  }
  if (needsOnboarding) return <Onboarding />;
  if (!user) return <Auth />;
  return <Shell />;
}

export default function App() {
  useEffect(() => { initTheme(); }, []);
  return (
    <AuthProvider>
      <ToastHost>
        <ConfirmHost>
          <div className="mx-auto min-h-dvh w-full max-w-[480px] bg-bg">
            <Gate />
          </div>
        </ConfirmHost>
      </ToastHost>
    </AuthProvider>
  );
}
