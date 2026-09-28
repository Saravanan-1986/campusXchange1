import { useEffect, useMemo, useRef, useState } from 'react';
import { useSearchParams, Link } from 'react-router-dom';
import { useQuery, useMutation, useQueryClient } from '@tanstack/react-query';
import api, { errMsg } from '../api/axios.js';
import { GlassCard, Badge, Spinner, EmptyState } from '../components/ui/primitives.jsx';
import { GradientButton } from '../components/ui/inputs.jsx';
import { useAuth } from '../store/auth.js';
import { useUI } from '../store/ui.js';

/**
 * Chat — the buyer ↔ seller conversation hub.
 *
 * Flow: liking a listing ("Wish to buy / lend") opens a thread anchored to that
 * listing (POST /transactions or /messages/quick). Threads live in MongoDB
 * (Conversation + Message documents); new bubbles arrive over the ACTIVE layer's
 * Socket.io hop ('message:new') and bump the unread badge on the sidebar,
 * topbar and dashboard cards.
 */
export default function Chat() {
  const { user } = useAuth();
  const qc = useQueryClient();
  const [params, setParams] = useSearchParams();
  const activeId = params.get('c') || '';
  const setChatUnread = useUI((s) => s.setChatUnread);
  const [draft, setDraft] = useState('');
  const [showList, setShowList] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const scrollRef = useRef(null);

  const { data: list, isLoading: listLoading } = useQuery({
    queryKey: ['conversations'],
    queryFn: async () => (await api.get('/messages/conversations')).data,
    refetchInterval: 15000,
  });

  const conversations = list?.conversations || [];

  // Keep the global chat badge in sync with the server's unread counters.
  useEffect(() => {
    if (list) setChatUnread(list.unreadTotal || 0);
  }, [list, setChatUnread]);

  // Default to the newest thread when none is selected in the URL.
  useEffect(() => {
    if (!activeId && conversations.length) {
      setParams({ c: String(conversations[0]._id) }, { replace: true });
    }
  }, [activeId, conversations, setParams]);

  const { data: thread, isLoading: threadLoading } = useQuery({
    queryKey: ['conversation', activeId],
    queryFn: async () => (await api.get(`/messages/conversations/${activeId}`)).data,
    enabled: !!activeId,
    refetchInterval: 6000,
  });

  // Opening a thread clears its server-side unread counter → refresh the badge
  // once per thread (not on every 6s poll, which would spin the list query).
  const clearedRef = useRef('');
  useEffect(() => {
    const cid = thread?.conversation?._id ? String(thread.conversation._id) : '';
    if (cid && clearedRef.current !== cid) {
      clearedRef.current = cid;
      qc.invalidateQueries({ queryKey: ['conversations'] });
    }
  }, [thread, qc]);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [thread?.messages?.length, activeId]);

  const send = useMutation({
    mutationFn: (body) => api.post(`/messages/conversations/${activeId}`, { body }),
    onSuccess: () => {
      setDraft('');
      qc.invalidateQueries({ queryKey: ['conversation', activeId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
    },
    onError: (err) => useUI.getState().pushToast({ title: 'Message failed', message: errMsg(err), variant: 'danger' }),
  });

  const [sellPriceInput, setSellPriceInput] = useState('');
  const [showSellPrompt, setShowSellPrompt] = useState(false);

  const runCommand = useMutation({
    mutationFn: ({ command, price }) =>
      api.post(`/messages/conversations/${activeId}/command`, { command, price }),
    onSuccess: (res) => {
      setShowSellPrompt(false);
      setSellPriceInput('');
      useUI.getState().pushToast({
        title: `Handover complete (${res.data.command})`,
        message: res.data.summary,
        variant: 'success',
      });
      qc.invalidateQueries({ queryKey: ['conversation', activeId] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['resources'] });
    },
    onError: (err) =>
      useUI.getState().pushToast({ title: 'Handover failed', message: errMsg(err), variant: 'danger' }),
  });

  // Seller/giver removes the listing straight from this window once the item
  // is sold or given away — same owner-guarded DELETE as the marketplace page.
  const removeListing = useMutation({
    mutationFn: (resourceId) => api.delete(`/resources/${resourceId}`),
    onSuccess: () => {
      setConfirmRemove(false);
      useUI.getState().pushToast({ title: 'Listing removed 🗑', message: 'It no longer appears on the marketplace.', variant: 'success' });
      qc.invalidateQueries({ queryKey: ['resources'] });
      qc.invalidateQueries({ queryKey: ['conversations'] });
      qc.invalidateQueries({ queryKey: ['conversation', activeId] });
    },
    onError: (err) => useUI.getState().pushToast({ title: 'Could not remove listing', message: errMsg(err), variant: 'danger' }),
  });

  // Switching threads resets the inline remove confirmation.
  useEffect(() => { setConfirmRemove(false); }, [activeId]);

  const submit = (e) => {
    e.preventDefault();
    const body = draft.trim();
    if (!body || !activeId || send.isPending) return;
    send.mutate(body);
  };

  const active = useMemo(
    () => conversations.find((c) => String(c._id) === activeId) || null,
    [conversations, activeId]
  );
  const peer = thread?.peer || active?.peer || null;
  const messages = thread?.messages || [];
  const totalUnread = list?.unreadTotal || 0;

  // Only the listing's owner (seller/giver) — or an admin — sees the remove action.
  const threadResource = active?.resource?._id ? active.resource : null;
  const canRemoveListing = !!(
    threadResource &&
    user &&
    (String(threadResource.ownerId?._id || threadResource.ownerId) === String(user.id) || user.role === 'admin')
  );

  return (
    <div>
      <div className="mb-5 flex flex-wrap items-center gap-3">
        <div>
          <h1 className="font-display text-2xl font-bold text-ink">Chat</h1>
          <p className="mt-1 text-sm text-ink-muted">
            Wish to buy or lend → the seller and you get a private thread here. Live over Socket.io.
          </p>
        </div>
        {totalUnread > 0 && (
          <Badge tone="danger" className="ml-auto">{totalUnread} new message{totalUnread > 1 ? 's' : ''}</Badge>
        )}
      </div>

      <div className="grid gap-5 lg:grid-cols-[320px_1fr]">
        {/* ---- Thread list ---- */}
        <GlassCard hover={false} className={`overflow-hidden ${showList ? '' : 'hidden lg:block'}`}>
          <div className="flex items-center justify-between border-b border-white/8 px-4 py-3">
            <span className="text-xs font-semibold uppercase tracking-wider text-ink-muted">Conversations</span>
            <span className="text-[11px] text-ink-muted">{conversations.length}</span>
          </div>
          {listLoading ? (
            <div className="grid h-40 place-items-center"><Spinner /></div>
          ) : !conversations.length ? (
            <div className="p-5">
              <EmptyState
                icon="💬"
                title="No chats yet"
                message="Open a listing you like and hit “Wish to buy / lend” — a thread opens automatically."
              />
            </div>
          ) : (
            <div className="max-h-[560px] overflow-auto">
              {conversations.map((c) => {
                const isActive = String(c._id) === activeId;
                return (
                  <button
                    key={c._id}
                    onClick={() => { setParams({ c: String(c._id) }); setShowList(false); }}
                    className={`w-full border-b border-white/6 px-4 py-3 text-left transition ${
                      isActive ? 'bg-accent/10 shadow-glow-sm' : 'hover:bg-white/5'
                    }`}
                  >
                    <div className="flex items-center gap-3">
                      <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-aurora font-display text-sm font-bold text-white">
                        {c.peer?.name?.[0]?.toUpperCase() || '?'}
                      </span>
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="truncate text-sm font-semibold text-ink">{c.peer?.name || 'Student'}</span>
                          {c.unread > 0 && (
                            <span className="ml-auto grid h-4 min-w-[18px] shrink-0 place-items-center rounded-full bg-danger px-1 text-[10px] font-bold text-white">
                              {c.unread > 9 ? '9+' : c.unread}
                            </span>
                          )}
                        </div>
                        <div className="truncate text-[11px] text-ink-muted">{c.lastMessagePreview || 'No messages yet'}</div>
                      </div>
                    </div>
                    {c.resource?.title && (
                      <div className="mt-1.5 truncate pl-12 text-[10px] text-primary-light/90">⇄ {c.resource.title}</div>
                    )}
                  </button>
                );
              })}
            </div>
          )}
        </GlassCard>

        {/* ---- Chat window ---- */}
        <GlassCard hover={false} className={`flex min-h-[560px] flex-col overflow-hidden ${showList ? 'hidden lg:flex' : 'flex'}`}>
          <div className="flex items-center gap-3 border-b border-white/8 px-5 py-3">
            <button onClick={() => setShowList(true)} className="text-xs text-ink-muted hover:text-ink lg:hidden">← threads</button>
            {peer ? (
              <>
                <span className="grid h-9 w-9 place-items-center rounded-xl bg-aurora font-display text-sm font-bold text-white">
                  {peer.name?.[0]?.toUpperCase()}
                </span>
                <div className="min-w-0">
                  <div className="truncate text-sm font-semibold text-ink">{peer.name}</div>
                  <div className="truncate text-[11px] text-ink-muted">{peer.department || '—'} · Sem {peer.semester || '—'}</div>
                </div>
              </>
            ) : (
              <span className="text-sm text-ink-muted">Pick a conversation</span>
            )}
            {active?.resource?._id && (
              <div className="ml-auto flex flex-wrap items-center gap-1.5">
                <Link
                  to={`/resources/${active.resource._id}`}
                  className="max-w-[160px] truncate rounded-lg border border-white/10 bg-white/5 px-2.5 py-1 text-[11px] text-primary-light hover:border-accent/50"
                >
                  ⇄ {active.resource.title}
                </Link>

                {canRemoveListing && (
                  <>
                    <button
                      onClick={() => runCommand.mutate({ command: 'donate' })}
                      disabled={runCommand.isPending}
                      title="Hand over to this user for free"
                      className="rounded-lg border border-accent/40 bg-accent/15 px-2.5 py-1 text-[11px] font-semibold text-accent-light hover:bg-accent/25 disabled:opacity-50"
                    >
                      🎁 Donate
                    </button>

                    {showSellPrompt ? (
                      <span className="flex items-center gap-1">
                        <input
                          type="number"
                          placeholder="₹"
                          value={sellPriceInput}
                          onChange={(e) => setSellPriceInput(e.target.value)}
                          className="w-16 rounded-lg border border-white/10 bg-white/5 px-2 py-0.5 text-[11px] text-ink outline-none"
                        />
                        <button
                          onClick={() => runCommand.mutate({ command: 'sell', price: Number(sellPriceInput) || 0 })}
                          disabled={runCommand.isPending}
                          className="rounded-lg border border-primary/40 bg-primary/20 px-2 py-0.5 text-[11px] font-semibold text-primary-light hover:bg-primary/30"
                        >
                          Confirm
                        </button>
                        <button
                          onClick={() => setShowSellPrompt(false)}
                          className="text-[10px] text-ink-muted hover:text-ink"
                        >
                          ✕
                        </button>
                      </span>
                    ) : (
                      <button
                        onClick={() => setShowSellPrompt(true)}
                        title="Sell to this user"
                        className="rounded-lg border border-primary/40 bg-primary/15 px-2.5 py-1 text-[11px] font-semibold text-primary-light hover:bg-primary/25"
                      >
                        🏷 Sell
                      </button>
                    )}

                    <button
                      onClick={() => runCommand.mutate({ command: 'remove' })}
                      disabled={runCommand.isPending}
                      title="Take listing off the marketplace"
                      className="rounded-lg border border-white/10 bg-white/5 px-2 py-1 text-[11px] text-danger/80 hover:border-danger/40 hover:text-danger disabled:opacity-50"
                    >
                      🗑 Remove
                    </button>
                  </>
                )}
              </div>
            )}
          </div>

          <div ref={scrollRef} className="flex-1 space-y-3 overflow-auto px-5 py-5">
            {!activeId ? (
              <div className="grid h-full place-items-center text-sm text-ink-muted">No thread selected.</div>
            ) : threadLoading ? (
              <div className="grid h-full place-items-center"><Spinner /></div>
            ) : !messages.length ? (
              <div className="grid h-full place-items-center text-sm text-ink-muted">Say hi 👋</div>
            ) : (
              messages.map((m) => {
                const mine = String(m.sender?._id || m.sender) === String(user?.id);
                if (m.system) {
                  return (
                    <div key={m._id} className="my-2 flex justify-center">
                      <div className="max-w-[85%] rounded-xl border border-accent/30 bg-accent/10 px-4 py-2 text-center text-xs text-ink shadow-glow-sm">
                        <span className="font-semibold text-accent-light">System: </span>
                        <span>{m.body}</span>
                        <div className="mt-0.5 text-[10px] text-ink-muted">
                          {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                        </div>
                      </div>
                    </div>
                  );
                }
                return (
                  <div key={m._id} className={`flex ${mine ? 'justify-end' : 'justify-start'}`}>
                    <div
                      className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 text-sm ${
                        mine ? 'bg-aurora text-white shadow-glow-sm' : 'border border-white/10 bg-white/[0.06] text-ink'
                      }`}
                    >
                      {!mine && <div className="mb-0.5 text-[10px] font-semibold text-accent-light">{m.sender?.name || peer?.name}</div>}
                      <div className="whitespace-pre-wrap break-words">{m.body}</div>
                      <div className={`mt-1 text-[10px] ${mine ? 'text-white/70' : 'text-ink-muted'}`}>
                        {new Date(m.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </div>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          <form onSubmit={submit} className="flex items-center gap-2 border-t border-white/8 px-4 py-3">
            <input
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              disabled={!activeId}
              placeholder={activeId ? 'Type a message…' : 'Select a conversation first'}
              className="flex-1 rounded-xl border border-white/10 bg-white/5 px-3.5 py-2.5 text-sm text-ink placeholder:text-ink-muted/60 outline-none focus:border-primary/60 disabled:opacity-50"
            />
            <GradientButton type="submit" size="sm" disabled={!draft.trim() || !activeId || send.isPending}>
              {send.isPending ? '…' : 'Send'}
            </GradientButton>
          </form>
        </GlassCard>
      </div>
    </div>
  );
}