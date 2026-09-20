import type { ReactNode } from "react";
import { Link, useRouterState } from "@tanstack/react-router";
import { Bot, CalendarClock, History, Loader2, LogIn, LogOut, Menu, MessageSquarePlus, Server, PlugZap } from "lucide-react";
import { Logo } from "@/components/logo";
import { Button } from "@/components/ui/button";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuLabel, DropdownMenuSeparator, DropdownMenuTrigger } from "@/components/ui/dropdown-menu";
import { Sheet, SheetContent, SheetTrigger } from "@/components/ui/sheet";
import { ToolLink } from "@/components/tool-link";
import { APP_NAME, CHAT_NAV, MOTTO_TH, TOOLS } from "@/lib/catalog";
import { usePuter } from "@/lib/puter-context";
import { toast } from "sonner";

const NAV = [
  { to: "/agents", label: "Agents" },
  { to: "/models", label: "Models" },
  { to: "/plugins", label: "Plugins" },
  { to: "/pricing", label: "Free" },
  { to: "/docs", label: "Docs" },
];

const APP_LINKS = [
  { to: "/chat", label: "Chat", icon: CHAT_NAV.icon },
  { to: "/agents", label: "Agents", icon: Bot },
  { to: "/runner", label: "Runner", icon: TOOLS.find((t) => t.slug === "runner")!.icon },
  { to: "/sandbox", label: "Sandboxes", icon: Server },
  { to: "/plugins", label: "Plugins", icon: PlugZap },
  { to: "/routines", label: "Routines", icon: CalendarClock },
  { to: "/history", label: "History", icon: History },
];

function PuterChip() {
  const { ready, signedIn, user, signIn, signOut } = usePuter();
  if (!ready) return <span className="inline-flex h-9 max-w-32 items-center gap-1.5 rounded-full bg-elevated px-2.5 text-xs text-muted shadow-[var(--shadow-border)]"><Loader2 className="size-3.5 animate-spin" />Puter</span>;
  if (signedIn) {
    const label = user?.username || user?.email || "Puter";
    return <button type="button" onClick={() => void signOut()} className="inline-flex h-9 max-w-36 items-center gap-1.5 rounded-full bg-elevated px-2.5 text-xs text-muted shadow-[var(--shadow-border)] hover:text-fg sm:max-w-40" title="Sign out of Puter"><span className="size-1.5 shrink-0 rounded-full bg-ok" /><span className="truncate">{label}</span><LogOut className="size-3.5 shrink-0" /></button>;
  }
  return <Button size="sm" variant="secondary" onClick={() => void signIn().catch((err: unknown) => toast.error(err instanceof Error ? err.message : "Sign-in failed. Allow popups and retry."))}><LogIn className="size-4" /><span className="hidden sm:inline">Sign in with Puter</span><span className="sm:hidden">Puter</span></Button>;
}

function ToolsMenu() {
  return <DropdownMenu><DropdownMenuTrigger asChild><Button variant="ghost" size="sm">Tools</Button></DropdownMenuTrigger><DropdownMenuContent className="w-[min(22rem,calc(100vw-1.5rem))] p-2"><DropdownMenuLabel>Coding tools</DropdownMenuLabel><div className="grid grid-cols-1 sm:grid-cols-2">{TOOLS.map((t) => <DropdownMenuItem key={t.slug} asChild><ToolLink tool={t} className="items-start"><t.icon className="mt-0.5 size-4 text-primary" /><span><span className="block text-sm">{t.short}</span><span className="block text-xs text-subtle">{t.blurb.slice(0, 42)}</span></span></ToolLink></DropdownMenuItem>)}</div><DropdownMenuSeparator /><DropdownMenuItem asChild><Link to="/plugins"><PlugZap className="size-4 text-primary" />Plugins</Link></DropdownMenuItem><DropdownMenuItem asChild><Link to="/chat"><CHAT_NAV.icon className="size-4 text-primary" />AI Chat</Link></DropdownMenuItem></DropdownMenuContent></DropdownMenu>;
}

