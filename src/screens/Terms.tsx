// Terms gate — shown to a parent whenever the school publishes a new version.
// Nothing else is reachable until they accept (or sign out).
import { useEffect, useState } from "react";
import { FileText } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { Button, Card, Logo, Skeleton, useToast } from "../components/ui";

export default function Terms() {
  const { user, refresh, signOut } = useAuth();
  const toast = useToast();
  const [tnc, setTnc] = useState<{ version: number; body: string } | null>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => { api.latestTnc().then(setTnc).catch(() => setTnc({ version: user?.latest_tnc ?? 0, body: "" })); }, [user?.latest_tnc]);

  async function accept() {
    setBusy(true);
    try { await api.acceptTnc(); await refresh(); toast.ok("Thanks — you're all set."); }
    catch (e) { toast.danger(e instanceof Error ? e.message : "Couldn't record your acceptance."); }
    finally { setBusy(false); }
  }

  return (
    <div className="anim-rise flex min-h-dvh flex-col px-5 pb-8 pt-10">
      <div className="flex items-center gap-3">
        <Logo size={44} />
        <div>
          <p className="text-xs font-semibold uppercase tracking-wide text-ink-500">Vasant Valley Carpool</p>
          <h1 className="text-xl leading-7">Updated terms</h1>
        </div>
      </div>
      <p className="mt-4 text-sm text-ink-700">
        The school has published a new version of the Terms & Conditions{tnc ? ` (v${tnc.version})` : ""}. Please read and accept them to continue using the carpool.
      </p>
      <Card padding="md" className="mt-4 max-h-[50dvh] overflow-y-auto">
        <div className="mb-2 flex items-center gap-2 text-sm font-semibold text-ink-900"><FileText size={16} aria-hidden /> Terms & Conditions{tnc ? ` · v${tnc.version}` : ""}</div>
        {tnc ? <p className="whitespace-pre-wrap text-sm leading-relaxed text-ink-700">{tnc.body}</p> : <Skeleton variant="text" lines={6} />}
      </Card>
      <div className="mt-auto grid gap-2 pt-6">
        <Button size="lg" loading={busy} disabled={!tnc} onClick={accept} full>I accept the updated terms</Button>
        <Button variant="ghost" onClick={() => void signOut()} full>Sign out</Button>
      </div>
    </div>
  );
}
