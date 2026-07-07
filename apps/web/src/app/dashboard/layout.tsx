import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { NotificationBell } from '@/components/crm/NotificationBell';

const NAV = [
  { href: '/dashboard', label: 'Home' },
  { href: '/dashboard/sales', label: 'Sales' },
  { href: '/dashboard/contacts', label: 'Contacts' },
  { href: '/dashboard/companies', label: 'Companies' },
  { href: '/dashboard/leads', label: 'Leads' },
  { href: '/dashboard/deals', label: 'Deals' },
  { href: '/dashboard/tasks', label: 'Tasks' },
  { href: '/dashboard/calendar', label: 'Calendar' },
  { href: '/dashboard/calls', label: 'Calls' },
  { href: '/dashboard/settings/custom-fields', label: 'Settings' },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-5xl items-center justify-between gap-4 px-4 py-3">
          <nav className="flex items-center gap-4 overflow-x-auto">
            <Link href="/dashboard" className="text-lg font-semibold">
              CRM
            </Link>
            {NAV.slice(1).map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-brand-600"
              >
                {item.label}
              </Link>
            ))}
          </nav>
          <div className="flex items-center gap-2">
            <NotificationBell />
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-5xl px-4 py-6">{children}</main>
    </div>
  );
}