function Header() {
  const path = useRouterState({ select: (s) => s.location.pathname });
  return <header className="sticky top-0 z-40 border-b border-cyan-300/10 bg-[#03070c]/90 backdrop-blur-xl"><div className="mx-auto flex h-[76px] max-w-7xl items-center gap-2 px-4 sm:gap-3 sm:px-6 lg:px-8"><Sheet><SheetTrigger asChild><Button variant="ghost" size="icon-sm" className="shrink-0 text-slate-300 hover:bg-cyan-300/10 hover:text-cyan-200" aria-label="Open menu"><Menu className="size-5" /></Button></SheetTrigger><SheetContent side="left" className="p-4 pt-12"><Logo /><nav className="mt-6 flex flex-col gap-1">{APP_LINKS.map((l) => <Link key={l.to} to={l.to} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted hover:bg-elevated hover:text-fg"><l.icon className="size-4" />{l.label}</Link>)}<p className="mt-4 mb-1 px-2 text-xs uppercase tracking-wider text-subtle">Tools</p>{TOOLS.map((t) => <ToolLink key={t.slug} tool={t} className="flex items-center gap-2 rounded-md px-2 py-2 text-sm text-muted hover:bg-elevated hover:text-fg"><t.icon className="size-4" />{t.name}</ToolLink>)}</nav></SheetContent></Sheet><div className="flex min-w-0 items-center gap-2 sm:gap-3"><Logo /><span className="hidden whitespace-nowrap text-[11px] font-semibold tracking-[.28em] text-cyan-200/75 lg:block">AI · CODING · FUTURE</span></div><nav className="ml-4 hidden items-center gap-0.5 xl:flex"><ToolsMenu />{NAV.map((n) => <Button key={n.to} variant="ghost" size="sm" asChild><Link to={n.to} className={path.startsWith(n.to) ? "text-fg" : undefined}>{n.label}</Link></Button>)}</nav><div className="ml-auto flex min-w-0 items-center gap-2"><Button variant="secondary" size="sm" className="hidden h-11 rounded-2xl border-cyan-300/10 bg-[#071523] px-4 text-white hover:bg-cyan-300/10 sm:flex" asChild><Link to="/chat"><LogIn className="size-4" />คอมพิวเตอร์</Link></Button><PuterChip /><Button size="icon" className="size-11 shrink-0 rounded-2xl bg-cyan-300 text-slate-950 shadow-[0_0_35px_rgba(0,220,255,.28)] hover:bg-cyan-200" asChild><Link to="/chat" aria-label="เปิดแชท"><MessageSquarePlus className="size-5" /></Link></Button></div></div></header>;
}

function Footer() {
  return <footer className="border-t border-border"><div className="mx-auto grid max-w-6xl gap-8 px-4 py-10 sm:grid-cols-4"><div><Logo /><p className="mt-3 text-sm text-muted">{MOTTO_TH}</p><p className="mt-1 text-sm text-subtle">{APP_NAME}. ผู้ช่วย AI ของผู้บริหาร Bossnu SlieLo — Sign in with Puter. Run free models. Ship the fix.</p></div><div><p className="text-xs font-medium uppercase tracking-wider text-subtle">Product</p><ul className="mt-3 space-y-2 text-sm text-muted"><li><Link to="/chat" className="hover:text-fg">Chat</Link></li><li><Link to="/agents" className="hover:text-fg">Parallel agents</Link></li><li><Link to="/runner" className="hover:text-fg">Code runner</Link></li><li><Link to="/models" className="hover:text-fg">Models</Link></li></ul></div><div><p className="text-xs font-medium uppercase tracking-wider text-subtle">Tools</p><ul className="mt-3 space-y-2 text-sm text-muted">{TOOLS.slice(0, 6).map((t) => <li key={t.slug}><ToolLink tool={t} className="hover:text-fg">{t.name}</ToolLink></li>)}</ul></div><div><p className="text-xs font-medium uppercase tracking-wider text-subtle">Platform</p><ul className="mt-3 space-y-2 text-sm text-muted"><li><Link to="/plugins" className="hover:text-fg">Plugins & Connections</Link></li><li><Link to="/pricing" className="hover:text-fg">Free via Puter</Link></li><li><Link to="/docs" className="hover:text-fg">Documentation</Link></li><li><Link to="/sandbox" className="hover:text-fg">Sandboxes</Link></li><li><Link to="/routines" className="hover:text-fg">Routines</Link></li><li><Link to="/contact" className="hover:text-fg">Contact</Link></li></ul></div></div><div className="border-t border-border"><p className="mx-auto max-w-6xl px-4 py-4 text-xs text-subtle">© 2026 Bossnu SlieLo · พัฒนาโดย ภาณุพัน และ สลี่.ออลา · Models run through Puter. Threads stay in this browser.</p></div></footer>;
}

export function AppShell({ children, marketing = false }: { children: ReactNode; marketing?: boolean }) {
  return <div className="flex min-h-dvh flex-col bg-bg text-fg"><Header /><div className="flex-1">{children}</div><Footer /></div>;
}
