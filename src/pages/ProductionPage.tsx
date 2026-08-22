import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  Check,
  Copy,
  ExternalLink,
  KeyRound,
  Loader2,
  LogOut,
  QrCode,
  Search,
  Wrench,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { materials, getMaterial, getVariation } from '@/config/materials'
import { cn } from '@/lib/utils'
import {
  buildProductionLink,
  defaultOrderRef,
  DESIGN_LIST_LIMIT,
  getStaffKey,
  listDesigns,
  mintProductionToken,
  parseRefs,
  previewCardUrls,
  PRODUCTION_ID_PATTERN,
  setStaffKey,
  StaffKeyError,
  type DesignFilters,
  type DesignSummary,
} from '@/lib/production-link'

/**
 * `/production` — the staff way into the production panel that does not go
 * through WordPress. Deliberately unlinked from anywhere a customer can reach.
 *
 * Flow: staff key → filtered list of saved designs → pick one → card domain +
 * refs + order details → mint a token → open (or copy) a deep link that is
 * exactly what the WordPress plugin would have built, Drive included.
 */
export function ProductionPage() {
  const [hasKey, setHasKey] = useState(() => !!getStaffKey())
  const [selected, setSelected] = useState<DesignSummary | null>(null)

  return (
    <div className="min-h-screen bg-neutral-50 dark:bg-neutral-950">
      <header className="border-b border-border bg-background">
        <div className="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
          <div className="flex items-center gap-2">
            <Wrench className="size-4 text-muted-foreground" />
            <h1 className="text-sm font-semibold">Production</h1>
            <span className="rounded-full border px-2 py-0.5 text-[10px] font-medium uppercase tracking-wider text-muted-foreground">
              Staff
            </span>
          </div>
          <div className="flex items-center gap-3">
            <Link to="/" className="text-xs text-muted-foreground hover:text-foreground">
              Designer
            </Link>
            {hasKey && (
              <Button
                variant="ghost"
                size="sm"
                className="h-7 gap-1.5 text-xs text-muted-foreground"
                onClick={() => {
                  setStaffKey(null)
                  setHasKey(false)
                  setSelected(null)
                }}
              >
                <LogOut className="size-3" />
                Forget key
              </Button>
            )}
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-5xl space-y-6 px-6 py-8">
        {!hasKey ? (
          <StaffKeyPrompt onSaved={() => setHasKey(true)} />
        ) : (
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-[1fr_380px]">
            <DesignList selectedId={selected?.design_id ?? null} onSelect={setSelected} />
            <LinkBuilder
              design={selected}
              onKeyRejected={() => {
                setStaffKey(null)
                setHasKey(false)
              }}
            />
          </div>
        )}
      </main>
    </div>
  )
}

// ---------------------------------------------------------------------------

function StaffKeyPrompt({ onSaved }: { onSaved: () => void }) {
  const [value, setValue] = useState('')
  return (
    <form
      className="mx-auto max-w-md space-y-4 rounded-lg border border-border bg-card p-6"
      onSubmit={(e) => {
        e.preventDefault()
        const key = value.trim()
        if (!key) return
        setStaffKey(key)
        onSaved()
      }}
    >
      <div className="flex items-center gap-2">
        <KeyRound className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Staff key</h2>
      </div>
      <p className="text-xs text-muted-foreground">
        The key that authorises production links and Google Drive uploads. It is kept
        only for this browser tab — closing the tab forgets it.
      </p>
      <Input
        type="password"
        autoFocus
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="Paste the production staff key"
        className="font-mono text-xs"
      />
      <Button type="submit" className="w-full" disabled={!value.trim()}>
        Continue
      </Button>
    </form>
  )
}

// ---------------------------------------------------------------------------

