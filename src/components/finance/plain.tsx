import type { ReactNode } from "react";
import { HandCoins, Package, TrendingUp, Wallet } from "lucide-react";
import { euro } from "@/lib/finance";
import type { FinanceData } from "@/lib/finance/server";

/** « En clair » : the answer to « Où est mon argent ? » in four sentences, before any table or ratio */
export function Plain({ f }: { f: FinanceData }) {
  const { o, cash, cap, perf, fc, budget, draw } = f;
  const B = ({ children }: { children: ReactNode }) => <strong className="figure font-semibold tabular-nums text-fg">{children}</strong>;
  const s = (n: number) => (n > 1 ? "s" : "");
  const perDay = fc.itemsPerDay > 0 ? fc.itemsPerDay : perf.items / Math.max(1, perf.days);
  const cover = perDay > 0 ? Math.round(o.stock.count / perDay) : null;
  const recv = o.receivable.amount_cents;
  const perPiece = perf.items ? perf.net / perf.items : null;

  const rows: { id: string; icon: ReactNode; text: ReactNode }[] = [
    {
      id: "capital", icon: <Wallet size={18} aria-hidden />,
      text: cash.known ? (
        <>Vous avez <B>{euro(cap.total)}</B> dans votre activité : {euro(cap.cash)} sur votre compte, {euro(cap.stock)} de stock au prix d&apos;achat
          {recv > 0 && <> et {euro(recv)} que Vinted doit encore vous verser</>}.</>
      ) : (
        <>Sans compter votre compte en banque, vous avez <B>{euro(cap.total)}</B> dans votre activité : {euro(cap.stock)} de stock au prix d&apos;achat
          {recv > 0 && <> et {euro(recv)} que Vinted doit encore vous verser</>}.</>
      ),
    },
    {
      id: "gain", icon: <TrendingUp size={18} aria-hidden />,
      text: perf.items ? (
        <>Ces {perf.days} derniers jours, vous avez vendu {perf.items} pièce{s(perf.items)} pour {euro(perf.revenue)}. Achats, frais, cotisations et charges retirés,{" "}
          {perf.net >= 0 ? <>il vous reste <B>{euro(perf.net)}</B></> : <>il vous manque <B>{euro(-perf.net)}</B></>}
          {perPiece != null && perf.net > 0 && <>, soit {euro(perPiece)} par pièce</>}.</>
      ) : <>Aucune vente ces {perf.days} derniers jours.</>,
    },
    {
      id: "stock", icon: <Package size={18} aria-hidden />,
      text: (
        <>Votre stock compte <B>{o.stock.count} pièce{s(o.stock.count)}</B>, affichée{s(o.stock.count)} {euro(o.stock.price_cents)} en tout
          {cover != null && <> : de quoi vendre pendant {cover} jour{s(cover)} au rythme actuel</>}
          {o.stock.dormant_count > 0 && <>. {o.stock.dormant_count} {o.stock.dormant_count > 1 ? "attendent" : "attend"} depuis plus de {o.settings.dead_stock_days} jours</>}.</>
      ),
    },
    {
      id: "achat", icon: <HandCoins size={18} aria-hidden />,
      text: !budget.known ? (
        <>Indiquez le solde de votre compte pour savoir combien racheter et combien il reste pour vous.</>
      ) : (
        <>{budget.recommended > 0
          ? <>Vous pouvez racheter pour <B>{euro(budget.recommended)}</B> de stock ({budget.reason}).</>
          : <>Pas d&apos;achat conseillé pour l&apos;instant : {budget.reason}.</>}{" "}
          {draw.cents > 0 ? <>Il reste <B>{euro(draw.cents)}</B> disponible pour vous.</> : <>Rien n&apos;est disponible pour vous sans toucher à la réserve.</>}</>
      ),
    },
  ];
  return (
    <section aria-labelledby="plain-t" data-testid="plain" className="rounded-2xl border border-accent/25 bg-accent/[0.05] p-4 sm:p-5">
      <h2 id="plain-t" className="eyebrow-tight mb-3 text-accent">En clair</h2>
      <ul className="space-y-3">
        {rows.map((r) => (
          <li key={r.id} data-plain={r.id} className="flex gap-3 text-[15px] leading-relaxed text-fg/85">
            <span className="mt-0.5 inline-flex size-8 shrink-0 items-center justify-center rounded-full bg-accent/15 text-accent">{r.icon}</span>
            <p className="min-w-0">{r.text}</p>
          </li>
        ))}
      </ul>
    </section>
  );
}
