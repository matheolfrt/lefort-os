"use client";

import { Legend, MonthBars, MonthLine, RankBars, type Series } from "@/components/charts";
import type { StatsData } from "@/lib/stats";

const euro0 = new Intl.NumberFormat("fr-FR", { style: "currency", currency: "EUR", maximumFractionDigits: 0 });
const eur = (cents: number) => euro0.format(Math.round(cents / 100));
const count = (n: number) => n.toLocaleString("fr-FR", { maximumFractionDigits: 0 });
const days = (n: number) => `${Math.round(n)} j`;

function ChartCard({ title, sub, legend, children }: { title: string; sub?: string; legend?: Series[]; children: React.ReactNode }) {
  return (
    <section className="min-w-0 rounded-2xl border border-line bg-panel/80 p-4">
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-2">
        <div>
          <h2 className="font-semibold">{title}</h2>
          {sub && <p className="text-xs text-muted">{sub}</p>}
        </div>
        {legend && <Legend series={legend} />}
      </div>
      {children}
    </section>
  );
}

export function StatsCharts({ data }: { data: StatsData }) {
  const months = data.months.map((m) => m.month);
  const money: Series[] = [
    { label: "Chiffre d'affaires", color: "series-1", values: data.months.map((m) => m.revenueCents) },
    { label: "Marge brute", color: "series-2", values: data.months.map((m) => m.profitCents) },
  ];
  const flow: Series[] = [
    { label: "Entrées", color: "series-1", values: data.months.map((m) => m.received) },
    { label: "Ventes", color: "series-2", values: data.months.map((m) => m.sold) },
  ];
  const stock: Series = { label: "Articles en stock", color: "series-1", values: data.months.map((m) => m.stockEnd) };
  const delay: Series = { label: "Délai moyen", color: "series-1", values: data.months.map((m) => m.avgDays) };
  const top = (list: StatsData["brands"]) => list.slice(0, 8).map((r) => ({
    name: r.name, value: r.profitCents, detail: `${r.sold} vendu${r.sold > 1 ? "s" : ""} · ${eur(r.avgPriceCents)} en moyenne`,
  }));

  return (
    <div className="grid grid-cols-1 gap-3 lg:grid-cols-2">
      <div className="lg:col-span-2">
        <ChartCard title="Chiffre d'affaires et marge" sub="Par mois de vente, frais et coût d'achat déduits pour la marge" legend={money}>
          <MonthBars wide months={months} series={money} format={eur}
            extra={(i) => <div className="mt-1 border-t border-line pt-1 text-muted">{data.months[i].sold} article{data.months[i].sold > 1 ? "s" : ""} vendu{data.months[i].sold > 1 ? "s" : ""}</div>} />
        </ChartCard>
      </div>
      <ChartCard title="Entrées et ventes" sub="Articles reçus et vendus chaque mois" legend={flow}>
        <MonthBars months={months} series={flow} format={count} />
      </ChartCard>
      <ChartCard title="Stock en fin de mois" sub={`Aujourd'hui : ${count(data.stockNow.count)} articles, ${eur(data.stockNow.costCents)} au prix d'achat`}>
        <MonthLine months={months} series={stock} format={count} />
      </ChartCard>
      <ChartCard title="Délai moyen de vente" sub="De la mise en ligne à la vente">
        <MonthLine months={months} series={delay} format={days}
          extra={(i) => <div className="mt-1 text-muted">sur {data.months[i].daysN} vente{data.months[i].daysN > 1 ? "s" : ""}</div>} />
      </ChartCard>
      <ChartCard title="Ventes par prix" sub="Nombre d'articles vendus sur la période, marge totale">
        <RankBars format={count}
          rows={data.priceBands.map((b) => ({ name: b.label, value: b.sold, detail: `marge ${eur(b.profitCents)}` }))} />
      </ChartCard>
      <ChartCard title="Marques les plus rentables" sub="Marge brute sur la période">
        {data.brands.length ? <RankBars format={eur} rows={top(data.brands)} /> : <Empty />}
      </ChartCard>
      <ChartCard title="Catégories" sub="Marge brute sur la période">
        {data.categories.length ? <RankBars format={eur} rows={top(data.categories)} /> : <Empty />}
      </ChartCard>
    </div>
  );
}

function Empty() {
  return <p className="py-6 text-center text-sm text-muted">Aucune vente sur la période.</p>;
}
