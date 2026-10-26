"use client";

import { supabaseBrowser } from "@/lib/supabase/client";
import { errorMessage } from "@/lib/errors";

export interface RpcFailure { code: string; message: string }

/** Like rpc() but keeps the database error code, so the board can react to it (LF422 = step not finished, …) */
export async function call<T>(fn: string, args: Record<string, unknown> = {}): Promise<{ data: T | null; error: RpcFailure | null }> {
  const { data, error } = await supabaseBrowser().rpc(fn, args);
  if (error) return { data: null, error: { code: error.code ?? "", message: errorMessage(error) } };
  return { data: data as T, error: null };
}

// Signed photo URLs, shared by every card and kept for the session (they last an hour)
const photoCache = new Map<string, string>();
const pending = new Set<string>();

export async function signPhotos(paths: (string | null)[]): Promise<boolean> {
  const todo = [...new Set(paths.filter((p): p is string => !!p && !photoCache.has(p) && !pending.has(p)))];
  if (!todo.length) return false;
  todo.forEach((p) => pending.add(p));
  for (let i = 0; i < todo.length; i += 100) {
    const chunk = todo.slice(i, i + 100);
    const { data } = await supabaseBrowser().storage.from("item-photos").createSignedUrls(chunk, 3600);
    (data ?? []).forEach((d: { signedUrl: string | null }, j: number) => { if (d.signedUrl) photoCache.set(chunk[j], d.signedUrl); });
  }
  todo.forEach((p) => pending.delete(p));
  return true;
}

export const photoUrl = (path: string | null) => (path ? photoCache.get(path) ?? null : null);
