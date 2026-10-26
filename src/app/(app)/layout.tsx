import { getContext } from "@/lib/session";
import { Shell } from "@/components/shell";
import { ScanProvider } from "@/components/scan-provider";
import { ToastProvider } from "@/components/toast";
import { ConfirmProvider } from "@/components/confirm";

export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const ctx = await getContext();
  return (
    <ToastProvider>
      <ConfirmProvider>
      <ScanProvider isManager={ctx.isManager}>
        <Shell isManager={ctx.isManager} orgName={ctx.org.trade_name} userName={ctx.fullName || ctx.email}>
          {children}
        </Shell>
      </ScanProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}
