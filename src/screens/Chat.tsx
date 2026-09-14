// Carpool chat — running late, swaps, quick notes. Realtime via onChat.
import { useCallback, useEffect, useRef, useState, type FormEvent } from "react";
import { MessageCircle, Send } from "lucide-react";
import { useAuth } from "../context/auth";
import { api } from "../lib/api";
import { nav } from "../lib/nav";
import { dayLabel, fmtTime, istDayKey } from "../lib/format";
import type { ChatMessage } from "../lib/types";
import { Avatar, Button, Divider, EmptyState, IconButton, Input, Skeleton, TopBar, useToast, cn } from "../components/ui";

export default function Chat({ carpoolId }: { carpoolId: string }) {
  const { user } = useAuth();
  const u = user!;
  const toast = useToast();
  const [msgs, setMsgs] = useState<ChatMessage[] | null>(null);
  const [name, setName] = useState<string>("Chat");
  const [error, setError] = useState<string | null>(null);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const bottom = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try { setMsgs(await api.getChat(carpoolId)); setError(null); }
    catch (e) { setError(e instanceof Error ? e.message : "Couldn't load the chat."); setMsgs((m) => m ?? []); }
  }, [carpoolId]);
  useEffect(() => { void load(); api.getCarpool(carpoolId).then((c) => setName(c.name)).catch(() => { /* title stays generic */ }); }, [load, carpoolId]);
  useEffect(() => api.onChat(carpoolId, (m) => setMsgs((xs) => (xs && xs.some((x) => x.id === m.id) ? xs : [...(xs ?? []), m]))), [carpoolId]);
  useEffect(() => { bottom.current?.scrollIntoView({ block: "end" }); }, [msgs?.length]);

  async function send(e?: FormEvent) {
    e?.preventDefault();
    const body = text.trim();
    if (!body || sending) return;
    setSending(true);
    try { const m = await api.sendChat(carpoolId, body); setMsgs((xs) => (xs && xs.some((x) => x.id === m.id) ? xs : [...(xs ?? []), m])); setText(""); }
    catch (err) { toast.danger(err instanceof Error ? err.message : "Couldn't send."); }
    finally { setSending(false); }
  }

  const list = msgs ?? [];
  let lastDay = "";

  return (
    <div className="flex h-dvh flex-col bg-bg">
      <TopBar title={name} sub="Carpool chat" onBack={() => nav.back()} />
      <div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
        {error && <div className="mb-3 flex items-center gap-3 rounded-md bg-card p-3 text-sm hairline"><span className="min-w-0 flex-1 text-ink-700">{error}</span><Button size="sm" variant="soft" onClick={() => void load()}>Retry</Button></div>}
        {msgs === null ? (
          <Skeleton variant="row" lines={4} />
        ) : list.length === 0 ? (
          <EmptyState size="page" icon={MessageCircle} title="Say hello" sub="Running late? Swapping a day? Keep the carpool in the loop here." />
        ) : (
          <div className="grid gap-1.5">
            {list.map((m, idx) => {
              const day = istDayKey(m.created_at);
              const showDay = day !== lastDay; lastDay = day;
              const mine = m.sender_id === u.id;
              const prev = list[idx - 1];
              const cont = !!prev && prev.sender_id === m.sender_id && istDayKey(prev.created_at) === day && new Date(m.created_at).getTime() - new Date(prev.created_at).getTime() < 5 * 60000;
              return (
                <div key={m.id}>
                  {showDay && <Divider label={dayLabel(day)} spacing="sm" />}
                  <div className={cn("flex items-end gap-2", mine ? "flex-row-reverse" : "", cont && !showDay ? "mt-0" : "mt-2")}>
                    {!mine ? (cont && !showDay ? <span className="w-8 shrink-0" /> : <Avatar name={m.sender_name} size="sm" />) : null}
                    <div className={cn("max-w-[78%] min-w-0")}>
                      {!mine && !(cont && !showDay) && <p className="mb-0.5 px-1 text-xs font-semibold text-ink-500">{m.sender_name}</p>}
                      <div className={cn("rounded-lg px-3.5 py-2 text-base text-pretty", mine ? "rounded-br-sm bg-primary text-on-primary" : "rounded-bl-sm bg-card text-ink-900 shadow-card")}>
                        {m.body}
                        <span className={cn("tnum ml-2 inline-block align-baseline text-[11px]", mine ? "text-white/70" : "text-ink-500")}>{fmtTime(m.created_at)}</span>
                      </div>
                    </div>
                  </div>
                </div>
              );
            })}
            <div ref={bottom} />
          </div>
        )}
      </div>
      <form onSubmit={send} className="pb-safe flex shrink-0 items-center gap-2 border-t border-line bg-card/95 px-3 py-2 backdrop-blur-md">
        <Input value={text} onChange={(e) => setText(e.target.value)} placeholder="Message the carpool…" aria-label="Message" wrapperClassName="min-w-0 flex-1" autoComplete="off" enterKeyHint="send" />
        <IconButton type="submit" icon={Send} label="Send" variant="primary" loading={sending} disabled={!text.trim()} />
      </form>
    </div>
  );
}
