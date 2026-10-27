import { getContext } from "@/lib/session";
import { Shell } from "@/components/shell";
import { ScanProvider } from "@/components/scan-provider";
import { ToastProvider } from "@/components/toast";
import { ConfirmProvider } from "@/components/confirm";
import { pendingMigrations } from "@/lib/migrations";
import { DbUpdatesBanner } from "@/components/db-updates-banner";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  const pending = ctx.isManager ? await pendingMigrations().catch(() => [] as string[]) : [];
  return (
    <ToastProvider>
      <ConfirmProvider>
      <ScanProvider isManager={ctx.isManager}>
        <Shell isManager={ctx.isManager} orgName={ctx.org.trade_name} userName={ctx.fullName || ctx.email}>
          <DbUpdatesBanner count={pending.length} />
          {children}
        </Shell>
      </ScanProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
