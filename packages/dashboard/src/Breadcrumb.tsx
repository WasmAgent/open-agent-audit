import { Link } from 'wouter'

export interface Crumb {
  label: string
  href?: string
}

export function Breadcrumb({ crumbs }: { crumbs: Crumb[] }) {
  return (
    <nav aria-label="Breadcrumb" className="flex items-center gap-1.5 text-xs text-slate-400 py-2 px-4 sm:px-6 max-w-5xl mx-auto w-full">
      {crumbs.map((crumb, i) => (
        <span key={crumb.label} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-slate-300">/</span>}
          {crumb.href ? (
            <Link href={crumb.href} className="hover:text-indigo-500 transition-colors">
              {crumb.label}
            </Link>
          ) : (
            <span className="text-slate-700 font-medium">{crumb.label}</span>
          )}
        </span>
      ))}
    </nav>
  )
}