function formatDate(iso: string): string {
  return new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

function DesignList({
  selectedId,
  onSelect,
}: {
  selectedId: string | null
  onSelect: (design: DesignSummary) => void
}) {
  const [search, setSearch] = useState('')
  const [materialId, setMaterialId] = useState('')
  const [createdFrom, setCreatedFrom] = useState('')
  const [createdTo, setCreatedTo] = useState('')
  const [qrFilter, setQrFilter] = useState<'' | 'kept' | 'removed'>('')
  const [designs, setDesigns] = useState<DesignSummary[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Debounced so the search box doesn't fire a query per keystroke.
  const filters = useMemo<DesignFilters>(
    () => ({
      search: search || undefined,
      materialId: materialId || undefined,
      createdFrom: createdFrom || undefined,
      createdTo: createdTo || undefined,
      qrRemoved: qrFilter === '' ? undefined : qrFilter === 'removed',
    }),
    [search, materialId, createdFrom, createdTo, qrFilter],
  )

  useEffect(() => {
    let cancelled = false
    const timer = setTimeout(() => {
      setLoading(true)
      setError(null)
      listDesigns(filters)
        .then((rows) => {
          if (!cancelled) setDesigns(rows)
        })
        .catch((err) => {
          if (!cancelled) setError(err instanceof Error ? err.message : 'Could not load designs')
        })
        .finally(() => {
          if (!cancelled) setLoading(false)
        })
    }, 300)
    return () => {
      cancelled = true
      clearTimeout(timer)
    }
  }, [filters])

  const selectClass =
    'h-8 rounded-md border border-border bg-background px-2 text-xs'

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <h2 className="text-xs font-medium uppercase tracking-wider text-muted-foreground">
          Saved designs
        </h2>
        <span className="text-[11px] text-muted-foreground/70">
          {loading ? 'Loading…' : `${designs.length}${designs.length === DESIGN_LIST_LIMIT ? '+' : ''} shown, newest first`}
        </span>
      </div>

      {/* Filters */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[200px] flex-1">
          <Search className="pointer-events-none absolute left-2 top-1/2 size-3.5 -translate-y-1/2 text-muted-foreground" />
          <Input
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by name or design ID"
            className="h-8 pl-7 text-xs"
          />
        </div>
        <select value={materialId} onChange={(e) => setMaterialId(e.target.value)} className={selectClass}>
          <option value="">All materials</option>
          {materials.map((m) => (
            <option key={m.id} value={m.id}>{m.name}</option>
          ))}
        </select>
        <select
          value={qrFilter}
          onChange={(e) => setQrFilter(e.target.value as '' | 'kept' | 'removed')}
          className={selectClass}
        >
          <option value="">QR: any</option>
          <option value="kept">QR kept</option>
          <option value="removed">QR removed</option>
        </select>
        <input
          type="date"
          value={createdFrom}
          onChange={(e) => setCreatedFrom(e.target.value)}
          className={selectClass}
          title="Created from"
        />
        <span className="text-[11px] text-muted-foreground">to</span>
        <input
          type="date"
          value={createdTo}
          onChange={(e) => setCreatedTo(e.target.value)}
          className={selectClass}
          title="Created to"
        />
      </div>

      {error && (
        <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
          {error}
        </p>
      )}

      <div className="overflow-hidden rounded-lg border border-border bg-card">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border bg-muted/50 text-left text-[11px] font-medium uppercase tracking-wider text-muted-foreground">
                <th className="px-3 py-2">Design</th>
                <th className="px-3 py-2">Material</th>
                <th className="px-3 py-2">Back</th>
                <th className="px-3 py-2 text-right">Qty</th>
                <th className="px-3 py-2">Updated</th>
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {!loading && designs.length === 0 && (
                <tr>
                  <td colSpan={6} className="px-3 py-8 text-center text-xs text-muted-foreground">
                    No designs match these filters.
                  </td>
                </tr>
              )}
              {designs.map((design) => {
                const isSelected = design.design_id === selectedId
                const variation = getVariation(design.variation_id)
                const material = getMaterial(design.material_id)
                return (
                  <tr
                    key={design.design_id}
                    onClick={() => onSelect(design)}
                    className={cn(
                      'cursor-pointer border-b border-border last:border-b-0 transition-colors',
                      isSelected ? 'bg-foreground/[0.06]' : 'hover:bg-muted/60',
                    )}
                  >
                    <td className="w-full px-3 py-2">
                      <div className="flex items-center gap-2">
                        <div
                          className="size-5 shrink-0 rounded ring-1 ring-border"
                          style={{ backgroundColor: variation?.colorHint ?? "#ddd" }}
                        />
                        <div className="min-w-0">
                          <p className="truncate text-xs font-medium">{design.name || 'Untitled design'}</p>
                          <p className="font-mono text-[10px] text-muted-foreground">{design.design_id}</p>
                        </div>
                      </div>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {material?.name ?? design.material_id}
                      <span className="text-muted-foreground"> · {variation?.name ?? design.variation_id}</span>
                    </td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs">
                      {design.back_option === 'qr-name' ? 'QR + Name' : 'QR only'}
                      {design.qr_removed && (
                        <span className="ml-1.5 rounded border border-amber-500/30 bg-amber-500/10 px-1 text-[10px] text-amber-700 dark:text-amber-400">
                          no QR
                        </span>
                      )}
                    </td>
                    <td className="px-3 py-2 text-right text-xs tabular-nums">{design.quantity}</td>
                    <td className="whitespace-nowrap px-3 py-2 text-xs text-muted-foreground">{formatDate(design.updated_at)}</td>
                    <td className="px-3 py-2 text-right">
                      <a
                        href={`/design/${design.design_id}`}
                        target="_blank"
                        rel="noreferrer"
                        onClick={(e) => e.stopPropagation()}
                        className="inline-flex items-center gap-1 text-[11px] text-muted-foreground hover:text-foreground"
                        title="Open the share page"
                      >
                        <ExternalLink className="size-3" />
                      </a>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}

// ---------------------------------------------------------------------------

function LinkBuilder({
  design,
  onKeyRejected,
}: {
  design: DesignSummary | null
  onKeyRejected: () => void
}) {
  const [cardDomain, setCardDomain] = useState('')
  const [refsText, setRefsText] = useState('')
  const [order, setOrder] = useState(() => defaultOrderRef())
  const [item, setItem] = useState('')
  const [partnerSlug, setPartnerSlug] = useState('')
  const [minting, setMinting] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [link, setLink] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)

  // The item defaults to the design id: two synthetic orders on the same day
  // would otherwise share `Order-SM-…-item-1` in Drive and overwrite each other.
  useEffect(() => {
    setItem(design?.design_id ?? '')
    setLink(null)
    setError(null)
  }, [design?.design_id])

  const refs = useMemo(() => parseRefs(refsText), [refsText])
  const cardUrls = useMemo(() => previewCardUrls(cardDomain, refs), [cardDomain, refs])

  const orderValid = PRODUCTION_ID_PATTERN.test(order.trim())
  const itemValid = PRODUCTION_ID_PATTERN.test(item.trim())
  const canBuild = !!design && orderValid && itemValid && !minting

  const handleBuild = async (open: boolean) => {
    if (!design) return
    setMinting(true)
    setError(null)
    try {
      const minted = await mintProductionToken(order.trim(), item.trim())
      const url = buildProductionLink({
        designId: design.design_id,
        cardDomain,
        refs,
        partnerSlug,
        minted,
      })
      setLink(url)
      if (open) window.open(url, '_blank', 'noopener')
    } catch (err) {
      if (err instanceof StaffKeyError) {
        onKeyRejected()
        return
      }
      setError(err instanceof Error ? err.message : 'Could not build the link')
    } finally {
      setMinting(false)
    }
  }

  const handleCopy = async () => {
    if (!link) return
    try {
      await navigator.clipboard.writeText(link)
      setCopied(true)
      setTimeout(() => setCopied(false), 1500)
    } catch {
      // Clipboard blocked — the link is visible to select by hand
    }
  }

  const label = 'text-[10px] font-medium uppercase tracking-wider text-muted-foreground'

  return (
    <aside className="space-y-4 self-start rounded-lg border border-border bg-card p-4 lg:sticky lg:top-6">
      <div className="flex items-center gap-2">
        <QrCode className="size-4 text-muted-foreground" />
        <h2 className="text-sm font-medium">Production link</h2>
      </div>

      {!design ? (
        <p className="text-xs text-muted-foreground">Pick a design from the list to build its production link.</p>
      ) : (
        <>
          <div className="rounded-md bg-muted/60 px-3 py-2">
            <p className="truncate text-xs font-medium">{design.name || 'Untitled design'}</p>
            <p className="font-mono text-[10px] text-muted-foreground">{design.design_id}</p>
          </div>

          <div className="space-y-1">
            <label className={label}>Card domain</label>
            <Input
              value={cardDomain}
              onChange={(e) => setCardDomain(e.target.value)}
              placeholder="app.partner.com"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Where the printed QR codes resolve — each ref becomes <span className="font-mono">domain/r/ref</span>.
            </p>
          </div>

          <div className="space-y-1">
            <label className={label}>Card refs — one per card, in order</label>
            <textarea
              value={refsText}
              onChange={(e) => setRefsText(e.target.value)}
              rows={4}
              placeholder={'ab12cd\nef34gh\n…'}
              className="w-full resize-y rounded-md border border-border bg-background px-2 py-1.5 font-mono text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              {refs.length === 0
                ? 'Leave empty to open the panel and paste card URLs there.'
                : `${refs.length} ${refs.length === 1 ? 'card' : 'cards'}${cardUrls[0] ? ` · first: ${cardUrls[0]}` : ''}`}
            </p>
          </div>

          <div className="grid grid-cols-2 gap-2">
            <div className="space-y-1">
              <label className={label}>Order ref</label>
              <Input
                value={order}
                onChange={(e) => setOrder(e.target.value)}
                className={cn('h-8 font-mono text-xs', !orderValid && 'border-destructive')}
              />
            </div>
            <div className="space-y-1">
              <label className={label}>Item</label>
              <Input
                value={item}
                onChange={(e) => setItem(e.target.value)}
                className={cn('h-8 font-mono text-xs', !itemValid && 'border-destructive')}
              />
            </div>
          </div>
          <div className="space-y-1">
            <label className={label}>Partner slug (optional)</label>
            <Input
              value={partnerSlug}
              onChange={(e) => setPartnerSlug(e.target.value)}
              placeholder="acme-agency"
              className="h-8 text-xs"
            />
            <p className="text-[10px] text-muted-foreground">
              Drive folder: <span className="font-mono">Order-{order.trim() || '…'}-item-{item.trim() || '…'}{partnerSlug.trim() ? `-${partnerSlug.trim()}` : ''}</span>
            </p>
          </div>

          {error && (
            <p className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              {error}
            </p>
          )}

          <div className="flex gap-2">
            <Button className="flex-1 gap-1.5" disabled={!canBuild} onClick={() => handleBuild(true)}>
              {minting ? <Loader2 className="size-3.5 animate-spin" /> : <ExternalLink className="size-3.5" />}
              Open production panel
            </Button>
            <Button variant="outline" disabled={!canBuild} onClick={() => handleBuild(false)} title="Build without opening">
              Build
            </Button>
          </div>

          {link && (
            <div className="space-y-2 rounded-md border border-border bg-muted/40 p-2.5">
              <p className="break-all font-mono text-[10px] leading-4 text-muted-foreground">{link}</p>
              <div className="flex items-center justify-between">
                <span className="text-[10px] text-muted-foreground">Drive enabled · link valid for 7 days</span>
                <Button variant="ghost" size="sm" className="h-6 gap-1 text-[11px]" onClick={handleCopy}>
                  {copied ? <Check className="size-3" /> : <Copy className="size-3" />}
                  {copied ? 'Copied' : 'Copy link'}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </aside>
  )
}
