"use client";

import { useId, useState } from "react";
import type { SupabaseClient } from "@supabase/supabase-js";
import { AlertCircle, CircleCheck, Loader2, LogIn, UserPlus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { FREE_SCAN_LIMIT } from "@/lib/account/limits";
import { cn } from "@/lib/utils";

export type AuthMode = "sign-in" | "sign-up";

const MIN_PASSWORD = 8;

export function AuthDialog({
  supabase,
  mode,
  onModeChange,
  onClose,
}: {
  supabase: SupabaseClient;
  /** null = closed. */
  mode: AuthMode | null;
  onModeChange: (mode: AuthMode) => void;
  onClose: () => void;
}) {
  const emailId = useId();
  const passwordId = useId();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const isSignUp = mode === "sign-up";

  function switchMode(next: AuthMode) {
    setError(null);
    setNotice(null);
    onModeChange(next);
  }

  function close() {
    if (busy) return;
    setError(null);
    setNotice(null);
    setPassword("");
    onClose();
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setError(null);
    setNotice(null);
    if (!/^\S+@\S+\.\S+$/.test(email.trim())) return setError("Enter a valid email address.");
    if (password.length < MIN_PASSWORD) return setError(`Use a password with at least ${MIN_PASSWORD} characters.`);

    setBusy(true);
    try {
      if (isSignUp) {
        const { data, error } = await supabase.auth.signUp({
          email: email.trim(),
          password,
          options: { emailRedirectTo: window.location.origin },
        });
        if (error) return setError(error.message);
        if (!data.session) {
          // Supabase "Confirm email" is on: the account exists but needs the link first.
          return setNotice(`Check ${email.trim()} for a confirmation link, then sign in.`);
        }
      } else {
        const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password });
        if (error) return setError(error.message === "Invalid login credentials" ? "Wrong email or password." : error.message);
      }
      setPassword("");
      onClose();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Dialog open={mode !== null} onOpenChange={(open) => !open && close()}>
      <DialogContent className="gap-5 p-6 sm:max-w-sm">
        <DialogHeader className="gap-1.5">
          <DialogTitle className="text-xl font-semibold tracking-tight">
            {isSignUp ? "Create your free account" : "Welcome back"}
          </DialogTitle>
          <DialogDescription>
            {isSignUp
              ? `Free accounts include ${FREE_SCAN_LIMIT} scans. Upgrade to Pro any time for unlimited scans.`
              : "Sign in to see your plan and keep scanning."}
          </DialogDescription>
        </DialogHeader>

        <div className="grid grid-cols-2 gap-1 rounded-lg bg-muted p-1 text-sm" role="tablist">
          {(["sign-in", "sign-up"] as const).map((m) => (
            <button
              key={m}
              type="button"
              role="tab"
              aria-selected={mode === m}
              onClick={() => switchMode(m)}
              className={cn(
                "rounded-md py-1.5 font-medium transition-colors",
                mode === m ? "bg-background shadow-xs" : "text-muted-foreground hover:text-foreground",
              )}
            >
              {m === "sign-in" ? "Sign in" : "Sign up"}
            </button>
          ))}
        </div>

        <form onSubmit={submit} noValidate className="space-y-3">
          <div className="space-y-1.5">
            <label htmlFor={emailId} className="text-sm font-medium">
              Email
            </label>
            <Input
              id={emailId}
              type="email"
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="h-10"
              required
            />
          </div>
          <div className="space-y-1.5">
            <label htmlFor={passwordId} className="text-sm font-medium">
              Password
            </label>
            <Input
              id={passwordId}
              type="password"
              autoComplete={isSignUp ? "new-password" : "current-password"}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="h-10"
              required
              minLength={MIN_PASSWORD}
            />
          </div>

          {error && (
            <p className="flex items-start gap-1.5 text-sm text-destructive" role="alert">
              <AlertCircle className="mt-0.5 size-4 shrink-0" /> {error}
            </p>
          )}
          {notice && (
            <p className="flex items-start gap-1.5 text-sm text-success" role="status">
              <CircleCheck className="mt-0.5 size-4 shrink-0" /> {notice}
            </p>
          )}

          <Button type="submit" size="lg" disabled={busy} className="h-11 w-full gap-2 text-base">
            {busy ? (
              <Loader2 className="size-4 animate-spin" />
            ) : isSignUp ? (
              <UserPlus className="size-4" />
            ) : (
              <LogIn className="size-4" />
            )}
            {isSignUp ? "Create account" : "Sign in"}
          </Button>
        </form>
      </DialogContent>
    </Dialog>
  );
}
