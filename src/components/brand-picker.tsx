"use client";

import { useId, useState } from "react";
import { supabaseBrowser } from "@/lib/supabase/client";
import { input } from "@/components/ui";
import type { Brand } from "@/lib/types";

/** Type-ahead brand field. Unknown names are created on the fly (new brands appear in every lot). */
export function BrandPicker({ brands, value, onChange, orgId, onCreated }: {
  brands: Brand[];
  value: string | null;
  onChange: (id: string | null) => void;
  orgId: string;
  onCreated: (b: Brand) => void;
}) {
  const listId = useId();
  const current = brands.find((b) => b.id === value)?.name ?? "";
  const [text, setText] = useState(current);
  const [shown, setShown] = useState(value);
  if (shown !== value) {
    setShown(value);
    setText(current);
  }

  async function commit(name: string) {
    const trimmed = name.trim();
    if (!trimmed) return onChange(null);
    const match = brands.find((b) => b.name.toLowerCase() === trimmed.toLowerCase());
    if (match) {
      setText(match.name);
      return onChange(match.id);
    }
    const { data, error } = await supabaseBrowser()
      .from("brands")
      .insert({ org_id: orgId, name: trimmed })
      .select("id, name, tier")
      .single();
    if (!error && data) {
      onCreated(data as Brand);
      onChange(data.id);
    }
  }

  return (
    <>
      <input
        className={input}
        list={listId}
        value={text}
        placeholder="Marque"
        autoCapitalize="words"
        onChange={(e) => {
          setText(e.target.value);
          const m = brands.find((b) => b.name.toLowerCase() === e.target.value.toLowerCase());
          if (m) onChange(m.id);
        }}
        onBlur={(e) => commit(e.target.value)}
      />
      <datalist id={listId}>
        {brands.map((b) => <option key={b.id} value={b.name} />)}
      </datalist>
    </>
  );
}
