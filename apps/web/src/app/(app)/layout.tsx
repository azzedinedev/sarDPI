import { Shell } from '@/components/layout/shell';

export default function AppLayout({ children }: { children: React.ReactNode }): React.ReactElement {
  return <Shell>{children}</Shell>;
}
