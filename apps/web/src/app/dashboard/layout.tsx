import Link from 'next/link';
import { UserButton } from '@clerk/nextjs';
import { NotificationBell } from '@/components/crm/NotificationBell';
import { ThemeToggle } from '@/components/ThemeProvider';

/** Navigation grouped by job-to-be-done: Understand / Act / Support / Configure. */
const NAV_GROUPS: Array<{ label: string; items: Array<{ href: string; label: string }> }> = [
  {
    label: 'Understand',
    items: [
      { href: '/dashboard', label: 'Home' },
      { href: '/dashboard/sales', label: 'Sales' },
    ],
  },
  {
    label: 'Act',
    items: [
      { href: '/dashboard/contacts', label: 'Contacts' },
      { href: '/dashboard/companies', label: 'Companies' },
      { href: '/dashboard/customers', label: 'Customers' },
      { href: '/dashboard/leads', label: 'Leads' },
      { href: '/dashboard/deals', label: 'Deals' },
      { href: '/dashboard/tasks', label: 'Tasks' },
      { href: '/dashboard/calendar', label: 'Calendar' },
    ],
  },
  {
    label: 'Support',
    items: [
      { href: '/dashboard/calls', label: 'Calls' },
      { href: '/dashboard/notifications', label: 'Notifications' },
    ],
  },
  {
    label: 'Configure',
    items: [
      { href: '/dashboard/settings/custom-fields', label: 'Custom fields' },
      { href: '/dashboard/settings/pipelines', label: 'Pipelines' },
      { href: '/dashboard/settings/integrations', label: 'Integrations' },
      { href: '/dashboard/settings/shopify', label: 'Shopify' },
    ],
  },
];

export default function DashboardLayout({ children }: { children: React.ReactNode }) {
  return (
    <div className="min-h-screen">
      <header className="sticky top-0 z-10 border-b border-slate-200 bg-white dark:border-slate-800 dark:bg-slate-900">
        <div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3">
          <div className="flex min-w-0 items-center gap-5 overflow-x-auto">
            <Link href="/dashboard" className="shrink-0 text-lg font-semibold text-slate-900 dark:text-slate-100">
              CRM
            </Link>
            {NAV_GROUPS.map((group) => (
              <nav key={group.label} className="flex shrink-0 flex-col gap-0.5">
                <span className="text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-slate-500">
                  {group.label}
                </span>
                <div className="flex items-center gap-3">
                  {group.items.map((item) => (
                    <Link
                      key={item.href}
                      href={item.href}
                      className="whitespace-nowrap text-sm font-medium text-slate-600 hover:text-brand-600 dark:text-slate-300 dark:hover:text-brand-500"
                    >
                      {item.label}
                    </Link>
                  ))}
                </div>
              </nav>
            ))}
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <ThemeToggle />
            <NotificationBell />
            <UserButton afterSignOutUrl="/" />
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-4 py-6">{children}</main>
    </div>
  );
}
